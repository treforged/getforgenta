/**
 * RevenueCat SDK wrapper — iOS and Android native only.
 *
 * All exports are safe to import on web. Guards prevent the SDK from
 * initialising or being called outside of a native context.
 */
import { Capacitor } from '@capacitor/core';

import type {
  CustomerInfo,
  PurchasesOfferings,
  PurchasesPackage,
} from '@revenuecat/purchases-capacitor';

const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * WHICH user the SDK is currently configured for, not merely THAT it is.
 *
 * ⚠️ A bare boolean latch was wrong in a way that only shows up on money. `configure` is what
 * ties a purchase to a person, so a second user arriving while the latch was still true would
 * have had their entitlements attached to the FIRST user's RevenueCat customer. Holding the id
 * makes "already configured" mean "already configured FOR THIS PERSON", which is the only
 * version of that question worth asking.
 */
let configuredUserId: string | null = null;

/** Test seam and sign-out reset. Not part of the public surface. */
export function __resetRevenueCatForTests(): void {
  configuredUserId = null;
}

/** Whether the SDK is ready to be called. Purchases silently no-op without it. */
export function isRevenueCatConfigured(): boolean {
  return configuredUserId !== null;
}

export async function initRevenueCat(userId: string): Promise<void> {
  if (!isNative()) return;
  if (configuredUserId === userId) return;
  // A DIFFERENT user on an already-configured SDK: hang up first, or their purchases land on
  // the previous customer. logOut is what returns the SDK to a state configure can claim.
  if (configuredUserId !== null) {
    try {
      const { Purchases } = await import('@revenuecat/purchases-capacitor');
      await Purchases.logOut();
    } catch {
      // Best effort. Configuring for the right user matters more than a clean hang-up.
    }
    configuredUserId = null;
  }

  const platform = Capacitor.getPlatform();
  const apiKey = platform === 'ios'
    ? (import.meta.env.VITE_REVENUECAT_IOS_API_KEY as string | undefined)
    : (import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY as string | undefined);

  if (!apiKey) {
    console.warn(`[RevenueCat] VITE_REVENUECAT_${platform.toUpperCase()}_API_KEY not set — IAP disabled`);
    return;
  }

  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.configure({ apiKey, appUserID: userId });
  configuredUserId = userId;
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!isNative() || configuredUserId === null) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  return Purchases.getOfferings();
}

export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<CustomerInfo | null> {
  if (!isNative() || configuredUserId === null) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!isNative() || configuredUserId === null) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  const { customerInfo } = await Purchases.restorePurchases();
  return customerInfo;
}

export async function logOutRevenueCat(): Promise<void> {
  if (!isNative() || configuredUserId === null) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.logOut();
  configuredUserId = null;
}

export async function presentCodeRedemptionSheet(): Promise<void> {
  if (!isNative() || configuredUserId === null) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.presentCodeRedemptionSheet();
}

export async function openAndroidOfferRedemption(): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: 'https://play.google.com/redeem' });
}

export type { CustomerInfo, PurchasesOfferings, PurchasesPackage };
