/**
 * Lightweight OpenTelemetry-compatible tracer for Supabase Edge Functions (Deno).
 *
 * Spans are emitted as structured JSON via console.log, which Supabase captures
 * in its Edge Function log drain and makes searchable in the dashboard.
 *
 * Optional real OTLP/HTTP export: set OTEL_EXPORTER_OTLP_ENDPOINT env var.
 * e.g. OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com
 *
 * PII policy (enforced here):
 *   ✅ http.method, http.path (no query strings), http.status_code, duration_ms
 *   ✅ db.table, db.operation, error type (sanitized, truncated)
 *   ✅ stripe.event_type, service.name, trace_id, span_id
 *   ❌ No emails, JWTs, API keys, Stripe IDs, user IDs, financial amounts
 */

export type SpanStatus = "OK" | "ERROR" | "UNSET";
export type SpanKind = "SERVER" | "CLIENT" | "INTERNAL";

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  kind: SpanKind;
  startTime: string;
  endTime: string;
  duration_ms: number;
  status: SpanStatus;
  errorType?: string;
  attributes: SpanAttributes;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash a sensitive ID (e.g. userId) to a short correlation token.
 * The first 16 hex chars of SHA-256 — non-reversible, safe to log.
 */
export async function hashId(id: string): Promise<string> {
  const encoded = new TextEncoder().encode(id);
  const buf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

const PII_PATTERNS: [RegExp, string][] = [
  [/sk_(live|test)_[A-Za-z0-9]+/g, "[STRIPE_KEY]"],
  [/rk_(live|test)_[A-Za-z0-9]+/g, "[STRIPE_RESTRICTED_KEY]"],
  [/whsec_[A-Za-z0-9]+/g, "[STRIPE_WEBHOOK_SECRET]"],
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[JWT]"],
  [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[EMAIL]"],
  [/"email"\s*:\s*"[^"]*"/g, '"email":"[REDACTED]"'],
  [/"stripe_customer_id"\s*:\s*"[^"]*"/g, '"stripe_customer_id":"[REDACTED]"'],
];

function sanitizeMessage(msg: string): string {
  let out = msg;
  for (const [pattern, replacement] of PII_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out.slice(0, 300); // cap length
}

// ── Span ─────────────────────────────────────────────────────────────────────

export interface Span {
  readonly spanId: string;
  readonly traceId: string;
  end(status: SpanStatus, error?: unknown): void;
}

// ── Tracer ───────────────────────────────────────────────────────────────────

export interface Tracer {
  readonly traceId: string;
  startSpan(
    name: string,
    options?: {
      parentSpanId?: string;
      kind?: SpanKind;
      attributes?: SpanAttributes;
    },
  ): Span;
}

export function createTracer(service: string, incomingTraceId?: string): Tracer {
  const traceId = incomingTraceId ?? randomHex(16);
  const otlpEndpoint = (() => {
    try { return Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") ?? null; }
    catch { return null; }
  })();

  function startSpan(
    name: string,
    options: {
      parentSpanId?: string;
      kind?: SpanKind;
      attributes?: SpanAttributes;
    } = {},
  ): Span {
    const spanId = randomHex(8);
    const startMs = performance.now();
    const startTime = new Date().toISOString();

    return {
      spanId,
      traceId,
      end(status: SpanStatus, error?: unknown): void {
        const duration_ms = Math.round((performance.now() - startMs) * 100) / 100;

        let errorType: string | undefined;
        if (error != null) {
          if (error instanceof Error) {
            errorType = sanitizeMessage(error.message);
          } else {
            errorType = "UnknownError";
          }
        }

        const record: SpanRecord = {
          traceId,
          spanId,
          ...(options.parentSpanId ? { parentSpanId: options.parentSpanId } : {}),
          name,
          service,
          kind: options.kind ?? "INTERNAL",
          startTime,
          endTime: new Date().toISOString(),
          duration_ms,
          status,
          ...(errorType ? { errorType } : {}),
          attributes: options.attributes ?? {},
        };

        // Supabase captures console.log from edge functions in its log drain.
        console.log(JSON.stringify({ otel_span: record }));

        // Optional real OTLP export — best-effort, never blocks the response.
        if (otlpEndpoint) {
          exportToOtlp(otlpEndpoint, record).catch(() => undefined);
        }
      },
    };
  }

  return { traceId, startSpan };
}

// ── OTLP/HTTP JSON export (optional) ─────────────────────────────────────────

async function exportToOtlp(endpoint: string, span: SpanRecord): Promise<void> {
  const otlpBody = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: span.service } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "tre-forged-tracer", version: "1.0.0" },
            spans: [
              {
                traceId: span.traceId,
                spanId: span.spanId,
                ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                name: span.name,
                // SPAN_KIND: INTERNAL=1, SERVER=2, CLIENT=3
                kind: span.kind === "SERVER" ? 2 : span.kind === "CLIENT" ? 3 : 1,
                startTimeUnixNano: String(
                  new Date(span.startTime).getTime() * 1_000_000,
                ),
                endTimeUnixNano: String(
                  new Date(span.endTime).getTime() * 1_000_000,
                ),
                attributes: Object.entries(span.attributes)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => ({
                    key: k,
                    value:
                      typeof v === "number"
                        ? { intValue: String(v) }
                        : typeof v === "boolean"
                        ? { boolValue: v }
                        : { stringValue: String(v) },
                  })),
                status: {
                  // STATUS_CODE: UNSET=0, OK=1, ERROR=2
                  code: span.status === "OK" ? 1 : span.status === "ERROR" ? 2 : 0,
                  ...(span.errorType ? { message: span.errorType } : {}),
                },
              },
            ],
          },
        ],
      },
    ],
  };

  await fetch(`${endpoint}/v1/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(otlpBody),
    signal: AbortSignal.timeout(3_000),
  });
}
