/**
 * Frontend tracer for Supabase edge function invocations.
 *
 * Generates a session-scoped trace ID, passes it to edge functions via
 * x-trace-id, and logs structured spans to the browser console.
 *
 * PII policy (enforced here):
 *   ✅ function name, duration_ms, http.status_code, error type
 *   ✅ trace_id, span_id (synthetic IDs — not derived from user data)
 *   ❌ No request body content, response body, tokens, emails, user IDs
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

type SpanStatus = "OK" | "ERROR";

interface SpanRecord {
  traceId: string;
  spanId: string;
  name: string;
  service: "frontend";
  kind: "CLIENT";
  startTime: string;
  endTime: string;
  duration_ms: number;
  status: SpanStatus;
  errorType?: string;
  attributes: Record<string, string | number | boolean>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

const PII_PATTERNS: [RegExp, string][] = [
  [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[EMAIL]"],
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[JWT]"],
  [/sk_(live|test)_[A-Za-z0-9]+/g, "[STRIPE_KEY]"],
];

function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return "UnknownError";
  let msg = err.message;
  for (const [pattern, replacement] of PII_PATTERNS) {
    msg = msg.replace(pattern, replacement);
  }
  return msg.slice(0, 200);
}

// ── Session trace ID ─────────────────────────────────────────────────────────

/**
 * A single trace ID scoped to this browser session.
 * Correlates all edge function calls made in a single page session.
 */
const SESSION_TRACE_ID = randomHex(16);

// ── Span emitter ─────────────────────────────────────────────────────────────

function emitSpan(record: SpanRecord): void {
  // Structured log — visible in browser devtools and capturable by log forwarding.
  // Use a distinctive prefix so spans are easily grep-able.
  if (import.meta.env.DEV) {
    const icon = record.status === "OK" ? "✓" : "✗";
    console.log(
      `[tracer] ${icon} ${record.name} — ${record.duration_ms}ms`,
      record,
    );
  } else {
    // In production, emit minimal structured JSON (no nested objects in console.log
    // to avoid accidental serialization of sensitive references).
    console.log(JSON.stringify({ otel_span: record }));
  }
}

// ── tracedInvoke ─────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for `supabase.functions.invoke()` that adds:
 *  - latency measurement
 *  - structured span logging
 *  - x-trace-id propagation (correlates frontend→edge function spans)
 *  - sanitized error capture
 *
 * Usage:
 *   const { data, error } = await tracedInvoke(supabase, 'create-checkout', {
 *     body: { return_url: window.location.origin },
 *   });
 */
export async function tracedInvoke<T = unknown>(
  supabase: SupabaseClient,
  functionName: string,
  options?: Parameters<SupabaseClient["functions"]["invoke"]>[1],
): Promise<{ data: T | null; error: Error | null }> {
  const spanId = randomHex(8);
  const startMs = performance.now();
  const startTime = new Date().toISOString();

  // Merge the x-trace-id header into any existing headers.
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
    "x-trace-id": SESSION_TRACE_ID,
  };

  let status: SpanStatus = "OK";
  let errorType: string | undefined;

  const result = await supabase.functions.invoke<T>(functionName, {
    ...options,
    headers,
  });

  if (result.error) {
    status = "ERROR";
    errorType = sanitizeError(result.error);
  }

  const duration_ms = Math.round((performance.now() - startMs) * 100) / 100;

  const record: SpanRecord = {
    traceId: SESSION_TRACE_ID,
    spanId,
    name: `supabase.functions.invoke.${functionName}`,
    service: "frontend",
    kind: "CLIENT",
    startTime,
    endTime: new Date().toISOString(),
    duration_ms,
    status,
    ...(errorType ? { errorType } : {}),
    attributes: {
      "function.name": functionName,
      "peer.service": "supabase-edge",
    },
  };

  emitSpan(record);

  return result as { data: T | null; error: Error | null };
}

/** Expose the session trace ID for attaching to manual spans or debugging. */
export { SESSION_TRACE_ID as traceId };
