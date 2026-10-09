/**
 * no-save-nudge
 *
 * Called by pg_cron daily (see 20261006_no_save_nudge.sql). Sends ONE follow-up email to a real
 * account, 3 to 30 days old, that has still saved nothing (Tre, 2026-10-06, ask 6d0e50b0: "make
 * future items like this auto follow up", after approving the same email by hand for 10 users).
 *
 * Copy: _shared/no-save-nudge-copy.ts (since 2026-10-09 it asks for one quick add, proposal D).
 * No postal line (decision 0e582396). Each send
 * is recorded in public.email_nudges as stage 'no_save_72h', and the selector skips anyone with
 * that row, so nobody gets it twice. Secured by the CRON_SECRET header - no user JWT required.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cronSecretMatches } from "../_shared/plaid-webhook-register.ts";
import { buildNudgeText, NUDGE_SUBJECT } from "../_shared/no-save-nudge-copy.ts";
import { listUnsubscribeHeaders, unsubscribeUrl } from "../_shared/email-unsubscribe.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NUDGE_FROM = Deno.env.get("NUDGE_FROM") ?? "Forgenta <noreply@treforged.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://getforgenta.com";
const CONTACT = "contact@treforged.com";
// A runaway selector must not become a mass mailing. Above this, nothing is sent and the run says why.
const MAX_PER_RUN = 50;

interface Target {
  user_id: string;
  email: string;
}

async function sendEmail(to: string, userId: string): Promise<boolean> {
  // One-click unsubscribe when its secret is set; the mailto line otherwise, as before.
  const secret = Deno.env.get("EMAIL_UNSUBSCRIBE_SECRET");
  const unsub = secret ? await unsubscribeUrl(`${SUPABASE_URL}/functions/v1`, userId, secret) : null;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NUDGE_FROM,
      to: [to],
      reply_to: CONTACT,
      subject: NUDGE_SUBJECT,
      text: buildNudgeText(APP_URL, CONTACT, unsub),
      headers: unsub
        ? listUnsubscribeHeaders(unsub, CONTACT)
        : { "List-Unsubscribe": `<mailto:${CONTACT}?subject=unsubscribe>` },
      tags: [{ name: "campaign", value: "no-save-nudge" }],
    }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  // Constant-time compare; an unset CRON_SECRET never authorises (security review db1d6813).
  if (!cronSecretMatches(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows, error } = await supabase.rpc("get_users_to_nudge_no_save");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const targets = (rows ?? []) as Target[];
  if (targets.length > MAX_PER_RUN) {
    return new Response(
      JSON.stringify({ error: "too_many_candidates", candidates: targets.length, cap: MAX_PER_RUN }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  let sent = 0;
  const failures: { user_id: string; reason: string }[] = [];
  for (const row of targets) {
    // Record FIRST, then send: a send whose record failed could repeat tomorrow; a record whose
    // send failed costs one missed email, which is the safer way to be wrong.
    const { error: insertError } = await supabase
      .from("email_nudges")
      .insert({ user_id: row.user_id, stage: "no_save_72h" });
    if (insertError) {
      failures.push({ user_id: row.user_id, reason: `record_failed: ${insertError.message}` });
      continue;
    }
    const ok = await sendEmail(row.email, row.user_id);
    if (!ok) {
      failures.push({ user_id: row.user_id, reason: "resend_send_failed" });
      continue;
    }
    sent++;
    await new Promise((r) => setTimeout(r, 300));
  }

  // user_id only in the response, never an address: this body lands in net._http_response.
  return new Response(
    JSON.stringify({ candidates: targets.length, sent, failures }),
    { headers: { "Content-Type": "application/json" } },
  );
});
