# Implementation Plan: Legal Pages (Privacy/Terms) + Auth Back Button

## Task Type
- [x] Frontend (→ Gemini)
- [ ] Backend
- [ ] Fullstack

---

## Context Summary

| File | Relevant Facts |
|------|---------------|
| `src/App.tsx` | Routes defined in `AppRoutes`. Public routes: `/`, `/auth`. Protected routes wrapped in `<ProtectedRoute>`. Uses lazy imports for all pages. |
| `src/pages/Auth.tsx` | Full-page centered card. No `Link` import. No back button. Footer links for Privacy/Terms absent. |
| `src/components/layout/DashboardLayout.tsx` | Footer at line 13 — `hidden lg:block`, copyright only. Need Privacy/Terms links added here. |
| `src/pages/Landing.tsx` | Footer at line 146 — brand + copyright. Need Privacy/Terms links added here. |

---

## Architecture Decision

Single `src/pages/Legal.tsx` component handles both `/privacy` and `/terms` routes.
Uses `useLocation().pathname` to determine active page and render the correct content.
Both routes are **public** (outside `ProtectedRoute`).

This avoids duplication while keeping two clean, independent URLs.

---

## Implementation Steps

### STEP 1 — Create `src/pages/Legal.tsx`

New file. Full layout: header with back button, left sidebar nav, main content area.

**Structure pseudo-code**:
```tsx
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Legal() {
  const { pathname } = useLocation();
  const isPrivacy = pathname === '/privacy';

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border px-6 py-4 flex items-center">
        <Link to="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={12} /> Back to home
        </Link>
        <span className="font-display font-bold text-xs text-gold ml-auto tracking-tight">TRE FORGED BUDGET OS</span>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex gap-8">
        {/* Sidebar */}
        <aside className="hidden sm:block w-44 shrink-0">
          <nav className="sticky top-8 space-y-1">
            <Link to="/privacy"
              className={`block px-3 py-2 text-xs font-medium rounded transition-colors ${
                isPrivacy ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Privacy Policy
            </Link>
            <Link to="/terms"
              className={`block px-3 py-2 text-xs font-medium rounded transition-colors ${
                !isPrivacy ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Terms of Service
            </Link>
          </nav>
        </aside>

        {/* Mobile tab switcher (sm:hidden) */}
        <div className="sm:hidden flex gap-2 mb-6"> ... </div>

        {/* Content */}
        <main className="flex-1 min-w-0 space-y-8">
          <h1 className="font-display font-bold text-2xl tracking-tight">
            {isPrivacy ? 'Privacy Policy' : 'Terms of Service'}
          </h1>
          {isPrivacy ? <PrivacyContent /> : <TermsContent />}
        </main>
      </div>
    </div>
  );
}
```

**Styling conventions** (match existing app):
- `font-display font-bold` for headings
- `text-xs text-muted-foreground` for body text
- `card-forged p-5` for section cards
- `style={{ borderRadius: 'var(--radius)' }}` on interactive elements
- Background: `bg-background`, borders: `border-border`

---

### STEP 2 — Privacy Policy content (inside `Legal.tsx`)

Inline component `PrivacyContent`. Sections as `<div className="space-y-6">` blocks.

**Sections to include**:
1. **Introduction** — TRE Forged LLC, app name, effective date (2025-01-01)
2. **Information We Collect**
   - Account data: email address, password (hashed, never stored in plaintext)
   - Financial data: budgets, transactions, accounts, goals, debts — stored in your account only
   - Usage data: page views, feature interactions (no third-party analytics)
3. **How We Use Your Information**
   - Provide and maintain the Budget OS service
   - Process payments and manage subscriptions
   - Send transactional emails (account confirmation, billing receipts)
   - Improve the service
4. **Data Storage — Supabase**
   - All user data stored in Supabase (PostgreSQL) hosted on AWS
   - Row-Level Security (RLS) ensures only you can access your data
   - Data encrypted at rest and in transit (TLS)
   - Supabase Privacy Policy: supabase.com/privacy
5. **Payment Processing — Stripe**
   - Payments processed by Stripe, Inc. — TRE Forged LLC never stores card numbers
   - Stripe Privacy Policy: stripe.com/privacy
   - Subscription data (plan, status) stored in our database for access control
6. **Data Retention**
   - Account data retained until you delete your account
   - Deleted account data purged within 30 days
7. **Your Rights**
   - Access: request a copy of your data
   - Correction: update incorrect information via Settings
   - Deletion: delete your account at any time via Settings
   - Portability: export your financial data (Premium feature)
8. **Security**
   - HTTPS only, Supabase auth JWTs, no sensitive data in logs
9. **Children's Privacy**
   - Service not intended for users under 13
10. **Contact**
    - Email: support@treforged.com

---

### STEP 3 — Terms of Service content (inside `Legal.tsx`)

Inline component `TermsContent`. Same styling.

**Sections to include**:
1. **Acceptance of Terms**
   - Using the service = acceptance of these terms
   - TRE Forged LLC reserves right to update terms with notice
2. **Description of Service**
   - TRE Forged Budget OS is a personal finance management SaaS
   - Features: budget tracking, debt payoff planning, savings goals, net worth, forecasting
3. **Account Registration**
   - Must provide accurate email; one account per person
   - Responsible for account security
4. **Free and Premium Tiers**
   - Free: 1 budget, basic dashboard, transaction tracking, up to 3 savings goals, 1 debt tracker
   - Premium ($9/month): unlimited budgets, advanced dashboard, CSV/PDF export, unlimited goals & debts, priority support
   - Subscriptions auto-renew; cancel anytime via billing portal
5. **Payment and Billing**
   - Payments processed via Stripe
   - Subscriptions billed monthly in advance
   - No refunds for partial months; cancel before renewal date to avoid next charge
   - TRE Forged LLC reserves right to change pricing with 30 days notice
6. **User Data**
   - You own your financial data
   - TRE Forged LLC does not sell or share your data with third parties
   - See Privacy Policy for full details
7. **Acceptable Use**
   - Personal use only; no resale, scraping, or commercial redistribution
   - Do not attempt to reverse engineer or exploit the service
8. **Disclaimers**
   - Budget OS is a planning tool, not financial advice
   - TRE Forged LLC is not a licensed financial advisor
   - Not liable for financial decisions made using the app
9. **Limitation of Liability**
   - Service provided "as is"
   - Maximum liability limited to fees paid in last 3 months
10. **Termination**
    - Either party may terminate; data available for 30 days after
11. **Governing Law**
    - Laws of the United States; disputes resolved in jurisdiction of TRE Forged LLC's principal place of business
12. **Contact**
    - support@treforged.com

---

### STEP 4 — Register routes in `src/App.tsx`

Add lazy import:
```tsx
const Legal = lazy(() => import("@/pages/Legal"));
```

Add routes to `AppRoutes`, OUTSIDE the `ProtectedRoute` wrapper:
```tsx
<Route path="/privacy" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
<Route path="/terms" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
```
Place these before the `<Route path="*">` catch-all.

---

### STEP 5 — Auth.tsx: back button + legal links

**Add import**:
```tsx
import { Link } from 'react-router-dom';
```

**Add "Back to home" above the card** (before the `<div className="text-center mb-8">`):
```tsx
<div className="mb-6">
  <Link to="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
    <ArrowLeft size={12} /> Back to home
  </Link>
</div>
```
Also add `ArrowLeft` to the lucide import (or use a text arrow ← to avoid adding a dependency).

**Add privacy/terms links after the form closing tag** (`</form>`), before the outer div closes:
```tsx
<p className="text-[10px] text-muted-foreground text-center mt-4">
  <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
  {' · '}
  <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
</p>
```

---

### STEP 6 — DashboardLayout.tsx: footer links

Update footer from:
```tsx
<footer className="hidden lg:block border-t border-border py-4 px-6">
  <p className="text-[10px] text-muted-foreground text-center">
    &copy; {new Date().getFullYear()} TRE Forged LLC. All rights reserved.
  </p>
</footer>
```
To:
```tsx
<footer className="hidden lg:block border-t border-border py-4 px-6">
  <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
    <span>&copy; {new Date().getFullYear()} TRE Forged LLC. All rights reserved.</span>
    <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
    <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
  </div>
</footer>
```
Add `Link` import from `react-router-dom`.

---

### STEP 7 — Landing.tsx: footer links

Update the existing footer `<p>` section to add links alongside the copyright.

Current footer inner content (~line 148–151):
```tsx
<span className="font-display font-bold text-xs tracking-tight text-gold">TRE FORGED BUDGET OS</span>
<p className="text-[10px] text-muted-foreground">
  &copy; {new Date().getFullYear()} TRE Forged LLC. All rights reserved.
</p>
```

Update to:
```tsx
<span className="font-display font-bold text-xs tracking-tight text-gold">TRE FORGED BUDGET OS</span>
<div className="flex items-center gap-4 text-[10px] text-muted-foreground">
  <span>&copy; {new Date().getFullYear()} TRE Forged LLC. All rights reserved.</span>
  <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
  <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
</div>
```
`Link` is likely already imported in Landing.tsx — verify before adding duplicate import.

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `src/pages/Legal.tsx` | **Create** | Unified privacy/terms page with sidebar, back button, full content |
| `src/App.tsx` | Modify | Add lazy import + `/privacy` and `/terms` public routes |
| `src/pages/Auth.tsx` | Modify | Add "← Back to home" link + privacy/terms footer links |
| `src/components/layout/DashboardLayout.tsx` | Modify | Add privacy/terms links to footer |
| `src/pages/Landing.tsx` | Modify | Add privacy/terms links to footer |

---

## Backup Policy (CLAUDE.md)

Before touching any existing file:
```
./backups/YYYY-MM-DD_HHMMSS/src/pages/Auth.tsx
./backups/YYYY-MM-DD_HHMMSS/src/App.tsx
./backups/YYYY-MM-DD_HHMMSS/src/components/layout/DashboardLayout.tsx
./backups/YYYY-MM-DD_HHMMSS/src/pages/Landing.tsx
```
`Legal.tsx` is a new file — no backup needed.

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Landing.tsx may or may not already import `Link` | Grep for existing import before adding |
| Mobile sidebar hidden — users on mobile can't switch pages | Add mobile tab switcher (two buttons) visible only on small screens |
| Legal page has no auth context — `useAuth` must not be called | Legal.tsx is a pure public page, no auth hooks |

---

## SESSION_ID
- CODEX_SESSION: N/A
- GEMINI_SESSION: N/A
