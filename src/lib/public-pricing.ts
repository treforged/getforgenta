/**
 * Whether a shared build link publishes what the parts cost.
 *
 * ⚠️ THE DEFAULT IS THE OPPOSITE OF `shouldPublishMaintenance`, and the asymmetry is the point.
 * The maintenance log was a NEW capability — nothing had been shared before, so private-by-default
 * took nothing from anyone, and an absent flag has to read as private. Pricing has been on every
 * shared build page since the feature existed. Reading an absent flag as "hide" would silently
 * change what an already-sent link shows to the people it was sent to, which is a decision the
 * owner never made. So: only an explicit `false` hides pricing.
 *
 * ⚠️ THE GATE MUST BE APPLIED WHERE THE DATA IS FETCHED, not where it is rendered. A price that
 * reaches the browser and is merely not drawn is still published — it is in the network tab. The
 * Edge Function therefore drops `price` from its SELECT, exactly as it drops `cost`, `vendor` and
 * `notes` from the maintenance allowlist.
 */
export function shouldPublishPricing(build: {
  pricing_public?: boolean | null;
}): boolean {
  return build.pricing_public !== false;
}
