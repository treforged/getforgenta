/**
 * ai-advisor v4
 *
 * Forgenta AI — personal finance coach powered by Google Gemini.
 * Enforces per-user server-side checks in order:
 *   1. JWT auth
 *   2. Active premium subscription
 *   3. AI consent accepted (current version)
 *   4. Daily / weekly usage quota
 *   5. Gemini call + record usage + save history
 *
 * Required env vars:
 *   GEMINI_API_KEY  — Google AI Studio key
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

const BURST_LIMIT = { windowMs: 60_000, max: 5 };

const QUOTA = {
  premium: { day: 150, week: 750 },
} as const;

const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_QUESTION_LENGTH = 500;
const AI_CONSENT_VERSION = "2026-04-30-gemini-2.5-flash";

interface DebtDetail {
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  targetPayment: number;
  projectedPayoffMonths: number | null;
}

interface SavingsGoalDetail {
  name: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  targetDate: string | null;
}

interface ConversationTurn {
  question: string | null;
  summary: string;
  nextMove: string;
}

interface FinancialSnapshot {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyDebtPayments?: number;
  totalDebt: number;
  savingsBalance: number;
  cashOnHand: number;
  netWorth: number;
  savingsRate: number;
  topCategories: { category: string; amount: number }[];
  debtDetails: DebtDetail[];
  savingsGoals: SavingsGoalDetail[];
  debtStrategy?: 'avalanche' | 'snowball';
  paymentMode?: 'variable' | 'consistent';
  question?: string;
  conversationId?: string;
  conversationHistory?: ConversationTurn[];
}

function buildPrompt(body: FinancialSnapshot): string {
  const hasDebts = body.debtDetails.length > 0;
  const hasGoals = body.savingsGoals.length > 0;
  const hasQuestion = !!body.question?.trim();
  const hasHistory = (body.conversationHistory?.length ?? 0) > 0;

  const strategyLabel = body.debtStrategy === 'snowball'
    ? 'Snowball (lowest balance first)'
    : 'Avalanche (highest APR first)';
  const modeLabel = body.paymentMode === 'consistent'
    ? 'Consistent fixed payments each month'
    : 'Variable — payments adjust dynamically based on available cash each month';

  const debtSection = hasDebts
    ? body.debtDetails
        .sort((a, b) => b.balance - a.balance)
        .map(d => {
          let line = `  - ${d.name}: $${d.balance.toFixed(0)} balance`;
          if (d.apr > 0) line += `, ${d.apr.toFixed(1)}% APR`;
          if (d.minPayment > 0) line += `, $${d.minPayment.toFixed(0)}/mo minimum`;
          if (d.targetPayment > d.minPayment) line += `, $${d.targetPayment.toFixed(0)}/mo targeted`;
          if (d.projectedPayoffMonths !== null && d.projectedPayoffMonths !== undefined) {
            const months = d.projectedPayoffMonths;
            const payoffDate = new Date();
            payoffDate.setMonth(payoffDate.getMonth() + months);
            line += ` → payoff in ~${months} months (${payoffDate.toLocaleString('en', { month: 'short', year: 'numeric' })})`;
          }
          return line;
        })
        .join("\n")
    : "  (none recorded)";

  const goalSection = hasGoals
    ? body.savingsGoals
        .map(g => {
          const pct = g.targetAmount > 0 ? ((g.currentAmount / g.targetAmount) * 100).toFixed(0) : 0;
          let line = `  - ${g.name}: $${g.currentAmount.toFixed(0)} saved of $${g.targetAmount.toFixed(0)} (${pct}% complete)`;
          if (g.monthlyContribution > 0) line += `, contributing $${g.monthlyContribution.toFixed(0)}/mo`;
          if (g.targetDate) line += `, target date ${g.targetDate}`;
          return line;
        })
        .join("\n")
    : "  (none recorded)";

  const categorySection = body.topCategories.length > 0
    ? body.topCategories
        .slice(0, 6)
        .map(c => `  - ${c.category}: $${c.amount.toFixed(0)}/mo`)
        .join("\n")
    : "  (no category data this month)";

  const debtPayments = body.monthlyDebtPayments ?? 0;
  const surplus = body.monthlyIncome - body.monthlyExpenses - debtPayments;

  const historySection = hasHistory
    ? `\nCONVERSATION HISTORY (prior turns in this chat — do not repeat this advice, build on it)\n${
        body.conversationHistory!.map((h, i) =>
          `Turn ${i + 1}: ${h.question ? `User asked: "${h.question}"` : 'Initial analysis'}\nForgenta said: ${h.summary}${h.nextMove ? ` Recommended: ${h.nextMove}` : ''}`
        ).join('\n\n')
      }\n`
    : '';

  const directive = hasQuestion
    ? hasHistory
      ? `The user is following up with: "${body.question!.trim()}"\n\nThis is a continuation. Answer the follow-up directly and specifically, building on what was already discussed. Go deeper where relevant — do not restate prior advice. If they want clarification, give it with their actual numbers.`
      : `The user is asking: "${body.question!.trim()}"\n\nAnswer this question directly and specifically using their actual numbers, debt names, and goal names. Then add 1-2 high-priority insights if the data supports it.`
    : `Give a personalized analysis of this person's financial picture. Start by acknowledging something they're doing well — even small wins matter. Then identify the 2-4 most impactful things they should focus on, ordered by financial impact. Use their specific debt names, goal names, and actual dollar amounts throughout.`;

  const summaryInstruction = hasQuestion
    ? hasHistory
      ? "A direct, complete answer to the follow-up question that builds on what was already discussed. 2-4 sentences. Use their specific names and numbers — no restating prior answers."
      : "Directly and fully answer the user's question using their actual numbers, names, and dates. Be complete — 3-6 sentences. Do not open with a general financial health overview."
    : "2-3 sentences covering what they're doing well and what needs the most attention, with specific numbers.";

  return `You are Forgenta, a personal finance coach inside the Forgenta app. You have full access to this user's live financial data. You're direct and specific — never generic — but you're also human about it. You care about this person's real progress. You acknowledge what's hard, celebrate what's working, and give people guidance they can act on today. When someone is stressed about money, lead with empathy before analysis. When they've made progress, say so clearly.${historySection ? '\n' + historySection : ''}

THEIR FINANCIAL PICTURE

Income & Cash Flow
- Monthly take-home income: $${body.monthlyIncome.toFixed(0)}
- Monthly spending (bills, subscriptions, living expenses): $${body.monthlyExpenses.toFixed(0)}
- Monthly debt payments (CC, loans — separate from spending above): $${debtPayments.toFixed(0)}
- Monthly surplus after all outflows: $${surplus >= 0 ? '+' : ''}${surplus.toFixed(0)}
- Savings rate: ${body.savingsRate.toFixed(1)}%
Note: the surplus above already accounts for debt payments. Do not add them again.

Debt Payoff Settings
- Strategy: ${strategyLabel}
- Payment mode: ${modeLabel}

Debts (total owed: $${body.totalDebt.toFixed(0)})
${debtSection}

Savings Goals
${goalSection}

Cash Position
- Checking / liquid cash: $${body.cashOnHand.toFixed(0)}
- Savings account balance: $${body.savingsBalance.toFixed(0)}
- Net worth: $${body.netWorth.toFixed(0)}

Top Spending Categories This Month
${categorySection}

---
${directive}

Rules:
- Always use the actual debt names, goal names, and dollar amounts from the data above
- Payoff projections assume consistent payments — note this when payment mode is Variable
- Do not add disclaimers or suggest consulting a financial advisor
- Don't pad sections — only include what's directly relevant
- For follow-up questions, prefer paragraphs and bullets over tables/pie charts unless the question specifically calls for comparison data
- Acknowledge progress and effort, not just problems — people need to know when they're on the right track

Respond ONLY in this exact JSON (no markdown, no code fences, no preamble):
{
  "summary": "${summaryInstruction}",
  "score": <integer 1-100 representing overall financial health>,
  "scoreLabel": "<Poor|Fair|Good|Strong|Excellent>",
  "sections": [
    /* Choose the format that best fits each piece of information. Options:
       { "type": "paragraph", "text": "..." }
       { "type": "bullets", "items": ["...", "..."] }
       { "type": "table", "headers": ["Col1", "Col2"], "rows": [["val1", "val2"]] }
       { "type": "pie", "title": "...", "data": [{ "label": "Category", "value": 450 }] }
    Use table for multi-column debt/payoff comparisons. Use pie ONLY for spending breakdowns.
    Use paragraph or bullets for advice. Include only sections that add value.
    For follow-up questions, keep sections to 1-3 focused items. */
  ],
  "nextMove": "The single highest-impact action this month with a specific dollar amount or target. Phrase it as direct, personal advice — as if you're talking to this person, not writing a report."
}`;
}

function extractJson(raw: string): string {
  let text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) text = text.slice(first, last + 1);
  return text;
}

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Burst rate limit per IP
  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:ai-advisor`, BURST_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(corsHeaders, BURST_LIMIT, rl.resetAt);

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return jsonResponse({ error: "AI not configured" }, 503, corsHeaders);
  }

  // 2. JWT authentication
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "not_authenticated" }, 401, corsHeaders);
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: jwtErr } = await supabase.auth.getUser(token);
  if (jwtErr || !user) {
    return jsonResponse({ error: "not_authenticated" }, 401, corsHeaders);
  }
  const userId = user.id;

  // 3. Premium subscription — service role query, cannot be spoofed by client
  const { data: subData } = await supabase
    .from("user_subscriptions")
    .select("plan, subscription_status")
    .eq("user_id", userId)
    .maybeSingle();

  const isPremium =
    subData?.plan === "premium" &&
    ["active", "trialing"].includes(subData?.subscription_status ?? "");

  if (!isPremium) {
    return jsonResponse({ error: "premium_required" }, 403, corsHeaders);
  }

  // 4. AI consent — must be accepted at current version
  const { data: profileData } = await supabase
    .from("profiles")
    .select("ai_consent_accepted, ai_consent_version")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profileData?.ai_consent_accepted || profileData.ai_consent_version !== AI_CONSENT_VERSION) {
    return jsonResponse({ error: "ai_consent_required" }, 403, corsHeaders);
  }

  // 5. Daily / weekly quota (UTC boundaries)
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStart = new Date(todayStart);
  weekStart.setUTCDate(todayStart.getUTCDate() - now.getUTCDay());

  const [{ count: usedTodayRaw }, { count: usedWeekRaw }] = await Promise.all([
    supabase
      .from("ai_usage_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", todayStart.toISOString()),
    supabase
      .from("ai_usage_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", weekStart.toISOString()),
  ]);

  const usedToday = usedTodayRaw ?? 0;
  const usedWeek  = usedWeekRaw  ?? 0;
  const limits    = QUOTA.premium;

  const usagePayload = {
    used_today: usedToday,
    limit_day:  limits.day,
    used_week:  usedWeek,
    limit_week: limits.week,
  };

  if (usedToday >= limits.day) {
    return jsonResponse({
      error: `You've used all ${limits.day} AI questions for today. Your limit resets at midnight UTC.`,
      usage: usagePayload,
    }, 429, corsHeaders);
  }
  if (usedWeek >= limits.week) {
    return jsonResponse({
      error: `You've used all ${limits.week} AI questions for this week. Your limit resets Sunday at midnight UTC.`,
      usage: usagePayload,
    }, 429, corsHeaders);
  }

  // 6. Process request
  try {
    const body = await req.json() as FinancialSnapshot;

    if (body.question && body.question.length > MAX_QUESTION_LENGTH) {
      return jsonResponse({ error: `Question too long (max ${MAX_QUESTION_LENGTH} characters).` }, 400, corsHeaders);
    }

    // Sanitize conversation history — max 4 turns, trim to safe length
    if (body.conversationHistory) {
      body.conversationHistory = body.conversationHistory
        .slice(-4)
        .map(h => ({
          question: h.question ? h.question.slice(0, MAX_QUESTION_LENGTH) : null,
          summary: (h.summary ?? '').slice(0, 400),
          nextMove: (h.nextMove ?? '').slice(0, 200),
        }));
    }

    const prompt = buildPrompt(body);

    const geminiPayload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 8000 },
    });
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    // Retry on 503/429 (transient overload) — up to 2 retries, 4s apart
    const RETRYABLE = new Set([429, 503]);
    let geminiRes!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 4000));
      geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: geminiPayload,
      });
      if (geminiRes.ok || !RETRYABLE.has(geminiRes.status)) break;
      console.warn(`ai-advisor: Gemini ${geminiRes.status}, attempt ${attempt + 1}/3`);
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("ai-advisor: Gemini error", geminiRes.status, errText.slice(0, 500));
      let geminiMsg = "";
      try { geminiMsg = (JSON.parse(errText) as { error?: { message?: string } })?.error?.message ?? ""; } catch { /* ignore */ }
      return jsonResponse({
        error: `AI request failed (${geminiRes.status})${geminiMsg ? ": " + geminiMsg.slice(0, 120) : ""}`,
      }, 502, corsHeaders);
    }

    const geminiData = await geminiRes.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };

    // Filter out Gemini 2.5 Flash thinking parts (thought: true)
    const parts = geminiData?.candidates?.[0]?.content?.parts ?? [];
    const rawText = parts
      .filter(p => !p.thought && typeof p.text === "string")
      .map(p => p.text)
      .join("");

    const jsonText = extractJson(rawText);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      console.error("ai-advisor: JSON parse failed. Raw:", rawText.slice(0, 500));
      return jsonResponse({ error: "Invalid AI response. Please try again." }, 502, corsHeaders);
    }

    // Record usage and save history via service role (client cannot forge these)
    const [, { data: historyRow }] = await Promise.all([
      supabase.from("ai_usage_events").insert({ user_id: userId }),
      supabase
        .from("ai_advisor_history")
        .insert({
          user_id: userId,
          question: body.question ?? null,
          result: parsed,
          conversation_id: body.conversationId ?? null,
        })
        .select("id, created_at")
        .single(),
    ]);

    return jsonResponse({
      ...parsed,
      _history_id: historyRow?.id ?? null,
      _history_created_at: historyRow?.created_at ?? new Date().toISOString(),
      usage: {
        used_today: usedToday + 1,
        limit_day:  limits.day,
        used_week:  usedWeek + 1,
        limit_week: limits.week,
      },
    }, 200, corsHeaders);

  } catch (err) {
    console.error("ai-advisor:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500, corsHeaders);
  }
});
