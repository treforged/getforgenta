// THE on/off control. One implementation, used on every tab.
//
// Tre, 2026-09-13: "make the sharing toggles more like a switch. they are weird to understand as
// is. they dont look like normal buttons. consider design of other apps when thinking about our
// design always. and consistency across tabs."
//
// ⚠️ HE COULD NOT READ THE STATE, which is a different complaint from "make it prettier". The
// sharing toggles were buttons reading "Sharing" / "Off" inside a bordered box: to know what one
// would do you had to read the word, decide whether it described the CURRENT state or the ACTION,
// and then guess. A switch answers both at a glance because everyone already knows it — the knob
// is left or right, and the track is on or off. Novelty costs a moment of thought per user per
// encounter, and a custom on/off control is never where that cost is worth paying.
//
// ⚠️ THIS BODY WAS NOT INVENTED HERE. It is lifted verbatim from the switch that already lived
// inside `NotificationSettings`, because that one had been MEASURED in a browser and carries the
// fix for a defect Tre reported on eight toggles at once. Writing a fresh switch would have
// reintroduced it — which is the whole argument for there being one of these.
//
// ⚠️ MEASURED PIXELS, NOT CLASS NAMES. This app's root font is scaled, so `w-8` is a ~36px track
// rather than 32px. Reason about this control in the numbers below, which came from Chrome.
export function ToggleSwitch({ checked, onPress, disabled = false, label }: {
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Describes the SETTING, not the action — screen readers announce the state from `role`. */
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`shrink-0 w-8 h-4 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-secondary border border-border'} relative disabled:opacity-60`}
    >
      {/*
        ⚠️ `left-0` IS LOAD-BEARING. Without it the knob is absolutely positioned with NO horizontal
        anchor, so it starts from its STATIC position — roughly the centre of the button, because a
        button centres its content — and the translate is applied from there. MEASURED in Chrome:
        the ON knob's right edge sat **14px OUTSIDE** a 36px track. Tre saw it on eight toggles at
        once and said we have shipped this before.

        With the anchor, both states derive from the same origin and both fit, measured in the same
        browser: OFF spans 2..16 and ON spans 18..32 inside a 36px track.
      */}
      <span className={`absolute top-0.5 left-0 w-3 h-3 rounded-full bg-background transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}
