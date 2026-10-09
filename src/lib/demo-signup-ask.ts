/**
 * The demo's signup ask at its value moment (Tre approved 10-09, relayed by Sam; growth pass
 * Proposal B). 7 demo opens from 10-01 to 10-09 produced 0 `demo_signup_tap`: the only ask was
 * the banner strip above the dashboard, and pressing "Add $36" in quick add got the generic
 * read-only refusal. Now that press - the moment the visitor has just done the thing - asks.
 *
 * ⚠️ It promises a plan, not that quick add will save: in the native app a free account's `+` is a
 * Premium door (decision 10-09), so "and it saves" would be untrue there.
 */
export const DEMO_QUICK_ADD_ASK = {
  title: "That's the 5-tap add.",
  description: 'Make it yours: sign up free and build your own plan.',
  action: 'Sign up free',
  /** `signup_funnel_events.detail`, so these taps read apart from the banner's. */
  funnelDetail: 'quick_add',
} as const;
