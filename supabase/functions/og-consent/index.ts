/**
 * og-consent — the web page where an OG confirms or declines the move to Stripe.
 *
 * ⛔ WHY THIS IS A SERVER-RENDERED PAGE AND NOT A ROUTE IN THE REACT APP. The ask
 * goes by EMAIL and the confirmation happens on the WEB, never in the app and
 * never behind a link in the app — that is the App Store anti-steering line and
 * it is what keeps this whole flow outside store payment rules
 * (docs/og-cohort.md). The React app is bundled into the Capacitor mobile app,
 * so a route added there would SHIP INSIDE THE APP whether or not anything links
 * to it. Rendering here keeps the page out of that bundle entirely. Moving it
 * into the app later is a regression, not a simplification.
 *
 * `verify_jwt = false`: the person opening this link may be on a device where
 * they have never signed in, and requiring a login to accept a gift is how a
 * promise goes unclaimed. Identity comes from the single-use hashed token in the
 * URL — see `_shared/og-consent-token.ts` for the rules and why each one exists.
 *
 * TWO THINGS THIS FILE MUST NEVER DO:
 *
 *  1. **Record consent on a GET.** docs/og-cohort.md: "consent is never inferred
 *     from clicking a link in an email." Opening the page is not agreeing. A GET
 *     renders and writes nothing; only the POST from a pressed button records.
 *     Mail scanners and link-preview bots follow links, so a GET that recorded
 *     would manufacture consent nobody gave.
 *  2. **Render today's copy.** The page shows the version the LINK was issued
 *     for. If the wording is superseded before they answer, showing the new text
 *     would have them confirm something they were never sent.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  hashConsentToken, verifyConsentToken, tokenFailureMessage,
} from "../_shared/og-consent-token.ts";
import type { ConsentTokenRow } from "../_shared/og-consent-token.ts";
import { consentByVersion, buildConsentRow } from "../_shared/og-consent-text.ts";
import { consentPage, noticePage, outcomeMessage } from "../_shared/og-consent-page.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // A page that can change billing must not be framed by anything.
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      // The URL carries a credential. Keep it out of shared caches.
      "Cache-Control": "no-store",
    },
  });

const notice = (title: string, message: string, status = 200) =>
  html(noticePage(title, message), status);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("t") ?? "";
  if (!raw) return notice("Forgenta", tokenFailureMessage("unknown"), 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const tokenHash = await hashConsentToken(raw);

  const { data: rows, error } = await db
    .from("og_consent_tokens")
    .select("user_id, consent_version, expires_at, used_at")
    .eq("token_sha256", tokenHash)
    .limit(1);

  // A read failure is NOT an invalid token. Telling someone their link is dead
  // because the database hiccupped is how a real consent gets lost; say the true
  // thing instead and let them try again.
  if (error) {
    console.error("og-consent: token lookup failed:", error.message);
    return notice(
      "Something went wrong",
      "We could not check your link just now. Nothing has changed about your subscription — "
      + "please try again in a few minutes.",
      503,
    );
  }

  const verdict = verifyConsentToken((rows?.[0] as ConsentTokenRow | undefined) ?? null, new Date());
  if (!verdict.ok) return notice("Forgenta", tokenFailureMessage(verdict.reason), 410);

  // The version the LINK was issued for, never CURRENT_CONSENT.
  const copy = consentByVersion(verdict.consent_version);
  if (!copy) {
    // A version that no longer exists in code. `CONSENT_VERSIONS` is append-only
    // precisely so this cannot happen; if it does, refusing is the only honest
    // move — we cannot show them what they were sent.
    console.error("og-consent: unknown consent version", verdict.consent_version);
    return notice(
      "Something went wrong",
      "We could not load the exact wording this link was sent with, and we will not ask you to "
      + "agree to anything else. Nothing has changed about your subscription — please reply to "
      + "the email we sent.",
      500,
    );
  }

  if (req.method === "GET") {
    // RENDERS ONLY. Nothing is written on a GET — see the header comment.
    return html(consentPage(copy, url.pathname, raw));
  }

  if (req.method !== "POST") {
    return notice("Forgenta", "Unsupported request.", 405);
  }

  const form = await req.formData();
  const decision = String(form.get("decision") ?? "");
  if (decision !== "confirmed" && decision !== "declined") {
    return notice("Forgenta", "That did not look like a choice. Please open the link again.", 400);
  }

  // ── Record it. ORDER MATTERS. ──────────────────────────────────────────────
  // The token is spent FIRST, under a condition that only matches a token still
  // unused. Two presses of the same button — a double-tap, a retried request —
  // then produce one row rather than two conflicting ones. If the evidence
  // insert fails afterwards we have burnt a link and recorded nothing, which is
  // recoverable by resending; the reverse order risks recording twice, which is
  // not recoverable at all in an append-only table.
  const spentAt = new Date().toISOString();
  const { data: spent, error: spendErr } = await db
    .from("og_consent_tokens")
    .update({ used_at: spentAt })
    .eq("token_sha256", tokenHash)
    .is("used_at", null)
    .select("user_id");
  if (spendErr) {
    console.error("og-consent: could not spend token:", spendErr.message);
    return notice("Something went wrong", "We could not record your answer just now. Nothing has "
      + "changed about your subscription — please try again in a few minutes.", 503);
  }
  if (!spent || spent.length === 0) {
    // Somebody else got there first — almost always the same person pressing twice.
    return notice("Forgenta", tokenFailureMessage("already_used"));
  }

  const row = await buildConsentRow(verdict.user_id, decision, copy, "web");
  const { error: insErr } = await db.from("og_billing_consent").insert({
    ...row,
    // Best-effort provenance. Nullable on purpose: a missing IP must never be a
    // reason to refuse a consent the person genuinely gave.
    ip_address: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
    user_agent: req.headers.get("user-agent"),
  });
  if (insErr) {
    // Loud, because this is the compliance artefact itself. The token is already
    // spent, so the recovery is a resend rather than a retry of this request.
    console.error("og-consent: CONSENT ROW INSERT FAILED for", verdict.user_id, insErr.message);
    return notice("Something went wrong", "We could not save your answer. Nothing has changed "
      + "about your subscription — please reply to the email we sent so we can sort it out.", 500);
  }

  const outcome = outcomeMessage(decision);
  return notice(outcome.title, outcome.message);
});
