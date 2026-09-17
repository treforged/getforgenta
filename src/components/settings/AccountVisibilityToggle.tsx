import { Loader2, Lock, Globe } from 'lucide-react';
import { ToggleSwitch } from '@/components/shared/ToggleSwitch';
import { useAccountVisibility } from '@/hooks/useAccountVisibility';

/**
 * PUBLIC OR PRIVATE - the rule that decides what a follow DOES.
 *
 * Tre, 2026-09-16: *"maybe we should make a follower System like how Instagram has and then you
 * can make a users account public or private. private would be friends only."*
 *
 * private (the default): a follow is a REQUEST you approve.
 * public:                a follow is immediate.
 *
 * ⚠️ IT USES THE SHARED `ToggleSwitch`, NOT A NEW ONE. There is exactly one switch in this app and
 * a gate that counts them. That control also carries a measured fix for a knob that rendered 14px
 * outside its own track, so a fresh switch here would reintroduce a defect Tre reported on eight
 * toggles at once.
 *
 * ⚠️ NOT GATED ON HAVING ANY FRIENDS OR FOLLOWERS, unlike the sharing toggles it sits beside.
 * Those publish a figure to people you are already connected to, so they are meaningless with
 * nobody to publish to. This one decides whether a STRANGER can follow you without asking - which
 * matters most in exactly the state where you have nobody yet, and hiding it until you do would
 * mean the first person to find you arrives under a rule you were never shown.
 *
 * ⚠️ THE LABEL DESCRIBES THE CONSEQUENCE, NOT THE SETTING. "Public account" alone does not tell
 * you what changes; these are privacy controls on an app holding debt and income, and this
 * portfolio's standing rule is that an ambiguous state is least affordable here of anywhere.
 */
export function AccountVisibilityToggle() {
  const { isPublic, isLoading, setVisibility, isUpdating } = useAccountVisibility();

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold pt-2">Who can follow you</h4>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5">
            {isPublic ? <Globe size={12} className="text-primary shrink-0" />
                      : <Lock size={12} className="text-muted-foreground shrink-0" />}
            {isPublic ? 'Public account' : 'Private account'}
          </p>
          {/* The sentence a user actually needs in order to choose. */}
          <p className="text-xs text-muted-foreground mt-0.5">
            {isPublic
              ? 'Anyone can follow you without your approval.'
              : 'New followers have to be approved by you.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(isUpdating || isLoading) && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
          <ToggleSwitch
            checked={isPublic}
            disabled={isLoading || isUpdating}
            onPress={() => setVisibility(isPublic ? 'private' : 'public')}
            label="Public account - anyone can follow you without approval"
          />
        </div>
      </div>
      {/*
        ⚠️ SAYS WHAT THIS DOES **NOT** DO, on purpose. Making an account public lets people follow
        it; it does NOT publish any figure to them. What a follower can see is still governed by
        the sharing toggles above and by `leaderboard_snapshots_select_friend`, which the follow
        graph is deliberately not wired into. Without this line "Public account" reads like a
        switch that exposes your money, and a user who believes that will never turn it on.
      */}
      <p className="text-xs text-muted-foreground">
        This only controls who can follow you. It does not share any of your numbers on its own.
      </p>
    </div>
  );
}
