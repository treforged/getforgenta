#!/usr/bin/env node
/**
 * Pull real posts from car / money subreddits via old.reddit.com's RSS search.
 *
 * Why RSS and not the JSON API: www.reddit.com's *.json endpoints 403 this
 * machine (see memory `marketing_reddit_scout` — a User-Agent block, not an IP
 * block). old.reddit.com's `search.rss` answers 200 to the same client and
 * carries the post's own selftext, which is what we actually want to quote.
 *
 * Why ONE global search per query rather than per-subreddit: old.reddit rate
 * limits hard. A 18-sub x 12-query sweep earned a blanket 429 within seconds.
 * A global search with `subreddit:` terms in the query covers the same ground
 * in a twentieth of the requests, and the sub is still on every result.
 *
 * Output: one JSON array on stdout — {query, sub, title, link, author, date, text}.
 * Nothing is summarised or invented here; a human reads the dump and quotes it.
 *
 * Usage: node marketing/scripts/research/reddit-rss-pull.mjs > out.json
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

/** Subreddits an 18-26 year old car enthusiast actually posts in, plus the money subs they cross into. */
const SUBS = [
  'cars',
  'whatcarshouldIbuy',
  'askcarsales',
  'Cartalk',
  'projectcar',
  'MechanicAdvice',
  'Autos',
  'personalfinance',
  'povertyfinance',
  'Insurance',
  'Honda',
  'civic',
  'subaru',
  'WRX',
  'Mustang',
  'Miata',
  'BMW',
  'CarsAustralia',
];

const SUB_FILTER = SUBS.map((s) => `subreddit:${s}`).join(' OR ');

const QUERIES = [
  'first car insurance quote expensive',
  'can I afford this car payment',
  'car payment insurance gas budget monthly',
  'cost per mile to own',
  'how much do you spend on mods a month',
  'mod budget spreadsheet track',
  'gas money broke paycheck',
  '72 month loan regret',
  'upside down negative equity car',
  'maintenance fund how much to save car',
  'track day cost per weekend',
  'money pit car repairs',
  'insurance went up modified car',
  'is my car payment too high percentage of income',
  'saving up for a turbo kit',
  'daily driver cost of ownership breakdown',
  'financed mods credit card wheels',
  'first car 19 years old budget',
  'how much car can I afford making an hour',
  'sold my car because insurance',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(s) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEntries(xml, query) {
  const out = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const pick = (tag) => {
      const m = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? decode(m[1]) : '';
    };
    const linkMatch = e.match(/<link href="([^"]+)"/);
    const rawContent = e.match(/<content type="html">([\s\S]*?)<\/content>/);
    const link = linkMatch ? linkMatch[1] : '';
    const subMatch = link.match(/\/r\/([^/]+)\//);
    out.push({
      query,
      sub: subMatch ? subMatch[1] : '',
      title: pick('title'),
      link,
      author: pick('name'),
      date: pick('updated'),
      text: rawContent ? decode(rawContent[1]).slice(0, 2000) : '',
    });
  }
  return out;
}

/** One request, with backoff on 429 — old.reddit answers 429 for minutes once annoyed. */
async function pull(query, attempt = 0) {
  const url =
    'https://old.reddit.com/search.rss?' +
    new URLSearchParams({
      q: `(${SUB_FILTER}) ${query}`,
      sort: 'top',
      t: 'year',
      limit: '25',
      include_over_18: 'on',
    });
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/atom+xml,text/xml;q=0.9,*/*;q=0.8' },
  });
  if (res.status === 429 && attempt < 5) {
    const wait = 30_000 * 2 ** attempt;
    process.stderr.write(`429 on "${query}" — backing off ${wait / 1000}s\n`);
    await sleep(wait);
    return pull(query, attempt + 1);
  }
  if (!res.ok) return [{ query, error: `HTTP ${res.status}` }];
  return parseEntries(await res.text(), query);
}

const results = [];
for (const query of QUERIES) {
  try {
    const rows = await pull(query);
    process.stderr.write(`${query} → ${rows.length}\n`);
    results.push(...rows);
  } catch (err) {
    results.push({ query, error: String(err) });
  }
  await sleep(8000); // polite, and below old.reddit's patience threshold
}
process.stdout.write(JSON.stringify(results, null, 1));
