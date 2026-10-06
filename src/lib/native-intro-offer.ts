/**
 * The STORE intro offer on the native paywall (ask a6375f1c): $0.99/mo for 12 months or $9.99 for the first year.
 * The stores apply the offer themselves; this only decides what the paywall SAYS. Any doubt reads as no offer.
 * Drafted by the free tier (groq gpt-oss-120b), reviewed by Ada.
 */
export interface IntroPriceLike {
  readonly price: number;
  readonly priceString: string;
  readonly cycles: number;
  readonly periodUnit: string;
  readonly periodNumberOfUnits: number;
}

export interface ProductLike {
  readonly priceString: string;
  readonly introPrice: IntroPriceLike | null;
}

export type NativePlatform = 'ios' | 'android';

/** RevenueCat INTRO_ELIGIBILITY_STATUS numbers: 0 unknown, 1 ineligible, 2 eligible, 3 no intro offer exists. */
export const INTRO_ELIGIBLE = 2;

export interface IntroOfferView {
  readonly introPrice: string;
  readonly term: string;
  readonly thenPrice: string;
}

/**
 * Returns a view model for a native intro offer, or null when the offer should
 * not be displayed according to platform rules and data validation.
 */
export function nativeIntroOffer(
  product: ProductLike,
  isAnnual: boolean,
  platform: NativePlatform,
  iosEligibility: number | undefined,
): IntroOfferView | null {
  const intro = product.introPrice;
  if (intro === null) return null;
  if (intro.price <= 0) return null;
  if (intro.cycles < 1 || intro.periodNumberOfUnits < 1) return null;
  if (platform === 'ios' && iosEligibility !== INTRO_ELIGIBLE) return null;

  const totalUnits = intro.cycles * intro.periodNumberOfUnits;
  const unit = intro.periodUnit;

  // Build the term string.
  let term: string;
  if (unit === 'MONTH') {
    if (totalUnits === 12) {
      term = 'first year';
    } else if (totalUnits === 1) {
      term = 'first month';
    } else {
      term = `first ${totalUnits} months`;
    }
  } else if (unit === 'YEAR') {
    if (totalUnits === 1) {
      term = 'first year';
    } else {
      term = `first ${totalUnits} years`;
    }
  } else if (unit === 'WEEK') {
    if (totalUnits === 1) {
      term = 'first week';
    } else {
      term = `first ${totalUnits} weeks`;
    }
  } else if (unit === 'DAY') {
    if (totalUnits === 1) {
      term = 'first day';
    } else {
      term = `first ${totalUnits} days`;
    }
  } else {
    return null; // Unknown period unit.
  }

  // Build the intro price string.
  const introPrice =
    unit === 'MONTH' && intro.periodNumberOfUnits === 1
      ? `${intro.priceString}/mo`
      : intro.priceString;

  const thenPrice = `${product.priceString}/${isAnnual ? 'yr' : 'mo'}`;

  return {
    introPrice,
    term,
    thenPrice,
  };
}

