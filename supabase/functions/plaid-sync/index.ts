import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://getforgenta.com",
  "https://treforged.com",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function getCorsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "https://getforgenta.com";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-trace-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

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

/** Parse APR % from Plaid account names like "12.5% APR Interest Credit Card" */
function parseAprFromName(name: string): number | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*%\s*APR/i);
  return m ? parseFloat(m[1]) : null;
}

/** Minimum payment: max($25, ceil(1% of balance + monthly interest)) */
function calcMinPayment(balance: number, apr: number): number {
  if (balance <= 0) return 0;
  const interest = (balance * (apr / 100)) / 12;
  return Math.max(25, Math.ceil(balance * 0.01 + interest));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET    = Deno.env.get("PLAID_SECRET");
    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      return new Response(JSON.stringify({ error: "Plaid not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const plaidEnv  = Deno.env.get("PLAID_ENV") || "sandbox";
    const plaidBase = `https://${plaidEnv}.plaid.com`;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: jwtErr } = await userClient.auth.getUser();
    if (jwtErr || !user) {
      console.error("getUser failed:", jwtErr?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // ── Delink action — revoke access token on Plaid then clean up locally ──────
    // No premium check: users must always be able to revoke bank access.
    const body = await req.json().catch(() => ({}));
    if (body?.action === "delink") {
      const plaidItemId = body?.plaid_item_id as string | undefined;
      if (!plaidItemId) {
        return new Response(JSON.stringify({ error: "plaid_item_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: item } = await supabase
        .from("plaid_items")
        .select("id, access_token")
        .eq("user_id", userId)
        .eq("plaid_item_id", plaidItemId)
        .maybeSingle();

      if (!item) {
        return new Response(JSON.stringify({ error: "Item not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Call Plaid /item/remove — best-effort, don't fail the delink if Plaid errors
      try {
        const removeRes = await fetch(`${plaidBase}/item/remove`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: PLAID_CLIENT_ID,
            secret: PLAID_SECRET,
            access_token: item.access_token,
          }),
        });
        if (!removeRes.ok) {
          const errBody = await removeRes.json().catch(() => ({}));
          console.error("Plaid /item/remove non-OK:", JSON.stringify(errBody));
        }
      } catch (err) {
        console.error("Plaid /item/remove fetch failed:", err);
      }

      // Delete the item row — access_token no longer valid
      await supabase.from("plaid_items").delete().eq("id", item.id);

      // Remove Plaid link from accounts — keep them active with last known balance
      await supabase
        .from("accounts")
        .update({ plaid_account_id: null, plaid_item_id: null } as any)
        .eq("user_id", userId)
        .eq("plaid_item_id", plaidItemId);

      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Sync action (default) — requires active premium subscription ─────────
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("plan, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();
    const isActive = sub?.plan === "premium" &&
      ["active", "trialing"].includes(sub?.subscription_status ?? "");
    if (!isActive) {
      return new Response(JSON.stringify({ error: "Premium subscription required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // force=true bypasses the 23.5h cooldown — user explicitly requested fresh data
    const forceSync = body?.force === true;
    // item_id scopes sync to a single institution — used post-link to avoid syncing all items
    const itemIdFilter = body?.item_id as string | undefined;

    let itemsQuery = supabase
      .from("plaid_items")
      .select("id, plaid_item_id, access_token, institution_name, last_synced_at")
      .eq("user_id", userId);
    if (itemIdFilter) {
      itemsQuery = itemsQuery.eq("plaid_item_id", itemIdFilter);
    }
    const { data: plaidItems, error: itemsErr } = await itemsQuery;

    if (itemsErr) throw new Error(itemsErr.message);
    if (!plaidItems || plaidItems.length === 0) {
      return new Response(JSON.stringify({ synced: 0, accounts: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const SYNC_COOLDOWN_MS = 23.5 * 60 * 60 * 1000;
    const syncedAccounts: any[] = [];

    for (const item of plaidItems) {
      // Cooldown: skip Plaid API call if synced within 23.5h, unless user forced a refresh.
      if (!forceSync && item.last_synced_at) {
        const lastSync = new Date(item.last_synced_at).getTime();
        if (Date.now() - lastSync < SYNC_COOLDOWN_MS) {
          const { data: cachedAccounts } = await supabase
            .from("accounts")
            .select("name, balance, account_type, plaid_account_id")
            .eq("user_id", userId)
            .eq("plaid_item_id", item.plaid_item_id);
          for (const acct of (cachedAccounts ?? [])) {
            syncedAccounts.push({ name: acct.name, balance: acct.balance, type: acct.account_type, plaid_account_id: acct.plaid_account_id });
          }
          continue; // skip Plaid API call for this item
        }
      }

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
      console.log(`Got ${plaidAccounts.length} accounts for item ${item.plaid_item_id}`);

      for (const acct of plaidAccounts) {
        const balance = Math.abs(Number(acct.balances?.current ?? 0));
        const creditLimit = acct.balances?.limit != null ? Number(acct.balances.limit) : null;
        const accountType = mapPlaidType(acct.type, acct.subtype);
        const name = acct.official_name || acct.name;
        // APR: parse from name (Plaid embeds it in sandbox; real accounts: null until user corrects)
        const apr = accountType === "credit_card" ? parseAprFromName(name) : null;

        // Select-then-update-or-insert to avoid partial index conflict issue with PostgREST
        const { data: existing } = await supabase
          .from("accounts")
          .select("id, apr, credit_limit")
          .eq("user_id", userId)
          .eq("plaid_account_id", acct.account_id)
          .maybeSingle();

        let opErr;
        if (existing) {
          // Preserve user-set APR and credit_limit if Plaid doesn't return them
          const effectiveApr = apr ?? (existing as any).apr ?? null;
          const effectiveCreditLimit = creditLimit ?? (existing as any).credit_limit ?? null;
          const { error } = await supabase
            .from("accounts")
            .update({
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
            })
            .eq("id", existing.id);
          opErr = error;
        } else {
          const { error } = await supabase
            .from("accounts")
            .insert({
              user_id: userId,
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
          opErr = error;
        }

        if (opErr) {
          console.error("Account sync error for", acct.account_id, ":", opErr.message);
        } else {
          syncedAccounts.push({ name, balance, type: accountType, plaid_account_id: acct.account_id });
        }
      }

      // ── Liabilities: APR + credit limit + minimum payment for credit cards ──────
      // liability_synced_at is ALWAYS written (even when endpoint fails or returns
      // no data) so the UI relink prompt clears for unsupported institutions.
      // credit_limit comes from liabilities (more reliable than balances.limit).
      // min_payment falls back to calcMinPayment when Plaid omits it.
      const itemCreditCardIds: string[] = plaidAccounts
        .filter((a: any) => mapPlaidType(a.type, a.subtype) === "credit_card")
        .map((a: any) => a.account_id as string);

      if (itemCreditCardIds.length > 0) {
        try {
          const liabRes = await fetch(`${plaidBase}/liabilities/get`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: item.access_token }),
          });

          const creditDataMap = new Map<string, any>();
          if (liabRes.ok) {
            const liabBody = await liabRes.json();
            for (const liab of (liabBody.liabilities?.credit ?? [])) {
              creditDataMap.set(liab.account_id, liab);
            }
          } else {
            const errBody = await liabRes.json().catch(() => ({}));
            console.warn(`Liabilities non-OK for item ${item.plaid_item_id}:`, JSON.stringify(errBody));
          }

          for (const plaidAccountId of itemCreditCardIds) {
            const liab = creditDataMap.get(plaidAccountId);
            const updateFields: Record<string, unknown> = { liability_synced_at: now };

            if (liab) {
              const purchaseApr = (liab.aprs ?? []).find((a: any) => a.apr_type === "purchase_apr");
              const liabApr   = purchaseApr ? parseFloat(purchaseApr.apr_percentage) : null;
              const liabMin   = liab.minimum_payment_amount != null ? Number(liab.minimum_payment_amount) : null;
              const liabLimit = liab.credit_limit != null ? Number(liab.credit_limit) : null;
              if (liabApr   !== null) updateFields.apr          = liabApr;
              if (liabLimit !== null) updateFields.credit_limit = liabLimit;
              if (liabMin   !== null) updateFields.min_payment  = liabMin;
            }

            // Fallback: estimate min_payment from APR + balance when Plaid omits it
            if (updateFields.min_payment === undefined) {
              const { data: snap } = await supabase
                .from("accounts")
                .select("balance, apr")
                .eq("user_id", userId)
                .eq("plaid_account_id", plaidAccountId)
                .maybeSingle();
              const effectiveApr = (updateFields.apr as number | undefined) ?? (snap as any)?.apr;
              if (snap && effectiveApr) {
                updateFields.min_payment = calcMinPayment(Number((snap as any).balance), Number(effectiveApr));
              }
            }

            await supabase
              .from("accounts")
              .update(updateFields)
              .eq("user_id", userId)
              .eq("plaid_account_id", plaidAccountId);
          }
        } catch (liabErr) {
          console.warn("Liabilities fetch threw for item", item.plaid_item_id, ":", liabErr);
          // Still stamp liability_synced_at so the relink prompt clears
          await supabase
            .from("accounts")
            .update({ liability_synced_at: now })
            .eq("user_id", userId)
            .in("plaid_account_id", itemCreditCardIds);
        }
      }

      await supabase
        .from("plaid_items")
        .update({ last_synced_at: now, updated_at: now })
        .eq("id", item.id);
    }

    // Enrich response: fetch final DB state for all synced accounts so the client
    // gets the true APR/credit_limit/min_payment values (set by the liabilities pass above).
    const syncedPlaidIds = syncedAccounts.map((a: any) => a.plaid_account_id).filter(Boolean);
    let richAccounts: any[] = syncedAccounts;
    if (syncedPlaidIds.length > 0) {
      const { data: dbAccts } = await supabase
        .from("accounts")
        .select("name, balance, account_type, apr, credit_limit, min_payment, plaid_account_id, liability_synced_at")
        .eq("user_id", userId)
        .in("plaid_account_id", syncedPlaidIds);
      if (dbAccts) {
        richAccounts = (dbAccts as any[]).map(a => ({
          name: a.name,
          balance: Number(a.balance),
          type: a.account_type,
          plaid_account_id: a.plaid_account_id,
          apr: a.apr != null ? Number(a.apr) : null,
          credit_limit: a.credit_limit != null ? Number(a.credit_limit) : null,
          min_payment: a.min_payment != null ? Number(a.min_payment) : null,
          liability_synced: !!a.liability_synced_at,
        }));
      }
    }

    return new Response(JSON.stringify({ synced: richAccounts.length, accounts: richAccounts, last_synced_at: now }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("plaid-sync:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
