import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { COOKIE_CATEGORIES, CookieConsentState } from '@/lib/cookie-consent';
import { useCookieConsent } from '@/hooks/useCookieConsent';
import { Shield, ChevronDown, ChevronUp, X } from 'lucide-react';
import DeleteDataContent from '@/components/legal/DeleteDataContent';

function CookiePreferencesInline() {
  const { consent, acceptAll, rejectNonEssential, saveCustom } = useCookieConsent();
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false);
  const [marketing, setMarketing] = useState(consent?.marketing ?? false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    saveCustom({ analytics, marketing });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section className="space-y-3">
      <h2 className="font-display font-semibold text-base">14. Cookie Preferences</h2>
      <p className="text-muted-foreground leading-relaxed">
        You can review and change your cookie consent at any time below.
      </p>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-primary hover:underline"
      >
        <Shield size={12} />
        {open ? 'Hide preferences' : 'Manage cookie preferences'}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="border border-border p-4 space-y-3" style={{ borderRadius: 'var(--radius)' }}>
          {COOKIE_CATEGORIES.map((cat) => {
            const isExpanded = expanded === cat.id;
            const value =
              cat.id === 'essential'
                ? true
                : cat.id === 'analytics'
                ? analytics
                : marketing;
            const toggle =
              cat.id === 'essential'
                ? undefined
                : cat.id === 'analytics'
                ? () => setAnalytics((v) => !v)
                : () => setMarketing((v) => !v);

            return (
              <div key={cat.id} className="border border-border/60" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center justify-between px-3 py-2.5 gap-3">
                  <button
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                    onClick={() => setExpanded(isExpanded ? null : cat.id)}
                  >
                    <span className="text-xs font-medium">{cat.label}</span>
                    {isExpanded ? <ChevronUp size={11} className="text-muted-foreground shrink-0" /> : <ChevronDown size={11} className="text-muted-foreground shrink-0" />}
                  </button>
                  <button
                    role="switch"
                    aria-checked={value}
                    disabled={cat.required}
                    onClick={toggle}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center transition-colors ${cat.required ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${value ? 'bg-primary' : 'bg-muted'}`}
                    style={{ borderRadius: '9999px' }}
                  >
                    <span className={`block h-3.5 w-3.5 bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} style={{ borderRadius: '9999px' }} />
                  </button>
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-border/40 pt-2 space-y-1">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{cat.description}</p>
                    <p className="text-[10px] text-muted-foreground/70"><span className="font-medium text-muted-foreground">Examples: </span>{cat.examples.join(', ')}</p>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={rejectNonEssential} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border transition-colors" style={{ borderRadius: 'var(--radius)' }}>Reject non-essential</button>
            <button onClick={acceptAll} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border transition-colors" style={{ borderRadius: 'var(--radius)' }}>Accept all</button>
            <button onClick={handleSave} className="text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-1.5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
              {saved ? 'Saved ✓' : 'Save preferences'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PrivacyContent() {
  return (
    <div className="space-y-8 text-sm">
      <p className="text-xs text-muted-foreground">Effective date: January 1, 2025 · Last updated: May 2026</p>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">1. Introduction</h2>
        <p className="text-muted-foreground leading-relaxed">
          TRE Forgenta LLC ("we", "us", "our") operates Forgenta, a personal finance management
          application accessible at getforgenta.com. This Privacy Policy explains how we collect, use, store,
          and protect your information when you use our service. By using Forgenta you agree to the practices
          described in this policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">2. Information We Collect</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p><span className="text-foreground font-medium">Account data:</span> Your email address and a securely
          hashed password. We never store your password in plaintext.</p>
          <p><span className="text-foreground font-medium">Financial data:</span> Budget rules, transactions,
          account balances, savings goals, debt entries, and net worth entries you enter into the app. This data
          is stored solely in your account and is not shared with any third party.</p>
          <p><span className="text-foreground font-medium">Connected account data:</span> If you connect a bank
          account via Plaid, we store your Plaid access token (encrypted at rest), institution name, account
          names, masked account numbers (last 4 digits), balances, and transaction data returned by Plaid.
          Connecting a bank account is entirely optional. See Section 6 for full details.</p>
          <p><span className="text-foreground font-medium">Usage data:</span> Basic interaction logs (page
          navigation, feature usage) used to improve the service. We do not use third-party analytics trackers.</p>
          <p><span className="text-foreground font-medium">Payment data:</span> On web, billing is processed by
          Stripe. On iOS, billing is processed by Apple. On Android, billing is processed by Google Play.
          Subscription state across platforms is managed by RevenueCat. We store only platform-specific customer
          identifiers (Stripe customer ID, RevenueCat app user ID) and your subscription status — no card
          numbers, CVVs, or full payment details are ever stored by TRE Forgenta LLC.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">3. How We Use Your Information</h2>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed">
          <li>To provide, operate, and maintain the Forgenta service</li>
          <li>To authenticate your identity and protect your account</li>
          <li>To process payments and manage your subscription status</li>
          <li>To sync connected bank accounts and display up-to-date balances and transactions</li>
          <li>To send transactional emails (account confirmation, billing receipts)</li>
          <li>To respond to support requests</li>
          <li>To detect and prevent fraud or abuse</li>
          <li>To improve and develop new features</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          We do not sell, rent, or trade your personal information to third parties. We do not use your financial
          data to serve advertisements.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">4. Data Storage — Supabase</h2>
        <p className="text-muted-foreground leading-relaxed">
          All user data is stored in a PostgreSQL database managed by Supabase, Inc., hosted on Amazon Web
          Services (AWS) infrastructure. Supabase enforces Row-Level Security (RLS) policies that ensure each
          user can only read and write their own data — no other user or unauthenticated party can access your
          records. Data is encrypted at rest using AES-256 and encrypted in transit using TLS 1.2+.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Authentication is handled via Supabase Auth, which issues short-lived JSON Web Tokens (JWTs). Tokens
          are stored in your browser's local storage and are never sent to any server other than Supabase and
          our own edge functions. For Supabase's own data practices, see{' '}
          <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">supabase.com/privacy</a>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">5. Payment Processing — Stripe, Apple, Google Play &amp; RevenueCat</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forgenta uses different payment platforms depending on where you subscribe:
        </p>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p><span className="text-foreground font-medium">Web — Stripe:</span> Subscriptions purchased on the
          web are processed by Stripe, Inc. via a Stripe-hosted checkout page. TRE Forgenta LLC never receives,
          transmits, or stores your payment card details. Stripe is PCI-DSS Level 1 certified. We store only
          your Stripe customer ID and subscription status. For Stripe's data practices, see{' '}
          <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">stripe.com/privacy</a>.</p>
          <p><span className="text-foreground font-medium">iOS — Apple In-App Purchase:</span> Subscriptions
          purchased on iOS are billed directly by Apple, Inc. through the App Store. TRE Forgenta LLC does not
          receive your Apple ID, payment method, or card details. Apple's payment and billing terms govern these
          transactions. For Apple's data practices, see{' '}
          <a href="https://www.apple.com/legal/privacy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">apple.com/legal/privacy</a>.</p>
          <p><span className="text-foreground font-medium">Android — Google Play Billing:</span> Subscriptions
          purchased on Android are billed by Google LLC through Google Play. TRE Forgenta LLC does not receive
          your Google account payment details. Google's payment and billing terms govern these transactions.
          For Google's data practices, see{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">policies.google.com/privacy</a>.</p>
          <p><span className="text-foreground font-medium">RevenueCat — subscription management:</span> We use
          RevenueCat, Inc. to manage and verify subscription entitlements across web, iOS, and Android.
          RevenueCat receives your app user ID, platform purchase receipts, and device metadata to track
          subscription status. We store your RevenueCat app user ID in our database. For RevenueCat's data
          practices, see{' '}
          <a href="https://www.revenuecat.com/privacy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">revenuecat.com/privacy</a>.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">6. Bank Account Connections — Plaid</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forgenta optionally integrates with Plaid, Inc. to let you connect bank accounts and automatically
          import balances and transactions. Connecting an account is entirely optional — you can use Forgenta
          without linking any external accounts.
        </p>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p><span className="text-foreground font-medium">What Plaid accesses:</span> When you connect an
          account, Plaid authenticates with your financial institution on your behalf and retrieves account
          names, masked account numbers (last 4 digits), current balances, and recent transaction history.
          Plaid does not share your full account number, routing number, or bank login credentials with
          TRE Forgenta LLC.</p>
          <p><span className="text-foreground font-medium">What we store:</span> We store your Plaid access
          token (encrypted at rest), institution name, account names, masked account numbers, balances, and
          transaction data (merchant name, amount, date, category). We do not store your bank login
          credentials.</p>
          <p><span className="text-foreground font-medium">How the data is used:</span> Plaid data is used
          solely to display your account balances and transactions within Forgenta. It is not sold, shared,
          or used for advertising.</p>
          <p><span className="text-foreground font-medium">Revoking access:</span> You can disconnect any
          linked account at any time from the Accounts page. Disconnecting removes the Plaid access token and
          stops future syncs. You can also revoke access directly through your bank's linked-apps or connected
          accounts settings.</p>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          For Plaid's data practices, see{' '}
          <a href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">plaid.com/legal</a>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">7. Data Retention</h2>
        <p className="text-muted-foreground leading-relaxed">
          Your account data is retained for as long as your account is active. If you delete your account, we
          will purge your personal data and financial records within 30 days. Anonymized or aggregated data that
          cannot be linked to you may be retained for service improvement purposes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">8. Your Rights</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p><span className="text-foreground font-medium">Access:</span> You can view all data you have entered
          in the app at any time.</p>
          <p><span className="text-foreground font-medium">Correction:</span> You can update your account
          information and financial data directly within the app via Settings.</p>
          <p><span className="text-foreground font-medium">Deletion:</span> You can delete your account at any
          time from the Settings page. This permanently removes all your data. See our{' '}
          <Link to="/delete-data" className="text-primary hover:underline">Right to Delete Notice</Link>{' '}
          for the full process, timelines, and what we are required to retain.</p>
          <p><span className="text-foreground font-medium">Portability:</span> Premium subscribers can export
          their financial data to CSV. Contact support to request a full data export in JSON format.</p>
          <p><span className="text-foreground font-medium">Objection:</span> You may contact us to object to
          specific processing of your data. We will respond within 30 days.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">8a. Do Not Track &amp; Global Privacy Control</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forgenta honors browser-level opt-out signals. If your browser or extension sends a Global Privacy
          Control (GPC) signal or a Do Not Track (DNT) header, we do not load Google Analytics and no analytics
          events are sent, even if you previously accepted analytics cookies. The signal takes precedence over
          your stored cookie preference. Essential functionality (authentication, security, and your saved
          financial data) is unaffected, as it is required to operate the service and is not tracking.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">9. Security</h2>
        <p className="text-muted-foreground leading-relaxed">
          All connections to Forgenta are encrypted via HTTPS. Authentication uses industry-standard JWT tokens
          with expiration. We apply Row-Level Security at the database layer so each user's data is isolated.
          Sensitive operations (payments, subscription management) are handled by edge functions that validate
          authentication before processing any request. We do not log sensitive financial data or authentication
          tokens.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">10. Children's Privacy</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forgenta is not intended for users under the age of 13. We do not knowingly collect
          personal information from children. If we become aware that a child under 13 has provided personal
          data, we will delete it promptly.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">11. Changes to This Policy</h2>
        <p className="text-muted-foreground leading-relaxed">
          We may update this Privacy Policy from time to time. When we make material changes, we will notify
          you by email or by a notice within the app. Continued use of the service after changes take effect
          constitutes acceptance of the updated policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">12. Contact Us</h2>
        <p className="text-muted-foreground leading-relaxed">
          For privacy-related questions, data requests, or to exercise your rights, contact TRE Forgenta LLC at:
          <br />
          <a href="mailto:support@getforgenta.com" className="text-primary hover:underline">support@getforgenta.com</a>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">13. AI Advisor &amp; AI Processing</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forgenta's AI Advisor feature is powered by <strong className="text-foreground">Gemini 2.5 Flash</strong>, a
          large language model provided by Google LLC. When you use AI Advisor, the following data may be
          transmitted to Google's Gemini API to generate a response:
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed">
          <li>Your typed prompts and follow-up questions</li>
          <li>Relevant financial context derived from your account (monthly income, expenses, debt balances, savings goals, spending categories)</li>
          <li>Prior chat messages within the same session</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          AI responses are generated by a third-party provider. TRE Forgenta LLC does not control the underlying
          model and cannot guarantee the accuracy, completeness, or timeliness of AI-generated content.{' '}
          <strong className="text-foreground">AI output is not financial, investment, legal, or tax advice.</strong>
        </p>
        <p className="text-muted-foreground leading-relaxed">
          AI chat history may be stored in your account to provide continuity across sessions. You may delete your
          AI chat history from your account at any time. TRE Forgenta LLC does not sell personal data, including
          AI chat content, to third parties.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          AI Advisor is a premium-only feature. Usage is subject to daily and weekly limits enforced server-side
          to manage costs and prevent abuse.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Before using AI Advisor, you will be asked to review and accept these disclosures. Your acceptance is
          recorded with a version identifier. If the AI processing terms materially change, you will be prompted
          to re-accept before AI Advisor becomes available again.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          For Google's data practices regarding the Gemini API, see{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">policies.google.com/privacy</a>.
        </p>
      </section>

      <CookiePreferencesInline />
    </div>
  );
}

function TermsContent() {
  return (
    <div className="space-y-8 text-sm">
      <p className="text-xs text-muted-foreground">Effective date: January 1, 2025 · Last updated: March 2026</p>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">1. Acceptance of Terms</h2>
        <p className="text-muted-foreground leading-relaxed">
          By accessing or using Forgenta ("the Service"), provided by TRE Forgenta LLC
          ("Company", "we", "us"), you agree to be bound by these Terms of Service. If you do not agree to
          these terms, do not use the Service. We reserve the right to update these terms at any time with
          reasonable notice.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">2. Description of Service</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forgenta is a personal finance management Software-as-a-Service (SaaS) application. It
          provides tools for budget planning, transaction tracking, debt payoff planning, savings goal tracking,
          net worth monitoring, and cash flow forecasting. The Service is intended for personal, non-commercial
          use.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">3. Account Registration</h2>
        <p className="text-muted-foreground leading-relaxed">
          To use Forgenta you must register with a valid email address and a password of at least 6 characters.
          You are responsible for maintaining the confidentiality of your account credentials and for all
          activity that occurs under your account. You must provide accurate and complete information and keep
          your account information up to date. One account per person; creating multiple accounts to circumvent
          free-tier limits is prohibited.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">4. Free and Premium Tiers</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p><span className="text-foreground font-medium">Free tier</span> includes: 1 budget, basic
          dashboard, transaction tracking, up to 3 savings goals, and 1 debt tracker. The free tier is provided
          at no charge and may be modified at our discretion.</p>
          <p><span className="text-foreground font-medium">Premium tier</span> ($9/month) includes: unlimited
          budgets, advanced dashboard, CSV/PDF export, unlimited savings goals and debt trackers, car fund
          tracker pro, custom categories, and priority support.</p>
          <p>Premium subscriptions are billed monthly in advance and auto-renew until cancelled.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">5. Payment and Billing</h2>
        <p className="text-muted-foreground leading-relaxed">
          All payments are processed securely by Stripe, Inc. By subscribing to Premium, you authorize
          TRE Forgenta LLC to charge your payment method on a recurring monthly basis. Subscriptions renew
          automatically on the same date each month.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          You may cancel your subscription at any time via the billing portal accessible from the Premium page
          or Settings. Cancellation takes effect at the end of the current billing period — you retain Premium
          access until that date. We do not provide prorated refunds for partial months.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          TRE Forgenta LLC reserves the right to change pricing with at least 30 days' notice. Continued use
          after a price change constitutes acceptance of the new price.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">6. User Data and Privacy</h2>
        <p className="text-muted-foreground leading-relaxed">
          You retain full ownership of all financial data you enter into Forgenta. TRE Forgenta LLC does not
          sell, rent, or share your personal or financial data with third parties for marketing purposes. Our
          data practices are described in full in our{' '}
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">7. Acceptable Use</h2>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed">
          <li>Use the Service only for personal, non-commercial financial management</li>
          <li>Do not resell, sublicense, or redistribute access to the Service</li>
          <li>Do not attempt to reverse engineer, decompile, or exploit the Service</li>
          <li>Do not scrape, crawl, or programmatically extract data from the Service</li>
          <li>Do not use the Service in any way that violates applicable laws or regulations</li>
          <li>Do not share your account credentials with others</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          Violation of acceptable use terms may result in immediate account termination without refund.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">8. Disclaimer of Warranties</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forgenta is a planning and tracking tool — it is <strong>not financial advice</strong>.
          TRE Forgenta LLC is not a licensed financial advisor, broker, or investment manager. The projections,
          recommendations, and calculations provided are for informational purposes only. You are solely
          responsible for any financial decisions you make using the Service.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          The Service is provided "as is" and "as available" without warranties of any kind, express or
          implied, including merchantability, fitness for a particular purpose, or non-infringement. We do not
          guarantee uninterrupted, error-free, or secure access to the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">9. Limitation of Liability</h2>
        <p className="text-muted-foreground leading-relaxed">
          To the maximum extent permitted by law, TRE Forgenta LLC and its officers, employees, and affiliates
          shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising
          from your use of the Service. Our total liability to you for any claims arising from use of the
          Service shall not exceed the total fees you paid to TRE Forgenta LLC in the three months preceding the
          claim.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">10. Termination</h2>
        <p className="text-muted-foreground leading-relaxed">
          You may terminate your account at any time via the Settings page. TRE Forgenta LLC may suspend or
          terminate your account for violation of these Terms, non-payment, or for any reason with reasonable
          notice. Upon termination, your data will be retained for 30 days during which you may request an
          export, then permanently deleted.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">11. Governing Law</h2>
        <p className="text-muted-foreground leading-relaxed">
          These Terms are governed by the laws of the United States. Any disputes arising from these Terms or
          your use of the Service shall be resolved in the jurisdiction of TRE Forgenta LLC's principal place of
          business. If any provision of these Terms is found unenforceable, the remaining provisions remain in
          full effect.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">12. Contact Us</h2>
        <p className="text-muted-foreground leading-relaxed">
          For questions about these Terms, contact TRE Forgenta LLC at:
          <br />
          <a href="mailto:support@getforgenta.com" className="text-primary hover:underline">support@getforgenta.com</a>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">13. AI Advisor Terms</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p>
            <span className="text-foreground font-medium">Premium-only feature.</span>{' '}
            AI Advisor is available exclusively to active Premium subscribers. Free accounts have no access to
            AI Advisor functionality.
          </p>
          <p>
            <span className="text-foreground font-medium">Powered by Gemini 2.5 Flash.</span>{' '}
            AI responses are generated by Google's Gemini 2.5 Flash model. TRE Forgenta LLC is not responsible
            for the accuracy, completeness, timeliness, or appropriateness of AI-generated content.
          </p>
          <p>
            <span className="text-foreground font-medium">Not professional advice.</span>{' '}
            AI Advisor is an informational and educational tool only. Nothing it produces constitutes financial,
            investment, legal, or tax advice. You are solely responsible for any decisions made based on AI
            output. Consult a licensed professional before making significant financial decisions.
          </p>
          <p>
            <span className="text-foreground font-medium">AI limitations.</span>{' '}
            The AI may produce inaccurate, incomplete, or outdated information. It does not have real-time market
            data, knowledge of your complete financial picture beyond what you provide, or the ability to predict
            future outcomes with certainty.
          </p>
          <p>
            <span className="text-foreground font-medium">Usage limits.</span>{' '}
            TRE Forgenta LLC may impose daily, weekly, or cost-based usage limits on AI Advisor to manage service
            costs and ensure availability. These limits are enforced server-side and may be adjusted at any time.
          </p>
          <p>
            <span className="text-foreground font-medium">Prohibited conduct.</span>{' '}
            The following are expressly prohibited: automated or scripted requests to the AI Advisor endpoint,
            prompt injection or jailbreak attempts, circumventing usage limits or consent requirements, scraping
            AI responses, or any use designed to abuse, overload, or extract unauthorized data from the AI
            service. Violations may result in immediate account suspension.
          </p>
          <p>
            <span className="text-foreground font-medium">Service control.</span>{' '}
            TRE Forgenta LLC reserves the right to limit, throttle, suspend, or permanently disable AI Advisor
            for any user or in general, at any time, without notice, to protect service integrity, manage costs,
            or comply with legal requirements.
          </p>
          <p>
            <span className="text-foreground font-medium">Consent requirement.</span>{' '}
            Use of AI Advisor requires explicit acceptance of the AI data disclosures presented within the app.
            If the AI processing terms change materially, continued use requires re-acceptance of the updated
            terms. Declining consent blocks AI Advisor access but does not affect any other app features.
          </p>
        </div>
      </section>
    </div>
  );
}

function RefundContent() {
  return (
    <div className="space-y-8 text-sm">
      <p className="text-xs text-muted-foreground">Effective date: April 17, 2026 · Last updated: April 2026</p>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">1. All Sales Are Final</h2>
        <p className="text-muted-foreground leading-relaxed">
          All purchases of Forgenta Premium subscriptions are <strong className="text-foreground">final and non-refundable</strong>.
          By subscribing, you acknowledge and agree that TRE Forgenta LLC does not offer refunds or credits for any
          subscription fees, partial billing periods, unused time, or any other amounts paid.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">2. Cancellation</h2>
        <p className="text-muted-foreground leading-relaxed">
          You may cancel your subscription at any time via the billing portal accessible from the Settings page.
          Cancellation stops future charges. You retain access to Premium features through the end of the current
          paid billing period. No refund is issued for the remainder of that period.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">3. Exceptions Required by Law</h2>
        <p className="text-muted-foreground leading-relaxed">
          Notwithstanding the above, TRE Forgenta LLC will issue refunds where required by applicable law. If you
          believe you are entitled to a refund under your local consumer protection laws, please contact us with
          details of your request and we will evaluate it in accordance with our legal obligations.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">4. Disputes and Chargebacks</h2>
        <p className="text-muted-foreground leading-relaxed">
          If you believe a charge was made in error, contact us before initiating a chargeback with your bank or
          card issuer. Unauthorized chargebacks may result in immediate account suspension. We are committed to
          resolving billing issues fairly and promptly.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">5. Contact Us</h2>
        <p className="text-muted-foreground leading-relaxed">
          For billing questions or to submit a refund request under applicable law, contact TRE Forgenta LLC at:
          <br />
          <a href="mailto:support@getforgenta.com" className="text-primary hover:underline">support@getforgenta.com</a>
        </p>
      </section>
    </div>
  );
}

export default function Legal() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const isPrivacy = pathname === '/privacy';
  const isRefund = pathname === '/refund';
  const isDelete = pathname === '/delete-data';
  const isTerms = !isPrivacy && !isRefund && !isDelete;

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div ref={containerRef} id="scroll-legal" className="h-screen overflow-y-auto bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center gap-6">
        <button
          onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft size={12} /> Back
        </button>

        {/* Desktop nav — locked in the top bar */}
        <nav className="hidden sm:flex items-center gap-1">
          <Link
            to="/privacy"
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              isPrivacy ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            style={{ borderRadius: 'var(--radius)' }}
          >
            Privacy Policy
          </Link>
          <Link
            to="/terms"
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              isTerms ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            style={{ borderRadius: 'var(--radius)' }}
          >
            Terms of Service
          </Link>
          <Link
            to="/refund"
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              isRefund ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            style={{ borderRadius: 'var(--radius)' }}
          >
            Refund Policy
          </Link>
          <Link
            to="/delete-data"
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              isDelete ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            style={{ borderRadius: 'var(--radius)' }}
          >
            Right to Delete
          </Link>
        </nav>

        <span className="font-display font-bold text-xs text-gold ml-auto tracking-tight">FORGENTA</span>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">

        {/* Tab switcher — mobile */}
        <div className="sm:hidden w-full mb-2">
          <div className="flex gap-2">
            <Link
              to="/privacy"
              className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                isPrivacy
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Privacy
            </Link>
            <Link
              to="/terms"
              className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                isTerms
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Terms
            </Link>
            <Link
              to="/refund"
              className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                isRefund
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Refunds
            </Link>
            <Link
              to="/delete-data"
              className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                isDelete
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Deletion
            </Link>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-2xl tracking-tight mb-8">
            {isPrivacy ? 'Privacy Policy' : isRefund ? 'Refund Policy' : isDelete ? 'Right to Delete Notice' : 'Terms of Service'}
          </h1>
          {isPrivacy ? <PrivacyContent /> : isRefund ? <RefundContent /> : isDelete ? <DeleteDataContent /> : <TermsContent />}

          {/* Bottom nav — mobile only */}
          <div className="sm:hidden mt-10 space-y-3">
            <div className="flex gap-2">
              <Link
                to="/privacy"
                className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                  isPrivacy
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                Privacy
              </Link>
              <Link
                to="/terms"
                className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                  !isPrivacy && !isRefund
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                Terms
              </Link>
              <Link
                to="/refund"
                className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                  isRefund
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                Refunds
              </Link>
            </div>
            <Link
              to="/auth"
              className="block w-full text-center px-3 py-2.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              ← Back to Sign In
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
