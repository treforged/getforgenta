/**
 * The weekly email, as pure functions (proposal C, 2026-10-09; recommendation in
 * docs/retention-recommendation-2026-09-10.md).
 *
 * It used to go only to public.newsletter_subscribers, which held one row, while every confirmed
 * app user got nothing. Now each confirmed app user gets a body about THEIR account, and the blog
 * posts ride along when there are any. Newsletter subscribers who are not app users keep the blog
 * digest they signed up for.
 *
 * Three rules, each asserted in weekly-digest.test.ts:
 *  1. NOTHING IS SENT unless the request says `?dry_run=0` (same opt-in as push-send). A missing,
 *     empty or mistyped value is a dry run.
 *  2. An unsubscribed user is never in the send list, on either audience.
 *  3. A number is only shown with its date, and only while fresh. A stale Safe to Spend figure in an
 *     inbox cannot show itself as stale the way the app can, so it is left out instead.
 */

import { listUnsubscribeHeaders } from "./email-unsubscribe.ts";

export interface Post {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
}

/** One row of public.get_weekly_digest_recipients(). */
export interface DigestRecipient {
  user_id: string;
  email: string;
  display_name: string | null;
  timezone: string | null;
  /** Set once the person pressed unsubscribe. Such a row is never sent anything. */
  unsubscribed: boolean;
  has_income: boolean;
  /** Ledger entries the user saved in the last 7 days. */
  entries_7d: number;
  sts_amount_cents: number | null;
  sts_payday: string | null;
  sts_computed_at: string | null;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  /** user_id for app users, null for a newsletter-only subscriber. Never an address. */
  user_id: string | null;
}

/** A runaway recipient query must not become a mass mailing. */
export const MAX_RECIPIENTS_PER_RUN = 200;
/** Older than this, a Safe to Spend figure is left out of the email. */
export const STS_FRESH_HOURS = 72;
const WINDOW_DAYS = 7;

export function isDryRun(url: URL): boolean {
  // ⚠️ Opt IN to sending. Anything other than an explicit "0" is a dry run.
  return url.searchParams.get("dry_run") !== "0";
}

/** Config a REAL send needs. A dry run reports these instead of failing. */
export function sendBlockers(env: Record<string, string | undefined>): string[] {
  return ["RESEND_API_KEY", "EMAIL_UNSUBSCRIBE_SECRET", "EMAIL_POSTAL_ADDRESS"].filter((k) => !env[k]?.trim());
}

// ---------------------------------------------------------------------------------------------
// Feed

function fieldOf(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

export function parseFeed(xml: string): Post[] {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const posts: Post[] = [];
  for (const b of blocks) {
    const link = fieldOf(b, "link");
    const title = fieldOf(b, "title");
    const rawDate = fieldOf(b, "pubDate");
    if (!link || !title || !rawDate) continue;
    const pubDate = new Date(rawDate);
    if (isNaN(pubDate.getTime())) continue;
    posts.push({ title, link, description: fieldOf(b, "description"), pubDate });
  }
  return posts;
}

export function recentPosts(posts: Post[], now: Date): Post[] {
  const cutoff = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return posts
    .filter((p) => p.pubDate.getTime() >= cutoff)
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
}

// ---------------------------------------------------------------------------------------------
// Formatting

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeZone(tz: string | null): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** YYYY-MM-DD for `now` in the user's zone (the server runs in UTC). */
export function localDateIn(now: Date, tz: string | null): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(tz), year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Both fraction-digit bounds named on purpose: ICU builds disagree otherwise (CLAUDE.md). */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** A calendar date ('2026-10-16') as "Fri, Oct 16", with no zone shift. */
export function formatCalendarDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function formatInstantDate(iso: string, tz: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(tz), month: "short", day: "numeric",
  }).format(new Date(iso));
}

function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0] ?? "";
  // A display name is user text; keep it short and printable before it reaches a greeting.
  const clean = first.replace(/[^\p{L}\p{M}'-]/gu, "").slice(0, 40);
  return clean || null;
}

/**
 * The Safe to Spend figure, or null when it should not be shown: no snapshot, computed more than
 * STS_FRESH_HOURS ago, or its payday has already passed in the user's zone.
 */
export function freshSafeToSpend(
  r: Pick<DigestRecipient, "sts_amount_cents" | "sts_payday" | "sts_computed_at" | "timezone">,
  now: Date,
): { amountCents: number; payday: string; asOf: string } | null {
  if (r.sts_amount_cents === null || !r.sts_payday || !r.sts_computed_at) return null;
  const computed = new Date(r.sts_computed_at).getTime();
  if (isNaN(computed)) return null;
  const ageHours = (now.getTime() - computed) / 3_600_000;
  if (ageHours < 0 || ageHours > STS_FRESH_HOURS) return null;
  if (r.sts_payday < localDateIn(now, r.timezone)) return null;
  return {
    amountCents: r.sts_amount_cents,
    payday: r.sts_payday,
    asOf: formatInstantDate(r.sts_computed_at, r.timezone),
  };
}

function withUtm(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=newsletter&utm_medium=email&utm_campaign=weekly_digest`;
}

// ---------------------------------------------------------------------------------------------
// Bodies

interface Paragraph {
  text: string;
  link?: { label: string; url: string };
}

export interface FooterInput {
  reason: string;
  unsubscribeUrl: string | null;
  unsubscribeMailto: string;
  postalAddress: string;
}

function footerLines(f: FooterInput): string[] {
  return [
    f.reason,
    f.unsubscribeUrl
      ? `Unsubscribe in one click: ${f.unsubscribeUrl}`
      : `To unsubscribe, reply with "unsubscribe" or write to ${f.unsubscribeMailto}.`,
    "TRE Forged LLC",
    f.postalAddress,
  ];
}

function render(subject: string, greeting: string, paras: Paragraph[], posts: Post[], footer: FooterInput) {
  const text = [
    greeting,
    "",
    ...paras.flatMap((p) => [p.link ? `${p.text}\n${p.link.label}: ${p.link.url}` : p.text, ""]),
    ...(posts.length
      ? ["From the blog this week:", ...posts.map((p) => `- ${p.title}: ${withUtm(p.link)}`), ""]
      : []),
    "---",
    ...footerLines(footer),
  ].join("\n");

  const parasHtml = paras
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${esc(p.text)}${
      p.link
        ? `<br><a href="${esc(p.link.url)}" style="display:inline-block;margin-top:8px;font-weight:600;color:#4f46e5;text-decoration:none">${esc(p.link.label)} &rarr;</a>`
        : ""
    }</p>`)
    .join("");
  const postsHtml = posts.length
    ? `<p style="margin:24px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8">From the blog this week</p>${
      posts.map((p) => `<p style="margin:8px 0"><a href="${esc(withUtm(p.link))}" style="font-size:15px;font-weight:600;color:#0f172a;text-decoration:none">${esc(p.title)}</a></p>`).join("")
    }`
    : "";
  const unsub = footer.unsubscribeUrl
    ? `<a href="${esc(footer.unsubscribeUrl)}" style="color:#64748b">Unsubscribe in one click</a>`
    : `To unsubscribe, reply with "unsubscribe" or write to <a href="mailto:${esc(footer.unsubscribeMailto)}?subject=unsubscribe" style="color:#64748b">${esc(footer.unsubscribeMailto)}</a>.`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f4f5;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="background:#0f172a;padding:24px 32px"><span style="color:#fff;font-size:20px;font-weight:700">Forgenta</span></div>
<div style="padding:24px 32px">
<p style="margin:0 0 16px;font-size:15px;color:#334155">${esc(greeting)}</p>${parasHtml}${postsHtml}
</div>
<div style="padding:20px 32px;border-top:1px solid #f1f5f9;background:#fafafa">
<p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">${esc(footer.reason)}<br>${unsub}<br>TRE Forged LLC<br>${esc(footer.postalAddress)}</p>
</div></div></body></html>`;

  return { subject, text, html };
}

export interface UserBodyContext {
  appUrl: string;
  now: Date;
  posts: Post[];
  footer: FooterInput;
}

/** The per-user email. Every figure in it is the user's own, and dated. */
export function buildUserDigest(r: DigestRecipient, ctx: UserBodyContext) {
  const name = firstName(r.display_name);
  const greeting = name ? `Hi ${name},` : "Hi,";
  const app = ctx.appUrl.replace(/\/+$/, "");
  const quickAdd = withUtm(`${app}/dashboard?quickadd=1`);
  const home = withUtm(`${app}/dashboard`);
  const paras: Paragraph[] = [];

  const sts = freshSafeToSpend(r, ctx.now);
  if (sts) {
    paras.push({
      text: `Safe to spend until ${formatCalendarDate(sts.payday)}: ${formatCents(sts.amountCents)} (as of ${sts.asOf}).`,
      link: { label: "See how it adds up", url: home },
    });
  } else if (r.has_income) {
    paras.push({ text: "Open Forgenta to see what is safe to spend before your next payday.", link: { label: "Open Forgenta", url: home } });
  } else {
    paras.push({
      text: "Add how much you get paid and Forgenta shows what is safe to spend before your next payday. It takes about a minute.",
      link: { label: "Add your pay", url: home },
    });
  }

  if (r.entries_7d > 0) {
    paras.push({ text: `You saved ${r.entries_7d} ${r.entries_7d === 1 ? "entry" : "entries"} in the last 7 days.` });
  } else {
    paras.push({
      text: "Nothing saved this week. Log one purchase with the + at the bottom of the screen: about five taps.",
      link: { label: "Add a purchase", url: quickAdd },
    });
  }

  return render("Your week in Forgenta", greeting, paras, ctx.posts, ctx.footer);
}

/** The blog digest for a newsletter subscriber who is not an app user (unchanged audience). */
export function buildSubscriberDigest(posts: Post[], footer: FooterInput) {
  const subject = posts.length === 1 ? `Forgenta: ${posts[0].title}` : `Forgenta: ${posts.length} new reads this week`;
  return render(subject, "Hi,", [], posts, footer);
}

// ---------------------------------------------------------------------------------------------
// The run

export interface DigestDeps {
  now: Date;
  appUrl: string;
  postalAddress: string;
  unsubscribeMailto: string;
  loadRecipients: () => Promise<DigestRecipient[]>;
  loadSubscriberEmails: () => Promise<string[]>;
  loadPosts: () => Promise<Post[]>;
  /** Signs the one-click link. Only called when a real send is going to happen. */
  unsubscribeUrlFor: (userId: string) => Promise<string>;
  /** Sends; returns how many were accepted. Never called on a dry run. */
  send: (emails: OutgoingEmail[]) => Promise<number>;
}

export interface DigestResult {
  dry_run: boolean;
  status: "ok" | "blocked" | "too_many";
  app_users: number;
  unsubscribed_skipped: number;
  subscribers: number;
  posts: number;
  with_safe_to_spend: number;
  would_send: number;
  sent: number;
  blockers: string[];
}

/**
 * Decide who gets what, then send only if asked to. The result carries counts, never an address:
 * it lands in net._http_response.
 */
export async function runDigest(deps: DigestDeps, opts: { dryRun: boolean; blockers: string[] }): Promise<DigestResult> {
  const [recipients, subscriberEmails, allPosts] = await Promise.all([
    deps.loadRecipients(),
    deps.loadSubscriberEmails(),
    deps.loadPosts(),
  ]);
  const posts = recentPosts(allPosts, deps.now);

  const norm = (e: string) => e.trim().toLowerCase();
  // EVERY app user's address, unsubscribed ones included: someone who unsubscribed from the app
  // email is not re-mailed through the newsletter list either.
  const appEmails = new Set(recipients.map((r) => norm(r.email)));
  const active = recipients.filter((r) => !r.unsubscribed && r.email);
  const subscribers = posts.length
    ? [...new Set(subscriberEmails.map(norm).filter((e) => e && !appEmails.has(e)))]
    : [];

  const base = {
    dry_run: opts.dryRun,
    app_users: active.length,
    unsubscribed_skipped: recipients.length - active.length,
    subscribers: subscribers.length,
    posts: posts.length,
    with_safe_to_spend: active.filter((r) => freshSafeToSpend(r, deps.now) !== null).length,
    would_send: active.length + subscribers.length,
    sent: 0,
    blockers: opts.blockers,
  };

  if (base.would_send > MAX_RECIPIENTS_PER_RUN) return { ...base, status: "too_many" };
  if (opts.dryRun) return { ...base, status: "ok" };
  if (opts.blockers.length) return { ...base, status: "blocked" };

  const emails: OutgoingEmail[] = [];
  for (const r of active) {
    const url = await deps.unsubscribeUrlFor(r.user_id);
    const body = buildUserDigest(r, {
      appUrl: deps.appUrl,
      now: deps.now,
      posts,
      footer: {
        reason: "You get this weekly email because you have a Forgenta account.",
        unsubscribeUrl: url,
        unsubscribeMailto: deps.unsubscribeMailto,
        postalAddress: deps.postalAddress,
      },
    });
    emails.push({
      to: r.email,
      ...body,
      headers: listUnsubscribeHeaders(url, deps.unsubscribeMailto),
      user_id: r.user_id,
    });
  }
  const subscriberBody = buildSubscriberDigest(posts, {
    reason: "You get this because you subscribed at treforged.com.",
    unsubscribeUrl: null,
    unsubscribeMailto: deps.unsubscribeMailto,
    postalAddress: deps.postalAddress,
  });
  for (const to of subscribers) {
    emails.push({
      to,
      ...subscriberBody,
      headers: { "List-Unsubscribe": `<mailto:${deps.unsubscribeMailto}?subject=unsubscribe>` },
      user_id: null,
    });
  }

  const sent = await deps.send(emails);
  return { ...base, status: "ok", sent };
}

