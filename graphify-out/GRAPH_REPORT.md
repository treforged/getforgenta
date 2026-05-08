# Graph Report - src  (2026-05-08)

## Corpus Check
- 84 files · ~100,696 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 526 nodes · 1201 edges · 29 communities (28 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Onboarding and Auth UI|Onboarding and Auth UI]]
- [[_COMMUNITY_Credit Card Engine and Auth|Credit Card Engine and Auth]]
- [[_COMMUNITY_Data Layer and Demo Profiles|Data Layer and Demo Profiles]]
- [[_COMMUNITY_Debt Payoff UI|Debt Payoff UI]]
- [[_COMMUNITY_Expense Filtering Utilities|Expense Filtering Utilities]]
- [[_COMMUNITY_Dashboard UI Components|Dashboard UI Components]]
- [[_COMMUNITY_Account and Plaid Modals|Account and Plaid Modals]]
- [[_COMMUNITY_App Shell and Routing|App Shell and Routing]]
- [[_COMMUNITY_Cookie and Consent|Cookie and Consent]]
- [[_COMMUNITY_Debt and Goal Data Models|Debt and Goal Data Models]]
- [[_COMMUNITY_Layout and Navigation|Layout and Navigation]]
- [[_COMMUNITY_Onboarding Wizard|Onboarding Wizard]]
- [[_COMMUNITY_Export Utilities|Export Utilities]]
- [[_COMMUNITY_Settings and Stripe|Settings and Stripe]]
- [[_COMMUNITY_Validation Schemas|Validation Schemas]]
- [[_COMMUNITY_iOS In-App Purchase|iOS In-App Purchase]]
- [[_COMMUNITY_App Lock and Security|App Lock and Security]]
- [[_COMMUNITY_Date and Time Utilities|Date and Time Utilities]]
- [[_COMMUNITY_Supabase Type Definitions|Supabase Type Definitions]]
- [[_COMMUNITY_Auth Forms and Validation|Auth Forms and Validation]]
- [[_COMMUNITY_App Tour|App Tour]]
- [[_COMMUNITY_Error Boundary|Error Boundary]]
- [[_COMMUNITY_Landing Page|Landing Page]]
- [[_COMMUNITY_Cloudflare Turnstile|Cloudflare Turnstile]]
- [[_COMMUNITY_Logo Component|Logo Component]]

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 65 edges
2. `useSubscription()` - 36 edges
3. `useAccounts()` - 24 edges
4. `formatCurrency()` - 23 edges
5. `supabase` - 21 edges
6. `useDebts()` - 20 edges
7. `useProfile()` - 20 edges
8. `useRecurringRules()` - 19 edges
9. `cn()` - 17 edges
10. `useTransactions()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `ProtectedRoute()` --calls--> `useAuth()`  [EXTRACTED]
  App.tsx → contexts/AuthContext.tsx
- `OnboardingChecklist()` --calls--> `useAuth()`  [EXTRACTED]
  components/dashboard/OnboardingChecklist.tsx → contexts/AuthContext.tsx
- `DashboardLayout()` --calls--> `useAuth()`  [EXTRACTED]
  components/layout/DashboardLayout.tsx → contexts/AuthContext.tsx
- `IosPaywall()` --calls--> `useSubscription()`  [EXTRACTED]
  components/premium/IosPaywall.tsx → hooks/useSubscription.ts
- `AccountUpdateReminder()` --calls--> `useAuth()`  [EXTRACTED]
  components/shared/AccountUpdateReminder.tsx → contexts/AuthContext.tsx

## Communities (29 total, 1 thin omitted)

### Community 0 - "Onboarding and Auth UI"
Cohesion: 0.05
Nodes (45): ChecklistItem, OnboardingChecklist(), Props, getPaychecksBetween(), PlaidItem, DeductionEntry, getPaychecksBetween(), RETIRE_ACCOUNT_TYPES (+37 more)

### Community 1 - "Credit Card Engine and Auth"
Cohesion: 0.11
Nodes (52): useAuth(), CreditCardEngine(), PAYMENT_MODE_TIPS, Props, STRATEGY_TIPS, usePersistedState(), usePlaidItems(), useSubscription() (+44 more)

### Community 2 - "Data Layer and Demo Profiles"
Cohesion: 0.06
Nodes (40): DEFAULT_PROFILE, demoAccounts, demoBudgetItems, demoRecurringRules, demoSubs, demoAssets, demoCarFunds, demoDebts (+32 more)

### Community 3 - "Debt Payoff UI"
Cohesion: 0.1
Nodes (29): BANK_DEFAULT_CATEGORIES, buildCardData(), CARD_COLORS, CardData, CardMonthRow, CardProjection, CC_DEFAULT_CATEGORIES, generateRecommendations() (+21 more)

### Community 4 - "Expense Filtering Utilities"
Cohesion: 0.07
Nodes (29): categorizeExpenses(), getDebtPayments(), getDebtPaymentsByCard(), getRemainingMonthExpenses(), getUnpaidExpenses(), emitSpan(), PII_PATTERNS, randomHex() (+21 more)

### Community 5 - "Dashboard UI Components"
Cohesion: 0.11
Nodes (17): ChartSkeleton(), MetricSkeleton(), ScheduleSkeleton(), navItems, Sidebar(), cn(), CategoryIcon(), iconMap (+9 more)

### Community 6 - "Account and Plaid Modals"
Cohesion: 0.08
Nodes (17): ACCOUNT_TYPES, APY_TYPES, ASSET_TYPES, emptyForm, INVESTMENT_TYPES, LIABILITY_TYPES, LIQUID_TYPES, MatchEntry (+9 more)

### Community 7 - "App Shell and Routing"
Cohesion: 0.08
Nodes (18): Accounts, AiAdvisor, BudgetControl, DebtPayoff, Forecast, Legal, NetWorth, Onboarding (+10 more)

### Community 8 - "Cookie and Consent"
Cohesion: 0.15
Nodes (12): ConsentStatus, useCookieConsent(), UseCookieConsentReturn, COOKIE_CATEGORIES, CookieCategoryDef, CookieCategoryId, CookieConsentState, loadConsent() (+4 more)

### Community 9 - "Debt and Goal Data Models"
Cohesion: 0.12
Nodes (10): DebtEntry, DEFAULT_DATA, GOAL_TYPES, GoalEntry, GoalType, Onboarding(), OnboardingData, Step (+2 more)

### Community 10 - "Layout and Navigation"
Cohesion: 0.16
Nodes (9): AuthContext, AuthContextType, AuthProvider(), DashboardLayout(), PRIMARY, SECONDARY, AccountUpdateReminder(), DemoBanner() (+1 more)

### Community 11 - "Onboarding Wizard"
Cohesion: 0.17
Nodes (5): Props, Step, STEP_LABELS, UpsellStage, Props

### Community 12 - "Export Utilities"
Cohesion: 0.23
Nodes (9): ExportRow, exportTransactionsCsv(), DashboardSnapshot, exportDashboardPdf(), exportForecastPdf(), exportTransactionsPdf(), fmt(), ForecastRow (+1 more)

### Community 13 - "Settings and Stripe"
Cohesion: 0.2
Nodes (8): stripePromise, TrustedDevice, LinkedAccounts(), OAUTH_PROVIDERS, UserIdentity, EnrollView, MfaFactor, TwoFactorAuth()

### Community 14 - "Validation Schemas"
Cohesion: 0.2
Nodes (9): accountSchema, emailChangeSchema, passwordChangeSchema, premiumSuccessParamsSchema, profileSchema, recurringRuleSchema, savingsGoalSchema, transactionSchema (+1 more)

### Community 15 - "iOS In-App Purchase"
Cohesion: 0.38
Nodes (8): getOfferings(), initRevenueCat(), isIos(), logOutRevenueCat(), purchasePackage(), restorePurchases(), FEATURE_LIST, IosPaywall()

### Community 16 - "App Lock and Security"
Cohesion: 0.24
Nodes (5): K, LockType, useAppLock(), AppLockScreen(), DIGITS

### Community 17 - "Date and Time Utilities"
Cohesion: 0.22
Nodes (8): aggregateByMonth(), DAY_NAMES, formatDateShort(), generateScheduledEvents(), getDayName(), getNextWeekdays(), getUpcomingEvents(), ScheduledEvent

### Community 18 - "Supabase Type Definitions"
Cohesion: 0.22
Nodes (8): Constants, Database, DatabaseWithoutInternals, DefaultSchema, Json, Tables, TablesInsert, TablesUpdate

### Community 19 - "Auth Forms and Validation"
Cohesion: 0.25
Nodes (6): loginSchema, signUpSchema, Auth(), getDeviceName(), Mode, TrustedDevice

### Community 20 - "App Tour"
Cohesion: 0.22
Nodes (7): AppTourProps, FLAG_KEY, LOCAL_KEY, NEW_USER_STEPS, PREMIUM_STEPS, TourStep, TourVariant

### Community 21 - "Error Boundary"
Cohesion: 0.25
Nodes (3): ErrorBoundary, Props, State

### Community 22 - "Landing Page"
Cohesion: 0.29
Nodes (5): fadeUp, features, Landing(), pillars, stats

### Community 23 - "Cloudflare Turnstile"
Cohesion: 0.4
Nodes (3): TurnstileRenderOptions, TurnstileWidgetProps, Window

## Knowledge Gaps
- **174 isolated node(s):** `Transactions`, `DebtPayoff`, `SavingsGoals`, `NetWorth`, `SettingsPage` (+169 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useAuth()` connect `Credit Card Engine and Auth` to `Onboarding and Auth UI`, `Data Layer and Demo Profiles`, `Debt Payoff UI`, `Expense Filtering Utilities`, `Dashboard UI Components`, `Account and Plaid Modals`, `App Shell and Routing`, `Debt and Goal Data Models`, `Layout and Navigation`, `Onboarding Wizard`, `Settings and Stripe`, `Auth Forms and Validation`, `Landing Page`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **Why does `useSubscription()` connect `Credit Card Engine and Auth` to `Onboarding and Auth UI`, `Data Layer and Demo Profiles`, `Debt Payoff UI`, `Expense Filtering Utilities`, `Dashboard UI Components`, `Account and Plaid Modals`, `Layout and Navigation`, `Onboarding Wizard`, `Settings and Stripe`, `Validation Schemas`, `iOS In-App Purchase`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `supabase` connect `Onboarding and Auth UI` to `Data Layer and Demo Profiles`, `Expense Filtering Utilities`, `Account and Plaid Modals`, `Debt and Goal Data Models`, `Onboarding Wizard`, `Settings and Stripe`, `App Tour`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `Transactions`, `DebtPayoff`, `SavingsGoals` to the rest of the system?**
  _174 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Onboarding and Auth UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Credit Card Engine and Auth` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Data Layer and Demo Profiles` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._