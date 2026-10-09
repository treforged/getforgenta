/**
 * newsletter-digest
 *
 * Called by pg_cron weekly on Mondays (see 20260722_newsletter_digest_cron.sql). Secured by the
 * CRON_SECRET header - no user JWT required.
 *
 * Since 2026-10-09 (proposal C) it writes to every confirmed app user with a body about their own
 * account, plus the last 7 days of https://treforged.com/feed.xml when there are posts. Newsletter
 * subscribers who are not app users keep the blog-only digest. Rules: _shared/weekly-digest.ts.
 *
 * ⚠️ DRY RUN BY DEFAULT. Nothing is sent unless the URL carries `?dry_run=0`. The existing cron
 * calls this without it, so after a deploy the Monday run only REPORTS who would get what. A real
 * send also needs EMAIL_UNSUBSCRIBE_SECRET and EMAIL_POSTAL_ADDRESS set; without them it refuses
 * and says which is missing. The response carries counts, never an address.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cronSecretMatches } from "../_shared/plaid-webhook-register.ts";
import { unsubscribeUrl } from "../_shared/email-unsubscribe.ts";
import {
  isDryRun,
  parseFeed,
  runDigest,
  sendBlockers,
  type DigestRecipient,
  type OutgoingEmail,
} from "../_shared/weekly-digest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DIGEST_FROM = Deno.env.get("NEWSLETTER_FROM") ?? "Forgenta <noreply@treforged.com>";
const UNSUBSCRIBE_MAILTO = Deno.env.get("NEWSLETTER_UNSUBSCRIBE") ?? "contact@treforged.com";
const APP_URL = Deno.env.get("APP_URL") ?? "https://getforgenta.com";
const FEED_URL = "https://treforged.com/feed.xml";
const BATCH_SIZE = 100; // Resend /emails/batch hard limit.

async function sendBatches(apiKey: string, emails: OutgoingEmail[]): Promise<number> {
  let ok = 0;
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const chunk = emails.slice(i, i + BATCH_SIZE);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(chunk.map((e) => ({
        from: DIGEST_FROM,
        to: [e.to],
        reply_to: UNSUBSCRIBE_MAILTO,
        subject: e.subject,
        text: e.text,
        html: e.html,
        headers: e.headers,
        tags: [{ name: "campaign", value: e.user_id ? "weekly-user" : "weekly-newsletter" }],
      }))),
    });
    if (res.ok) ok += chunk.length;
    if (i + BATCH_SIZE < emails.length) await new Promise((r) => setTimeout(r, 500));
  }
  return ok;
}

Deno.serve(async (req) => {
  // Constant-time compare; an unset CRON_SECRET never authorises (security review db1d6813).
  if (!cronSecretMatches(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const dryRun = isDryRun(new URL(req.url));
  const env = {
    RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
    EMAIL_UNSUBSCRIBE_SECRET: Deno.env.get("EMAIL_UNSUBSCRIBE_SECRET"),
    EMAIL_POSTAL_ADDRESS: Deno.env.get("EMAIL_POSTAL_ADDRESS"),
  };
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const result = await runDigest({
      now: new Date(),
      appUrl: APP_URL,
      postalAddress: env.EMAIL_POSTAL_ADDRESS ?? "",
      unsubscribeMailto: UNSUBSCRIBE_MAILTO,
      loadRecipients: async () => {
        const { data, error } = await db.rpc("get_weekly_digest_recipients");
        if (error) throw new Error(`recipients: ${error.message}`);
        return (data ?? []) as DigestRecipient[];
      },
      loadSubscriberEmails: async () => {
        // Service role bypasses the INSERT-only RLS.
        const { data, error } = await db.from("newsletter_subscribers").select("email");
        if (error) throw new Error(`subscribers: ${error.message}`);
        return (data ?? []).map((s: { email: string | null }) => s.email ?? "");
      },
      loadPosts: async () => {
        // The feed is optional now: a feed outage costs the blog section, not the user email.
        try {
          const res = await fetch(FEED_URL);
          return res.ok ? parseFeed(await res.text()) : [];
        } catch {
          return [];
        }
      },
      unsubscribeUrlFor: (userId) =>
        unsubscribeUrl(`${SUPABASE_URL}/functions/v1`, userId, env.EMAIL_UNSUBSCRIBE_SECRET!),
      send: (emails) => sendBatches(env.RESEND_API_KEY!, emails),
    }, { dryRun, blockers: sendBlockers(env) });

    const status = result.status === "ok" ? 200 : 409;
    return new Response(JSON.stringify(result), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
