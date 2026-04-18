import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "public", "screenshots");
const W = 393; const H = 852;

async function wait(page, ms = 1500) { await page.waitForTimeout(ms); }

async function dismiss2FA(page) {
  try {
    if (await page.locator(':text("Your account has no two-factor")').isVisible({ timeout: 1000 })) {
      // The X button is the last button in the banner's right flex container
      await page.evaluate(() => {
        const banners = document.querySelectorAll('[class*="amber"]');
        banners.forEach(el => {
          const btn = el.querySelector('button');
          if (btn) btn.click();
        });
      });
      await wait(page, 400);
    }
  } catch {}
}

// Dismiss any Sonner toasts that block pointer events
async function dismissToasts(page) {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('[data-sonner-toast]').forEach(el => el.remove());
    });
    await page.waitForTimeout(200);
  } catch {}
}

// Nav tabs: Home/Txns/Budget/Debt are <a> links, More is a <button>
async function clickTab(page, tabName) {
  await dismissToasts(page);
  if (tabName === "More") {
    await page.locator('button:has-text("More")').last().click({ force: true });
  } else {
    // Use evaluate to directly trigger navigation — bypasses any overlay elements
    const href = { Home: '/dashboard', Txns: '/transactions', Budget: '/budget', Debt: '/debt' }[tabName];
    if (href) {
      await page.evaluate((h) => {
        const link = Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') === h);
        if (link) link.click();
      }, href);
    }
  }
  await wait(page, 2500);
}

async function openMoreAndClick(page, itemText) {
  await dismissToasts(page);
  // Open More sheet
  await page.locator('button:has-text("More")').last().click({ force: true });
  await wait(page, 1200);
  // Navigate to the item using evaluate to find and click the link by its text
  const found = await page.evaluate((text) => {
    const links = Array.from(document.querySelectorAll('a, button'));
    const match = links.find(el => el.textContent?.trim() === text || el.textContent?.trim().startsWith(text));
    if (match) { match.click(); return true; }
    return false;
  }, itemText);
  if (!found) console.log(`  ⚠ Could not find "${itemText}" in More sheet`);
  await wait(page, 2500);
}

async function shot(page, name) {
  await dismiss2FA(page);
  await wait(page, 500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false, clip: { x:0, y:0, width:W, height:H } });
  console.log(`  ✓ ${name}.png`);
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  // Login
  console.log("Logging in...");
  await page.goto("https://app.treforged.com/auth", { waitUntil: "networkidle" });
  await wait(page, 1500);
  try { const b = page.locator('button:has-text("Accept all")'); if (await b.isVisible({timeout:1200})) { await b.click(); await wait(page,500); } } catch {}
  await page.fill('input[type="email"]', "reviewer@treforged.com");
  await page.fill('input[type="password"]', "[REDACTED]");
  await page.click('button[type="submit"]');
  await wait(page, 4000);

  // Skip onboarding
  try { const s = page.locator('text=Skip setup'); if (await s.isVisible({timeout:2000})) { await s.click(); await wait(page,2000); } } catch {}
  if (page.url().includes("onboarding")) {
    await page.goto("https://app.treforged.com/dashboard", { waitUntil: "networkidle" });
    await wait(page, 2000);
  }
  // Mark onboarding done in localStorage
  await page.evaluate(() => {
    Object.keys(localStorage).forEach(k => {
      try {
        const v = JSON.parse(localStorage.getItem(k) || '{}');
        const uid = v?.user?.id || v?.session?.user?.id;
        if (uid) localStorage.setItem(`forged:onboarding_done_${uid}`, '1');
      } catch {}
    });
  });
  await dismiss2FA(page);

  // 1. Dashboard
  console.log("Capturing dashboard...");
  await clickTab(page, "Home");
  await shot(page, "dashboard");

  // 2. Transactions
  console.log("Capturing transactions...");
  await clickTab(page, "Txns");
  await shot(page, "transactions");

  // 3. Budget
  console.log("Capturing budget...");
  await clickTab(page, "Budget");
  await shot(page, "budget");

  // 4. Debt
  console.log("Capturing debt payoff...");
  await clickTab(page, "Debt");
  await shot(page, "debt");

  // 5. Savings
  console.log("Capturing savings...");
  await openMoreAndClick(page, "Savings");
  await shot(page, "savings");

  // 6. Forecast
  console.log("Capturing forecast...");
  await openMoreAndClick(page, "Forecast");
  await shot(page, "forecast");

  // 7. Net Worth
  console.log("Capturing networth...");
  await openMoreAndClick(page, "Net Worth");
  await shot(page, "networth");

  // 8. AI Advisor — wait for initial analysis to load
  console.log("Capturing ai-advisor...");
  await openMoreAndClick(page, "AI");
  await wait(page, 5000); // wait for AI analysis to complete
  await shot(page, "ai-advisor");

  await browser.close();
  console.log("\nAll screenshots captured!");
}

run().catch(e => { console.error(e); process.exit(1); });
