# Apple Rejection Fixes — v2.99
_4 issues, 5 files, 1 manual App Store Connect step_

---

## Issue 1 — Cookie Banner on iOS (Guideline 5.1.2(i))

**What Apple saw**: Screenshot shows the "We use cookies" banner on the native iOS app landing screen.

**Root cause**: `App.tsx` renders `<CookieBanner />` inside BOTH the native branch (line 221) AND the web branch (line 233). The native branch is the `Capacitor.isNativePlatform() ? ...` block — so the banner renders on iOS.

**Fix**: Remove `<CookieBanner />` from the native branch. Keep it only in the web branch.

```tsx
// App.tsx — native branch (remove the CookieBanner line)
Capacitor.isNativePlatform() ? (
  <MemoryRouter initialEntries={['/auth']}>
    <DemoProvider>
      <AuthProvider>
        <SubscriptionProvider>
          <DeepLinkHandler />
          <AppRoutes />
          {/* ← DELETE the <CookieBanner /> that was here */}
        </SubscriptionProvider>
      </AuthProvider>
    </DemoProvider>
  </MemoryRouter>
) : (
  ...
  <CookieBanner />   {/* ← keep this one */}
  ...
)
```

**File**: `src/App.tsx` — remove line 221.

---

## Issue 2 — Name required after Sign in with Apple (Guideline 4)

**What Apple saw**: Screenshot shows onboarding "WHAT SHOULD WE CALL YOU?" with a blank required text field immediately after Sign in with Apple. Apple already provided the name — asking again violates the guideline.

**Root cause**: `Onboarding.tsx` line 154 initialises `displayName` from `user?.user_metadata?.display_name`, but Apple OAuth stores the name in `user_metadata.name` and Google stores the first name in `user_metadata.given_name`. So the field is always blank for OAuth users, forcing them to type manually.

**Fix**: Auto-extract the first name from OAuth metadata on init. Field stays required — it will just be pre-filled for Google/Apple users so they can hit Continue immediately.

```tsx
// Onboarding.tsx — replace line 154 with a helper that checks all providers:
const getInitialDisplayName = (user: User | null): string => {
  const meta = user?.user_metadata;
  if (!meta) return '';
  // Google provides given_name (first name) directly
  if (meta.given_name) return meta.given_name as string;
  // Apple sends full name as `name` on first sign-in — take first word
  if (meta.name) return (meta.name as string).split(' ')[0];
  // Email/password signups set display_name at signup
  if (meta.display_name) return meta.display_name as string;
  return '';
};

// In useState initializer:
displayName: getInitialDisplayName(user),
```

The field remains `required` and unchanged in the UI. For Google/Apple users the field is pre-filled with their first name — they just tap Continue. For email/password users it stays blank and they type as before.

Note: Apple only sends the name on the very first Sign in with Apple — subsequent logins won't have it in metadata. That's fine because the profile is already created on first login.

**File**: `src/pages/Onboarding.tsx` — line 154 only.

---

## Issue 3 — Missing EULA link in subscription UI (Guideline 3.1.2(c))

**What Apple saw**: The subscription paywall didn't include a functional link to Terms of Use (EULA).

**Root cause**: `IosPaywall.tsx` and `NativePaywall.tsx` have no Privacy Policy or Terms of Use links in the purchase UI.

**Fix — code**: Add links to the footer of both paywall components. Since you're using Apple's standard EULA, link to the Apple standard EULA URL (not a custom one).

```tsx
// Add near the bottom of both IosPaywall and NativePaywall, above the closing </div>:
<div className="flex items-center justify-center gap-3 pt-2">
  <a
    href="https://getforgenta.com/privacy"
    target="_blank"
    rel="noopener noreferrer"
    className="text-[10px] text-muted-foreground hover:text-foreground underline"
  >
    Privacy Policy
  </a>
  <span className="text-muted-foreground/30 text-[10px]">·</span>
  <a
    href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
    target="_blank"
    rel="noopener noreferrer"
    className="text-[10px] text-muted-foreground hover:text-foreground underline"
  >
    Terms of Use
  </a>
</div>
```

**Fix — App Store Connect (manual step for Tre)**:
Since you're using Apple's standard EULA (not a custom one), the requirement is to include the link in your App Description:
- Go to App Store Connect → Forgenta → App Store → App Description
- Add this line at the bottom of the description:
  ```
  Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
  ```
- Do NOT put a custom EULA in the EULA field — leave that blank. The standard EULA link in the description is sufficient per Apple's guidelines.

**Files**: `src/components/premium/IosPaywall.tsx`, `src/components/premium/NativePaywall.tsx`

---

## Issue 4 — Subscription doesn't unlock features after sandbox purchase (Guideline 2.1(b))

**What Apple saw**: Screenshot shows AI Advisor still gated with "Upgrade Now" after the reviewer purchased a subscription in sandbox.

**Root cause**: `revenuecat-webhook/index.ts` lines 158–164 explicitly discards all sandbox events:
```typescript
if (event.environment === "SANDBOX") {
  console.log(`[rc-webhook] sandbox event ignored: ${event.type}`);
  return new Response(...sandbox_ignored...);
}
```
Apple Review always tests IAP in the sandbox environment. The webhook fires, is ignored, Supabase is never updated, `isPremium` stays `false`, and AI stays gated.

**Fix — Part A (primary)**: Remove the sandbox guard from the webhook. Let sandbox purchases update the DB. Sandbox purchases don't cost real money, and RevenueCat's sandbox is purpose-built for testing review.

```typescript
// revenuecat-webhook/index.ts — DELETE lines 158–164:
// REMOVE THIS BLOCK:
if (event.environment === "SANDBOX") {
  console.log(`[rc-webhook] sandbox event ignored: ${event.type}`);
  return new Response(JSON.stringify({ received: true, action: "sandbox_ignored" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
```

**Fix — Part B (belt-and-suspenders)**: The webhook fires asynchronously. Add a retry loop in both `IosPaywall.tsx` and `NativePaywall.tsx` after purchase so the UI polls for the subscription update:

```tsx
// After purchasePackage() succeeds, poll refetch up to 5× with 1.5s delay:
const waitForPremium = async () => {
  for (let i = 0; i < 5; i++) {
    const result = await refetch();
    const sub = result.data as any;
    if (sub?.plan === 'premium' && ['active', 'trialing'].includes(sub?.subscription_status)) {
      return;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
};

const handlePurchase = async () => {
  if (!selectedPkg) return;
  setPurchasing(true);
  try {
    const info = await purchasePackage(selectedPkg);
    if (info) {
      await waitForPremium();   // ← replaces single refetch()
      toast.success('Welcome to Forgenta Premium!');
    }
  } catch ...
};
```

**Files**: 
- `supabase/functions/revenuecat-webhook/index.ts` — remove sandbox guard
- `src/components/premium/IosPaywall.tsx` — add retry loop
- `src/components/premium/NativePaywall.tsx` — add retry loop
- Deploy the edge function after the change

---

## Execution Order

1. **Code changes** (can be done in one session):
   - `src/App.tsx` — remove `<CookieBanner />` from native branch
   - `src/pages/Onboarding.tsx` — fix displayName init + make optional
   - `src/components/premium/IosPaywall.tsx` — add EULA/PP links + retry loop
   - `src/components/premium/NativePaywall.tsx` — add EULA/PP links + retry loop
   - `supabase/functions/revenuecat-webhook/index.ts` — remove sandbox guard

2. **Deploy edge function**:
   ```bash
   supabase functions deploy revenuecat-webhook --project-ref mdtosrbfkextcaezuclh
   ```

3. **App Store Connect** (manual):
   - Add Terms of Use URL to app description or EULA field
   
4. **Build and submit**:
   - Build new iOS version
   - Reply to Apple's review message with notes explaining each fix
   - In Review Notes: "Cookie banner removed from native iOS build. Sign in with Apple no longer asks for name. EULA link added to paywall. Sandbox purchases now update subscription state."

---

## Key Files

| File | Change |
|------|--------|
| `src/App.tsx:221` | Remove `<CookieBanner />` from native branch |
| `src/pages/Onboarding.tsx:154,~349` | Fix name init; make field optional |
| `src/components/premium/IosPaywall.tsx` | Add EULA/PP links + purchase retry loop |
| `src/components/premium/NativePaywall.tsx` | Add EULA/PP links + purchase retry loop |
| `supabase/functions/revenuecat-webhook/index.ts:158-164` | Remove sandbox ignore block |

---

## SESSION_ID
- CODEX_SESSION: N/A (single-model plan)
- GEMINI_SESSION: N/A (single-model plan)
