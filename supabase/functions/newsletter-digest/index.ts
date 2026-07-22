/**
 * newsletter-digest
 *
 * Called by pg_cron weekly on Mondays (see 20260722_newsletter_digest_cron.sql).
 * Pulls the last 7 days of posts from https://treforged.com/feed.xml, then emails a
 * branded digest to every row in public.newsletter_subscribers via Resend. Links
 * carry utm_source=newsletter, and every message includes a mailto List-Unsubscribe
 * header. Secured by the CRON_SECRET header — no user JWT required.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DIGEST_FROM = Deno.env.get("NEWSLETTER_FROM") ?? "Forgenta <noreply@treforged.com>";
const UNSUBSCRIBE_MAILTO = Deno.env.get("NEWSLETTER_UNSUBSCRIBE") ?? "contact@treforged.com";
const FEED_URL = "https://treforged.com/feed.xml";
const WINDOW_DAYS = 7;
const BATCH_SIZE = 100; // Resend /emails/batch hard limit.

interface Post {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fieldOf(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function parseFeed(xml: string): Post[] {
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

function withUtm(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=newsletter&utm_medium=email&utm_campaign=weekly_digest`;
}

function buildDigestHtml(posts: Post[]): string {
  const rows = posts
    .map((p) => {
      const date = p.pubDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `<div style="padding:20px 0;border-bottom:1px solid #f1f5f9">
        <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8">${esc(date)}</p>
        <a href="${esc(withUtm(p.link))}" style="font-size:17px;font-weight:600;color:#0f172a;text-decoration:none">${esc(p.title)}</a>
        ${p.description ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#475569">${esc(p.description)}</p>` : ""}
        <a href="${esc(withUtm(p.link))}" style="display:inline-block;margin-top:10px;font-size:13px;font-weight:600;color:#4f46e5;text-decoration:none">Read more &rarr;</a>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f4f5;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <div style="background:#0f172a;padding:24px 32px">
        <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-.5px">Forgenta</span>
        <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">This week in personal finance</p>
      </div>
      <div style="padding:8px 32px 24px">
        ${rows}
      </div>
      <div style="padding:20px 32px;border-top:1px solid #f1f5f9;background:#fafafa">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">You're receiving this because you subscribed at treforged.com.<br>
        To unsubscribe, reply to this email or write to <a href="mailto:${esc(UNSUBSCRIBE_MAILTO)}?subject=unsubscribe" style="color:#64748b">${esc(UNSUBSCRIBE_MAILTO)}</a>.</p>
      </div>
    </div>
  </body></html>`;
}

async function sendBatch(
  recipients: string[],
  subject: string,
  html: string,
): Promise<number> {
  let ok = 0;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((email) => ({
      from: DIGEST_FROM,
      to: [email],
      subject,
      html,
      headers: {
        "List-Unsubscribe": `<mailto:${UNSUBSCRIBE_MAILTO}?subject=unsubscribe>`,
      },
    }));
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) ok += chunk.length;
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return ok;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  // 1. Pull and filter the feed to the last 7 days.
  let posts: Post[];
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`feed fetch ${res.status}`);
    const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
    posts = parseFeed(await res.text())
      .filter((p) => p.pubDate.getTime() >= cutoff)
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `feed_error: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 502 },
    );
  }

  if (posts.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, message: "No posts in the last 7 days — digest skipped." }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // 2. Read subscribers (service role bypasses the INSERT-only RLS).
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: subs, error } = await supabase
    .from("newsletter_subscribers")
    .select("email");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const recipients = [
    ...new Set(
      (subs ?? [])
        .map((s: { email: string }) => s.email?.trim().toLowerCase())
        .filter((e): e is string => !!e),
    ),
  ];
  if (recipients.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, message: "No subscribers." }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // 3. Build and send.
  const subject = posts.length === 1
    ? `Forgenta: ${posts[0].title}`
    : `Forgenta: ${posts.length} new reads this week`;
  const html = buildDigestHtml(posts);
  const sent = await sendBatch(recipients, subject, html);

  return new Response(
    JSON.stringify({ posts: posts.length, subscribers: recipients.length, sent }),
    { headers: { "Content-Type": "application/json" } },
  );
});
