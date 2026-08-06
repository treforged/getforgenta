/**
 * Provider registry.
 *
 * The single place that maps a stored `provider` value onto an implementation.
 * Nothing downstream should ever compare against a provider string directly.
 */

import { akoyaProvider } from "./akoya.ts";
import { plaidProvider } from "./plaid.ts";
import type { FinancialProvider, ProviderId } from "./types.ts";

const REGISTRY: Record<ProviderId, FinancialProvider> = {
  plaid: plaidProvider,
  akoya: akoyaProvider,
};

export function getProvider(id: string): FinancialProvider {
  const provider = REGISTRY[id as ProviderId];
  if (!provider) throw new Error(`Unknown financial provider: ${id}`);
  return provider;
}

export function isProviderId(value: string): value is ProviderId {
  return value in REGISTRY;
}

export * from "./types.ts";
