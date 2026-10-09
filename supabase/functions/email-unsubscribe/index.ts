/**
 * email-unsubscribe - the one-click unsubscribe behind every user email (proposal C, 2026-10-09).
 *
 * GET  -> a page with one "Unsubscribe" button. Writes NOTHING: mail scanners and link previews
 *         follow links, and a GET that unsubscribed would act on nobody's choice.
 * POST -> verifies the HMAC link and sets profiles.email_unsubscribed_at. This is also what Gmail
 *         and Apple Mail send for RFC 8058 one-click (`List-Unsubscribe=One-Click`), so their own
 *         Unsubscribe button works without the person opening anything.
 *
 * `verify_jwt = false` (supabase/config.toml): the person may never have signed in on the device
 * they read email on. Identity is the signed link; rules in _shared/email-unsubscribe.ts.
 * Responses name no email address and say nothing about whether an id exists.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  confirmPageHtml,
  doneHtml,
  invalidLinkHtml,
  unsubscribeActionFor,
  verifyUnsubscribe,
} from "../_shared/email-unsubscribe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONTACT = "contact@treforged.com";

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      // The URL carries a credential. Keep it out of shared caches.
      "Cache-Control": "no-store",
    },
  });

Deno.serve(async (req) => {
  const action = unsubscribeActionFor(req.method);
  if (action === "not_allowed") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const userId = await verifyUnsubscribe(
    url.searchParams.get("u"),
    url.searchParams.get("t"),
    Deno.env.get("EMAIL_UNSUBSCRIBE_SECRET"),
  );
  if (!userId) return html(invalidLinkHtml(CONTACT), 400);

  if (action === "confirm_page") {
    // The public URL, not req.url: inside the edge runtime req.url can be the internal address.
    const self = `${SUPABASE_URL}/functions/v1/email-unsubscribe?u=${encodeURIComponent(userId)}&t=${url.searchParams.get("t")}`;
    return html(confirmPageHtml(self));
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // Keeps the FIRST unsubscribe time: a second press is a no-op, not a new date.
  const { error } = await db
    .from("profiles")
    .update({ email_unsubscribed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("email_unsubscribed_at", null);
  if (error) {
    console.error("email-unsubscribe: update failed:", error.message);
    return html(invalidLinkHtml(CONTACT), 500);
  }
  return html(doneHtml(CONTACT));
});
