# Implementation Plan: CORS Fix + Coupon Codes + Pre-commit Hook

**Date:** 2026-03-26
**Tasks:** 3 independent tasks executed after backup

---

## Pre-flight: Backup

Before touching any file, copy originals to:
```
./backups/2026-03-26_HHMMSS/
  supabase/functions/create-checkout/index.ts
  src/pages/Premium.tsx
  .git/hooks/pre-commit  (only if it already exists)
```

---

## TASK 1 — Fix CORS on `create-checkout` Edge Function

### Diagnosis

The local file `supabase/functions/create-checkout/index.ts` already contains correct
CORS headers and OPTIONS handling. The root cause of the preflight failure is that
the function is **not yet deployed** (or an outdated version without CORS is live).

The existing CORS config in the local file is already correct:
```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, ...",
};
// OPTIONS handled at top of handler
if (req.method === "OPTIONS") {
  return new Response(null, { headers: corsHeaders });
}
```

No code changes needed — just deploy.

### Steps

1. **Verify** the current function is deployed and compare with local via Supabase CLI:
   ```bash
   npx supabase functions list --project-ref mdtosrbfkextcaezuc1h
   ```

2. **Deploy** `create-checkout` to Supabase:
   ```bash
   npx supabase functions deploy create-checkout --project-ref mdtosrbfkextcaezuc1h
   ```

3. **Verify CORS** by hitting the OPTIONS endpoint:
   ```bash
   curl -X OPTIONS https://mdtosrbfkextcaezuc1h.supabase.co/functions/v1/create-checkout \
     -H "Origin: https://app.treforged.com" \
     -H "Access-Control-Request-Method: POST" \
     -v 2>&1 | grep -i "access-control"
   ```
   Expected: `access-control-allow-origin: *`

### Files Changed
| File | Operation |
|------|-----------|
| `supabase/functions/create-checkout/index.ts` | No change (already correct) — deploy only |

### Risks
- None. Code already correct; this is a deployment step only.

---

## TASK 2 — Coupon Code Support

### Architecture

```
User enters coupon → Premium.tsx sends { coupon_code } to create-checkout Edge Function
Edge Function:
  1. Read VALID_COUPON_CODES from Deno.env (comma-separated list)
  2. If coupon matches → upsert user_subscriptions(plan='premium', status='active') → return { granted: true }
  3. If coupon invalid → return { error: 'Invalid coupon code' } (400)
  4. If coupon empty → proceed with existing Stripe checkout flow unchanged
Premium.tsx:
  1. If { granted: true } → toast success → refetch subscription → redirect to /premium/success?coupon=1
```

### Step 1: Set the secret in Supabase

Store coupon codes as a Supabase secret (never hardcoded). The personal coupon will be
something like `TREFORGED-FULL` — the actual value must be set by the user via CLI:

```bash
# Set your personal coupon code (replace YOUR_CODE with actual value)
npx supabase secrets set VALID_COUPON_CODES="YOUR_CODE" --project-ref mdtosrbfkextcaezuc1h
```

> The user decides the actual coupon string. It is stored only in Supabase secrets.
> It is never written to any file in the repo.

### Step 2: Modify `supabase/functions/create-checkout/index.ts`

Add coupon validation **before** the existing Stripe logic. The change is additive —
if no coupon is provided, the function behaves exactly as before.

**Pseudo-code diff:**

```diff
+ // Parse body — destructure coupon_code alongside return_url
- const { return_url } = await req.json();
+ const { return_url, coupon_code } = await req.json();

+ // Coupon validation block (inserted BEFORE Stripe logic)
+ if (coupon_code) {
+   const validCodes = (Deno.env.get("VALID_COUPON_CODES") || "")
+     .split(",")
+     .map(c => c.trim())
+     .filter(Boolean);
+
+   if (!validCodes.includes(coupon_code.trim())) {
+     return new Response(JSON.stringify({ error: "Invalid coupon code" }), {
+       status: 400,
+       headers: { ...corsHeaders, "Content-Type": "application/json" },
+     });
+   }
+
+   // Valid coupon: grant premium directly using service role
+   const serviceClient = createClient(
+     Deno.env.get("SUPABASE_URL")!,
+     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
+   );
+   const { error: upsertError } = await serviceClient
+     .from("user_subscriptions")
+     .upsert({
+       user_id: userId,
+       plan: "premium",
+       subscription_status: "active",
+     }, { onConflict: "user_id" });
+
+   if (upsertError) throw upsertError;
+
+   return new Response(JSON.stringify({ granted: true }), {
+     status: 200,
+     headers: { ...corsHeaders, "Content-Type": "application/json" },
+   });
+ }

  // Existing Stripe logic continues unchanged below...
```

Note: `userId` is already resolved earlier in the function from the JWT claims.

### Step 3: Modify `src/pages/Premium.tsx`

Add an optional coupon input field above the "Upgrade Now" button.

**UI additions (within the Premium card section, above the checkout button):**

```tsx
// New state
const [couponCode, setCouponCode] = useState('');
const [couponError, setCouponError] = useState('');

// Updated handleCheckout: pass coupon_code
const handleCheckout = async () => {
  setCouponError('');
  setCheckoutLoading(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast.error('Please sign in first'); return; }

    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { return_url: window.location.origin, coupon_code: couponCode || undefined },
    });

    if (error) throw error;

    if (data?.granted) {
      toast.success('Coupon applied! Full access granted.');
      window.location.href = '/premium/success?coupon=1';
      return;
    }

    if (data?.url) window.location.href = data.url;
  } catch (e: any) {
    // If 400 and coupon was entered, surface as coupon error
    if (couponCode && e.message?.includes('Invalid coupon')) {
      setCouponError('Invalid coupon code. Please check and try again.');
    } else {
      toast.error(e.message || 'Failed to start checkout');
    }
  } finally {
    setCheckoutLoading(false);
  }
};

// New JSX (inserted ABOVE the "Upgrade Now" button, inside the non-premium branch):
<div className="space-y-1">
  <input
    type="text"
    value={couponCode}
    onChange={e => { setCouponCode(e.target.value); setCouponError(''); }}
    placeholder="Coupon code (optional)"
    className="w-full border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    style={{ borderRadius: 'var(--radius)' }}
  />
  {couponError && (
    <p className="text-[10px] text-destructive">{couponError}</p>
  )}
</div>
```

### Files Changed
| File | Operation | Description |
|------|-----------|-------------|
| `supabase/functions/create-checkout/index.ts` | Modify | Add coupon validation block |
| `src/pages/Premium.tsx` | Modify | Add coupon state, input UI, error display, pass coupon to invoke |

### Risks
| Risk | Mitigation |
|------|------------|
| `VALID_COUPON_CODES` not set → all coupons invalid | If env var is empty, coupon block still rejects non-empty codes; Stripe flow unaffected if field left blank |
| Coupon grants premium but user_subscriptions upsert fails | Return 500, toast error; no partial state |
| Coupon bypasses Stripe webhook — subscription has no `stripe_subscription_id` | Acceptable; `isPremium` check only needs `plan=premium` + `status=active`; portal link won't show (fine) |

---

## TASK 3 — Pre-commit Hook (Windows/PowerShell)

### Architecture Decision

Use `.git/hooks/pre-commit` (not Husky — no Husky installed, adding it would require
`npm install` and changes to `package.json`). Git for Windows runs hooks via `sh.exe`
bundled with Git, so a POSIX shell script works reliably even on Windows.

### Hook Logic

Scan all `*.ts` and `*.tsx` files in `src/lib/` that are staged for commit.
Fail if any file contains an exported function with an empty body.

**Patterns caught:**
- `export function foo() {}` (with optional whitespace inside braces)
- `export function foo(args) {  }` (whitespace only body)
- `export const foo = () => {}` (arrow functions)
- `export const foo = () => {  }` (whitespace only)
- `export const foo = (args): ReturnType => {}` (typed arrow)

**Patterns NOT caught (intentional):**
- Functions with a single comment inside `{ /* noop */ }`
- Abstract/interface declarations (not applicable in `.ts` runtime files)

### Hook File: `.git/hooks/pre-commit`

```sh
#!/bin/sh
# Pre-commit hook: reject empty exported function stubs in src/lib/
#
# Bypass (when intentional): git commit --no-verify
# Example: git commit --no-verify -m "chore: intentional empty stub"

FAILED=0

# Get staged files in src/lib/ that are .ts or .tsx
STAGED_LIB=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^src/lib/.*\.(ts|tsx)$')

if [ -z "$STAGED_LIB" ]; then
  exit 0
fi

for FILE in $STAGED_LIB; do
  # Check for empty function bodies using git show (staged content, not disk)
  # Pattern: export function/const ... = ... => {} or export function ...() {}
  MATCHES=$(git show ":$FILE" | grep -nE \
    'export (async )?function [A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*(:\s*\S+\s*)?\{\s*\}|export const [A-Za-z_][A-Za-z0-9_]*\s*=\s*(async\s*)?\([^)]*\)\s*(:\s*\S+\s*)?=>\s*\{\s*\}')

  if [ -n "$MATCHES" ]; then
    echo ""
    echo "❌  COMMIT BLOCKED: Empty exported function stub detected in $FILE"
    echo ""
    echo "$MATCHES" | while IFS= read -r line; do
      echo "   Line $line"
    done
    echo ""
    FAILED=1
  fi
done

if [ "$FAILED" -eq 1 ]; then
  echo "---"
  echo "Empty stubs cause black screen crashes in production (see commits 5ec0100/c3c616d)."
  echo "Implement the function body before committing."
  echo ""
  echo "To bypass intentionally: git commit --no-verify -m \"your message\""
  echo ""
  exit 1
fi

exit 0
```

### Steps

1. Write the hook to `.git/hooks/pre-commit`
2. Make it executable:
   ```bash
   chmod +x .git/hooks/pre-commit
   ```
3. Test — stage a file with an empty stub and verify it blocks:
   ```bash
   # Create test file
   echo 'export function testStub() {}' > src/lib/_test_stub.ts
   git add src/lib/_test_stub.ts
   git commit -m "test"
   # Should print BLOCKED message and exit 1
   git restore --staged src/lib/_test_stub.ts
   rm src/lib/_test_stub.ts
   ```

### Files Changed
| File | Operation | Description |
|------|-----------|-------------|
| `.git/hooks/pre-commit` | Create | New shell hook; replaces nothing (file didn't exist) |

> Note: `.git/hooks/` is NOT tracked by git (it's inside `.git/`). This hook is
> machine-local only. To share with teammates, add a `scripts/install-hooks.sh`
> or migrate to Husky later.

### Bypass documentation

```bash
# Bypass when intentionally committing an empty stub (e.g., WIP placeholder):
git commit --no-verify -m "wip: stub for [FunctionName] — implement before merge"

# IMPORTANT: Never merge a --no-verify commit to main with empty stubs.
```

---

## Execution Order

```
1. Backup originals
2. TASK 3 first (no code changes, just creates .git/hooks/pre-commit — safest)
3. TASK 1: Deploy create-checkout (no file changes needed)
4. TASK 2:
   a. User sets VALID_COUPON_CODES secret via CLI
   b. Modify create-checkout/index.ts
   c. Deploy create-checkout again
   d. Modify src/pages/Premium.tsx
5. Commit locally (backup + code changes)
```

---

## Commit Message

```
[feat]: coupon code support + pre-commit empty-stub guard

- Add optional coupon input to Premium.tsx; valid coupon bypasses Stripe
  and grants premium directly via user_subscriptions upsert
- create-checkout Edge Function reads VALID_COUPON_CODES secret; invalid
  coupon returns 400 with clear error; missing coupon falls through to
  Stripe unchanged
- Add .git/hooks/pre-commit to block empty exported function stubs in
  src/lib/ (catches root cause of 5ec0100/c3c616d black screen bugs)
- Re-deploy create-checkout to fix CORS preflight (code was correct
  locally; function was not deployed)
```

---

## SESSION_ID
- CODEX_SESSION: N/A (no external model used — Claude-only plan)
- GEMINI_SESSION: N/A
