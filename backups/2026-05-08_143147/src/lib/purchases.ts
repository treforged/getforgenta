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

let configured = false;

export async function initRevenueCat(userId: string): Promise<void> {
  if (!isNative()) return;
  if (configured) return;

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
  configured = true;
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!isNative() || !configured) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  return Purchases.getOfferings();
}

export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<CustomerInfo | null> {
  if (!isNative() || !configured) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!isNative() || !configured) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  const { customerInfo } = await Purchases.restorePurchases();
  return customerInfo;
}

export async function logOutRevenueCat(): Promise<void> {
  if (!isNative() || !configured) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.logOut();
  configured = false;
}

export type { CustomerInfo, PurchasesOfferings, PurchasesPackage };
