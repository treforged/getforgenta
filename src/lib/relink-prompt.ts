/**
 * Which re-link prompt a bank connection row shows on the Accounts tab, if any.
 *
 * ⚠️ A BROKEN LINK USED TO SHOW NOTHING. When Plaid answers ITEM_LOGIN_REQUIRED, sync-handler marks
 * the connection `reauth_required` and STOPS syncing it. The row's prompt never read
 * connection_status, so the user saw only "Synced 3 days ago" and a plain Re-link button, with
 * nothing saying the balances had stopped updating. Found 2026-10-06 while answering Ruby's
 * ask 8dd3c5ab ("what does the user see when a Plaid link breaks?").
 *
 * The broken-link cases come FIRST: a paused sync makes every figure on the Dashboard stale, which
 * matters more than missing statement data.
 */
import type { ConnectionStatus } from '@/hooks/useFinancialConnections';

export interface RelinkPromptInput {
  readonly provider: string;
  readonly connectionStatus: ConnectionStatus;
  readonly neverSynced: boolean;
  readonly noAccounts: boolean;
  readonly missingLiabilities: boolean;
  readonly consentRequired: boolean;
}

export interface RelinkPrompt {
  readonly message: string;
  readonly label: string;
}

export function relinkPrompt(input: RelinkPromptInput): RelinkPrompt | null {
  // Re-link opens Plaid in update mode, so it only applies to Plaid. A broken Akoya grant is
  // fixed by connecting again from scratch.
  if (input.provider !== 'plaid') return null;
  if (input.connectionStatus === 'reauth_required') {
    return { message: 'Your bank asked you to sign in again. Balances stop updating until you re-link.', label: 'Re-link' };
  }
  if (input.connectionStatus === 'error') {
    return { message: 'The last sync failed. Balances may be out of date - re-link to try again.', label: 'Re-link' };
  }
  if (input.neverSynced || input.noAccounts) {
    return { message: 'Sync pulled no accounts — re-link to try again.', label: 'Re-link' };
  }
  if (input.consentRequired) {
    return {
      message: 'Your bank needs your OK to share statements. Allow it to fill in APR, minimum and due date.',
      label: 'Allow statement data',
    };
  }
  if (input.missingLiabilities) {
    return { message: 'Re-link to auto-populate APR and minimum payment from your bank.', label: 'Re-link' };
  }
  return null;
}

/** A Plaid connection whose sync has stopped until the user re-links it. */
export function isBrokenLink(item: { readonly provider: string; readonly connection_status: ConnectionStatus }): boolean {
  return item.provider === 'plaid' && (item.connection_status === 'reauth_required' || item.connection_status === 'error');
}

/** Every broken Plaid connection, in the order given. Returns a new array. */
export function brokenLinkItems<T extends { readonly provider: string; readonly connection_status: ConnectionStatus }>(items: readonly T[]): T[] {
  return items.filter(isBrokenLink);
}
