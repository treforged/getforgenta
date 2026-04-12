# Data Retention and Disposal Policy
**Organization:** TRE Forged LLC  
**Application:** Budget OS  
**Effective Date:** April 2026  
**Reviewed By:** TreVon Hines, Managing Member

---

## 1. Scope
This policy governs the retention and disposal of consumer financial data collected via the Budget OS application, including data retrieved from the Plaid API.

## 2. Retention Schedule

| Data Type | Retention Period | Basis |
|---|---|---|
| Billing and subscription records | 7 years from transaction date | IRS financial record-keeping requirements |
| Plaid-linked account data (balances, transactions) | Duration of active account | User consent; deleted on account deletion |
| User profile and authentication data | Duration of active account | Service provision; deleted on account deletion |
| Anonymized billing records (post-account deletion) | 7 years from anonymization date | IRS compliance |

## 3. Disposal Procedures

- **Account Deletion:** When a user deletes their account, all personal data (profile, linked accounts, Plaid items, financial data) is permanently deleted from the database.
- **Billing Records Exception:** Subscription and billing rows are anonymized (personally identifiable information removed) rather than deleted, and retained for 7 years to satisfy IRS requirements. The `anonymized_at` timestamp is recorded.
- **Plaid Access Tokens:** On account deletion or Plaid item removal, the access token is revoked via the Plaid `/item/remove` API endpoint before deletion from our database.

## 4. Policy Review
This policy is reviewed annually or upon any material change to data handling practices.

---
*TRE Forged LLC — contact@treforged.com*
