/**
 * plaid-sync-all
 *
 * Called by pg_cron daily at 8am EST (13:00 UTC) / 8am EDT (12:00 UTC).
 * Syncs Plaid balances for ALL premium users who have linked items.
 * Secured by CRON_SECRET header — no user JWT required.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function mapPlaidType(type: string, subtype: string | null): string {
  if (type === "depository") {
    if (subtype === "hsa")                             return "hsa";
    if (subtype === "savings" || subtype === "money market") return "savings";
    if (subtype === "cd")                              return "savings";
    return "checking";
  }
  if (type === "credit") return "credit_card";
  if (type === "investment") {
    const s = (subtype ?? "").toLowerCase();
    if (s === "hsa" || s === "health reimbursement arrangement") return "hsa";
    if (s === "roth" || s === "roth ira")              return "roth_ira";
    if (["401k","401a","403b","457b","457plan","ira","sep ira","simple ira",
         "sarsep","keogh","pension","profit sharing plan","thrift savings plan"].includes(s)) {
      return "401k";
    }
    return "brokerage";
  }
  if (type === "loan") {
    if (subtype === "auto" || subtype === "auto loan") return "auto_loan";
    if (subtype === "student")                         return "student_loan";
    return "other_liability";
  }
  return "other_asset";
}

function parseAprFromName(name: string): number | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*%\s*APR/i);
  return m ? parseFloat(m[1]) : null;
}

function calcMinPayment(balance: number, apr: number): number {
  if (balance <= 0) return 0;
  const interest = (balance * (apr / 100)) / 12;
  return Math.max(25, Math.ceil(balance * 0.01 + interest));
}

Deno.serve(async (req) => {
  // Verify cron secret
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
  const PLAID_SECRET    = Deno.env.get("PLAID_SECRET");
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    return new Response(JSON.stringify({ error: "Plaid not configured" }), { status: 503 });
  }
  const plaidEnv  = Deno.env.get("PLAID_ENV") || "sandbox";
  const plaidBase = `https://${plaidEnv}.plaid.com`;

  // Fetch active premium user IDs — only sync paying subscribers
  const { data: premiumSubs, error: subsErr } = await supabase
    .from("user_subscriptions")
    .select("user_id")
    .eq("plan", "premium")
    .in("subscription_status", ["active", "trialing"]);

  if (subsErr) {
    console.error("Failed to fetch premium subscriptions:", subsErr.message);
    return new Response(JSON.stringify({ error: subsErr.message }), { status: 500 });
  }

  const premiumUserIds = (premiumSubs ?? []).map((s: any) => s.user_id);

  if (premiumUserIds.length === 0) {
    return new Response(JSON.stringify({ synced: 0, reason: "no active premium users" }), { status: 200 });
  }

  // Fetch plaid_items for premium users only
  const { data: items, error: itemsErr } = await supabase
    .from("plaid_items")
    .select("id, user_id, plaid_item_id, access_token, institution_name")
    .in("user_id", premiumUserIds);

  if (itemsErr) {
    console.error("Failed to fetch plaid_items:", itemsErr.message);
    return new Response(JSON.stringify({ error: itemsErr.message }), { status: 500 });
  }

  if (!items || items.length === 0) {
    return new Response(JSON.stringify({ synced: 0 }), { status: 200 });
  }

  const now = new Date().toISOString();
  let totalSynced = 0;

  for (const item of items) {
    try {
      const balRes = await fetch(`${plaidBase}/accounts/balance/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: item.access_token }),
      });
      const balBody = await balRes.json();

      if (!balRes.ok) {
        console.error(`Balance fetch failed for item ${item.plaid_item_id}:`, JSON.stringify(balBody));
        continue;
      }

      const plaidAccounts: any[] = balBody.accounts ?? [];

      for (const acct of plaidAccounts) {
        const balance = Math.abs(Number(acct.balances?.current ?? 0));
        const creditLimit = acct.balances?.limit != null ? Number(acct.balances.limit) : null;
        const accountType = mapPlaidType(acct.type, acct.subtype);
        const name = acct.official_name || acct.name;
        const apr = accountType === "credit_card" ? parseAprFromName(name) : null;

        const { data: existing } = await supabase
          .from("accounts")
          .select("id, apr, credit_limit")
          .eq("user_id", item.user_id)
          .eq("plaid_account_id", acct.account_id)
          .maybeSingle();

        if (existing) {
          const effectiveApr = apr ?? (existing as any).apr ?? null;
          const effectiveCreditLimit = creditLimit ?? (existing as any).credit_limit ?? null;
          await supabase.from("accounts").update({
            balance,
            credit_limit: effectiveCreditLimit,
            name,
            institution: item.institution_name ?? "",
            // Do NOT overwrite account_type — preserves any manual correction by the user.
            // account_type is set correctly on first insert via mapPlaidType.
            apr: effectiveApr,
            active: true,
            plaid_item_id: item.plaid_item_id,
            updated_at: now,
          }).eq("id", existing.id);
        } else {
          await supabase.from("accounts").insert({
            user_id: item.user_id,
            name,
            institution: item.institution_name ?? "",
            account_type: accountType,
            balance,
            credit_limit: creditLimit,
            apr,
            active: true,
            plaid_account_id: acct.account_id,
            plaid_item_id: item.plaid_item_id,
            updated_at: now,
          });
        }
        totalSynced++;
      }

      // Liabilities: fetch APR + min_payment for credit cards
      try {
        const liabRes = await fetch(`${plaidBase}/liabilities/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: item.access_token }),
        });
        if (liabRes.ok) {
          const liabBody = await liabRes.json();
          const creditAccounts: any[] = liabBody.liabilities?.credit ?? [];
          for (const liab of creditAccounts) {
            const purchaseApr = (liab.aprs ?? []).find((a: any) => a.apr_type === "purchase_apr");
            const apr = purchaseApr ? parseFloat(purchaseApr.apr_percentage) : null;
            const minPayment = liab.minimum_payment_amount != null ? Number(liab.minimum_payment_amount) : null;
            if (apr === null && minPayment === null) continue;
            const updateFields: Record<string, unknown> = { liability_synced_at: now };
            if (apr !== null) updateFields.apr = apr;
            if (minPayment !== null) updateFields.min_payment = minPayment;
            await supabase
              .from("accounts")
              .update(updateFields)
              .eq("user_id", item.user_id)
              .eq("plaid_account_id", liab.account_id);
          }
        }
      } catch (liabErr) {
        console.warn("Liabilities fetch skipped for item", item.plaid_item_id, ":", liabErr);
      }

      await supabase.from("plaid_items")
        .update({ last_synced_at: now, updated_at: now })
        .eq("id", item.id);

    } catch (err) {
      console.error(`Error syncing item ${item.plaid_item_id}:`, err);
    }
  }

  console.log(`Daily sync complete: ${totalSynced} accounts across ${items.length} items`);
  return new Response(JSON.stringify({ synced: totalSynced, items: items.length }), { status: 200 });
});
