import { Link } from 'react-router';

/**
 * Right to Delete Notice — the standalone deletion disclosure required by the
 * CCPA/CPRA and equivalent state privacy laws, and the public URL app stores
 * expect for account-deletion requests. Rendered inside the Legal page shell at
 * /delete-data.
 */
export default function DeleteDataContent() {
  return (
    <div className="space-y-8 text-sm">
      <p className="text-xs text-muted-foreground">Effective date: July 27, 2026 · Last updated: July 2026</p>

      <p className="text-muted-foreground leading-relaxed">
        This notice explains your right to have the personal information Forgenta holds about you deleted, how to
        exercise it, how long it takes, and the narrow categories of records we are legally required to keep. It
        supplements our{' '}
        <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
      </p>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">1. Your Right to Delete</h2>
        <p className="text-muted-foreground leading-relaxed">
          You have the right to request that TRE Forgenta LLC delete the personal information we have collected
          from you. Depending on where you live, this right may arise under the California Consumer Privacy Act as
          amended by the CPRA, the Colorado Privacy Act, the Connecticut Data Privacy Act, the Virginia CDPA, the
          GDPR ("right to erasure"), or similar laws. We extend the same deletion process to every user regardless
          of residency.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">2. How to Submit a Deletion Request</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p>
            <span className="text-foreground font-medium">In the app (fastest, self-service):</span> open{' '}
            <span className="text-foreground">Settings → Danger Zone → Delete Account</span> and confirm.
            Deletion begins immediately; no waiting period and no support ticket is required.
          </p>
          <p>
            <span className="text-foreground font-medium">By email:</span> write to{' '}
            <a href="mailto:support@getforgenta.com" className="text-primary hover:underline">support@getforgenta.com</a>{' '}
            from the email address on your account with the subject "Deletion Request". Use this route if you have
            lost access to your account and cannot sign in.
          </p>
          <p>
            <span className="text-foreground font-medium">Authorized agents:</span> an agent may submit a request
            on your behalf. We will ask the agent for written permission signed by you, and we may contact you
            directly to confirm the request before acting on it.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">3. Verifying Your Identity</h2>
        <p className="text-muted-foreground leading-relaxed">
          Because Forgenta holds financial information, we verify every deletion request before acting on it.
          In-app deletion is verified by your active authenticated session, and by your password or two-factor
          challenge where enabled. Emailed requests are verified by matching the sending address to the account
          and, where the match is not conclusive, by a confirmation link sent to the account's email address. We
          use the information you supply for verification only, and we discard it once the request is resolved. If
          we cannot verify you, we will tell you why rather than deleting the wrong account.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">4. Timelines</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p>
            <span className="text-foreground font-medium">Acknowledgement:</span> within 10 business days of
            receiving an emailed request. In-app deletion is confirmed on screen immediately.
          </p>
          <p>
            <span className="text-foreground font-medium">Completion:</span> an in-app deletion executes
            immediately — your login, personal data, and financial records are removed from our production systems
            as part of the request itself, not queued for later. Requests received by email are completed within
            30 days. Encrypted database backups expire on their own rolling schedule and are never used to restore
            a deleted account.
          </p>
          <p>
            <span className="text-foreground font-medium">Extensions:</span> where the law permits an extension
            (generally an additional 45 days for complex requests), we will notify you of the delay and the reason
            before the original deadline passes.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">5. What Gets Deleted</h2>
        <p className="text-muted-foreground leading-relaxed">
          Deletion covers everything tied to your account, including: your profile and login credentials; all
          accounts, balances, transactions, budgets, bills, and categories; debt, vehicle, build, and savings-goal
          records; forecasts, simulations, and saved plans; AI Advisor conversation history; uploaded images; and
          your cookie and consent preferences. Bank connections are revoked with the provider that supplied them
          — Plaid or Akoya — so no further transaction data is retrieved, and any active subscription is cancelled
          as part of the same operation.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">6. What We Must Retain, and Why</h2>
        <p className="text-muted-foreground leading-relaxed">
          Privacy law permits a business to keep a limited set of records despite a deletion request. We retain
          only the following, and we do not use them to build a profile of you or to market to you:
        </p>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p>
            <span className="text-foreground font-medium">Billing and tax records:</span> subscription plan,
            dates, status, and processor transaction identifiers, retained for 7 years to satisfy IRS and state
            tax recordkeeping requirements. At deletion we sever the link between this record and your identity,
            so what remains is a financial entry that is no longer connected to your account. Equivalent records
            are independently held by our payment processors (Stripe, Apple, Google Play).
          </p>
          <p>
            <span className="text-foreground font-medium">Security and operational logs:</span> limited
            security-incident and diagnostic logs, which identify users only by an irreversible hash rather than
            by email or name, kept to detect fraud and preserve the integrity of security investigations.
          </p>
          <p>
            <span className="text-foreground font-medium">The deletion request itself:</span> a dated record that
            your request was received and fulfilled, which the law requires us to keep as proof of compliance.
          </p>
          <p>
            <span className="text-foreground font-medium">Anonymized and aggregated data:</span> statistics that
            can no longer be linked or reasonably re-linked to you. This data is not personal information.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">7. Service Providers</h2>
        <p className="text-muted-foreground leading-relaxed">
          When we delete your data, we direct our service providers to do the same, subject to their own legal
          retention obligations. These include Supabase (database, authentication, and file storage), Plaid and
          Akoya (bank connections, which are revoked), Stripe and RevenueCat (subscription and entitlement records, subject to
          the tax retention above), and Anthropic (AI Advisor processing, which does not train on your data and
          retains it only transiently). We do not sell or share your personal information, so there is no
          downstream recipient to notify.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">8. Consequences of Deletion</h2>
        <p className="text-muted-foreground leading-relaxed">
          Deletion is permanent and cannot be reversed. Your forecasts, payoff plans, history, and uploaded photos
          cannot be recovered, and support cannot restore them. If you want a copy of your data first, export it
          from the app before you delete, or email us for a full export in JSON format. Creating a new account
          later starts from an empty state; it does not restore anything.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">9. No Discrimination</h2>
        <p className="text-muted-foreground leading-relaxed">
          We will not deny you service, charge you a different price, or provide a different level of quality
          because you exercised a privacy right. Note that deleting your account necessarily ends your access to
          the service itself, since the service cannot function without your data.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">10. If We Decline a Request</h2>
        <p className="text-muted-foreground leading-relaxed">
          If we cannot verify your identity, or if an exception listed in Section 6 applies to part of your
          request, we will tell you in writing which part we declined and why. You may appeal by replying to that
          response; we will review the appeal and respond within 45 days. Where your state provides one, you also
          retain the right to complain to your Attorney General or supervisory authority.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">11. Contact Us</h2>
        <p className="text-muted-foreground leading-relaxed">
          To exercise your right to delete, or to ask a question about this notice, contact TRE Forgenta LLC at:
          <br />
          <a href="mailto:support@getforgenta.com" className="text-primary hover:underline">support@getforgenta.com</a>
        </p>
      </section>
    </div>
  );
}
