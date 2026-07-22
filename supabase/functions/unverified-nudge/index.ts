/**
 * unverified-nudge
 *
 * Called by pg_cron daily (see 20260722_email_nudges.sql). Finds users who signed
 * up but never confirmed their email and sends a staged reminder via Resend:
 *   - gentle_24h : a soft nudge in the 24–72h window
 *   - final_72h  : a last reminder once past 72h
 *
 * Each email embeds a real one-click verification link generated on the fly via the
 * GoTrue admin API (magiclink → clicking it both signs the user in and confirms the
 * address). State is recorded in public.email_nudges so a user is never double-sent
 * the same stage. Secured by the CRON_SECRET header — no user JWT required.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NUDGE_FROM = Deno.env.get("NUDGE_FROM") ?? "Forgenta <noreply@treforged.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://getforgenta.com";

type Stage = "gentle_24h" | "final_72h";

interface NudgeRow {
  user_id: string;
  email: string;
  stage: Stage;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const COPY: Record<Stage, { subject: string; heading: string; body: string; cta: string }> = {
  gentle_24h: {
    subject: "Confirm your email to finish setting up Forgenta",
    heading: "You're one tap away",
    body:
      "Thanks for signing up for Forgenta. Confirm your email address and your budget, forecast, and accounts will be ready to go.",
    cta: "Confirm my email",
  },
  final_72h: {
    subject: "Last step: confirm your Forgenta email",
    heading: "Don't lose your spot",
    body:
      "Your Forgenta account still isn't confirmed. Verify your email now to unlock your dashboard — it only takes a second.",
    cta: "Verify my email",
  },
};

function buildEmailHtml(stage: Stage, link: string): string {
  const c = COPY[stage];
  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f4f5;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <div style="background:#0f172a;padding:24px 32px">
        <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-.5px">Forgenta</span>
      </div>
      <div style="padding:32px">
        <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a">${esc(c.heading)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569">${esc(c.body)}</p>
        <a href="${esc(link)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:8px">${esc(c.cta)}</a>
        <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#94a3b8">If the button doesn't work, copy and paste this link:<br><span style="color:#64748b;word-break:break-all">${esc(link)}</span></p>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #f1f5f9">
        <p style="margin:0;font-size:12px;color:#94a3b8">You received this because you started creating a Forgenta account. If this wasn't you, you can ignore this email.</p>
      </div>
    </div>
  </body></html>`;
}

async function generateVerifyLink(
  supabase: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${APP_URL}/dashboard` },
  });
  if (error || !data?.properties?.action_link) return null;
  return data.properties.action_link;
}

async function sendEmail(stage: Stage, to: string, link: string): Promise<boolean> {
  const c = COPY[stage];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NUDGE_FROM,
      to: [to],
      subject: c.subject,
      html: buildEmailHtml(stage, link),
    }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: rows, error } = await supabase.rpc("get_users_to_nudge");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const targets = (rows ?? []) as NudgeRow[];
  let sent = 0;
  const failures: { email: string; stage: Stage; reason: string }[] = [];

  for (const row of targets) {
    const link = await generateVerifyLink(supabase, row.email);
    if (!link) {
      failures.push({ email: row.email, stage: row.stage, reason: "link_generation_failed" });
      continue;
    }

    const ok = await sendEmail(row.stage, row.email, link);
    if (!ok) {
      failures.push({ email: row.email, stage: row.stage, reason: "resend_send_failed" });
      continue;
    }

    // Record the send so we never double-nudge this stage.
    const { error: insertError } = await supabase
      .from("email_nudges")
      .insert({ user_id: row.user_id, stage: row.stage });
    if (insertError) {
      failures.push({ email: row.email, stage: row.stage, reason: `record_failed: ${insertError.message}` });
      continue;
    }

    sent++;
    // Gentle pacing to stay well under Resend rate limits.
    await new Promise((r) => setTimeout(r, 300));
  }

  return new Response(
    JSON.stringify({ candidates: targets.length, sent, failures }),
    { headers: { "Content-Type": "application/json" } },
  );
});
