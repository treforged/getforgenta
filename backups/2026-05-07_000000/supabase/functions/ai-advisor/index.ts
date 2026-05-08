/**
 * ai-advisor v3
 *
 * Forged AI budget advisor powered by Google Gemini 2.5 Flash.
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
}

interface SavingsGoalDetail {
  name: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  targetDate: string | null;
}

interface FinancialSnapshot {
  monthlyIncome: number;
  monthlyExpenses: number;
  totalDebt: number;
  savingsBalance: number;
  cashOnHand: number;
  netWorth: number;
  savingsRate: number;
  topCategories: { category: string; amount: number }[];
  debtDetails: DebtDetail[];
  savingsGoals: SavingsGoalDetail[];
  question?: string;
}

function buildPrompt(body: FinancialSnapshot): string {
  const hasDebts = body.debtDetails.length > 0;
  const hasGoals = body.savingsGoals.length > 0;
  const hasQuestion = !!body.question?.trim();

  const debtSection = hasDebts
    ? body.debtDetails
        .sort((a, b) => b.balance - a.balance)
        .map(d => {
          let line = `  - ${d.name}: $${d.balance.toFixed(0)} balance`;
          if (d.apr > 0) line += `, ${d.apr.toFixed(1)}% APR`;
          if (d.minPayment > 0) line += `, $${d.minPayment.toFixed(0)}/mo minimum`;
          if (d.targetPayment > d.minPayment) line += ` ($${d.targetPayment.toFixed(0)}/mo targeted)`;
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

  const surplus = body.monthlyIncome - body.monthlyExpenses;

  const directive = hasQuestion
    ? `The user is asking: "${body.question!.trim()}"\n\nAnswer this question directly and specifically using their actual numbers, debt names, and goal names. Then add 1-2 additional high-priority insights if the data warrants it.`
    : `Give a personalized analysis of this person's financial picture. Identify the 2-5 most impactful actions they should take right now, ordered by financial impact. Reference their specific debt names, goal names, and actual dollar amounts — not generic advice.`;

  return `You are Forge, a direct and specific personal finance advisor inside the Forgenta app. You have full access to this user's live financial data. Your job is to give advice that is specific to THIS person — reference their exact numbers, their debt names, their goal names. Never give advice so generic it could apply to anyone.\n\nTHEIR FINANCIAL PICTURE\n\nIncome & Cash Flow\n- Monthly take-home income: $${body.monthlyIncome.toFixed(0)}\n- Monthly expenses: $${body.monthlyExpenses.toFixed(0)}\n- Monthly surplus/deficit: $${surplus >= 0 ? '+' : ''}${surplus.toFixed(0)}\n- Savings rate: ${body.savingsRate.toFixed(1)}%\n\nDebts (total owed: $${body.totalDebt.toFixed(0)})\n${debtSection}\n\nSavings Goals\n${goalSection}\n\nCash Position\n- Checking / liquid cash: $${body.cashOnHand.toFixed(0)}\n- Savings account balance: $${body.savingsBalance.toFixed(0)}\n- Net worth: $${body.netWorth.toFixed(0)}\n\nTop Spending Categories This Month\n${categorySection}\n\n---\n${directive}\n\nFormatting rules:\n- Use each debt's actual name (e.g. "your Auto Loan" not "your loan")\n- Use each goal's actual name (e.g. "your Emergency Fund" not "your savings goal")\n- Cite specific dollar amounts and percentages whenever making a recommendation\n- If a debt has a high APR, name it and quantify how much interest it's costing monthly\n- If a savings goal is behind pace, calculate the monthly shortfall and name it\n- If cash on hand is less than one month of expenses ($${body.monthlyExpenses.toFixed(0)}), call that out\n- Vary insight count (2–6) based on what actually warrants attention — do not pad\n- Do not be preachy. Do not add disclaimers. Do not suggest consulting a financial advisor.\n\nRespond ONLY in this exact JSON (no markdown, no code fences, no preamble):\n{\n  "summary": "2-3 sentences summarizing their specific situation using their actual numbers",\n  "score": <integer 1-100 representing overall financial health>,\n  "scoreLabel": "<Poor|Fair|Good|Strong|Excellent>",\n  "insights": [\n    { "type": "<positive|warning|action>", "title": "Short specific title", "body": "1-3 sentences with specific numbers and names from their data" }\n  ],\n  "nextMove": "The single highest-impact action this month with a specific dollar amount or target."\n}`;
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

    const prompt = buildPrompt(body);

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 8000 },
        }),
      },
    );

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
        .insert({ user_id: userId, question: body.question ?? null, result: parsed })
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
