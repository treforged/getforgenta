/**
 * RevenueCat SDK wrapper — iOS native only.
 *
 * All exports are safe to import on web. Guards prevent the SDK from
 * initialising or being called outside of a native iOS context.
 */
import { Capacitor } from '@capacitor/core';

import type {
  CustomerInfo,
  PurchasesOfferings,
  PurchasesPackage,
} from '@revenuecat/purchases-capacitor';

const isIos = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

let configured = false;

export async function initRevenueCat(userId: string): Promise<void> {
  if (!isIos()) return;
  if (configured) return;

  const apiKey = import.meta.env.VITE_REVENUECAT_IOS_API_KEY as string | undefined;
  if (!apiKey) {
    console.warn('[RevenueCat] VITE_REVENUECAT_IOS_API_KEY not set — IAP disabled');
    return;
  }

  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.configure({ apiKey, appUserID: userId });
  configured = true;
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!isIos() || !configured) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  return Purchases.getOfferings();
}

export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<CustomerInfo | null> {
  if (!isIos() || !configured) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!isIos() || !configured) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  const { customerInfo } = await Purchases.restorePurchases();
  return customerInfo;
}

export async function logOutRevenueCat(): Promise<void> {
  if (!isIos() || !configured) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.logOut();
  configured = false;
}

export type { CustomerInfo, PurchasesOfferings, PurchasesPackage };
