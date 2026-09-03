import { Check, ExternalLink } from 'lucide-react';
import { SOCIAL_LINKS } from '@/lib/social-links';
import { useSocialAchievements, useClaimSocialAchievement } from '@/hooks/useSocialAchievements';

/**
 * "Follow along" — two links out, and a badge for going.
 *
 * ⚠️ THE BADGE DESCRIBES THE TAP, NOT THE FOLLOW, and every word here is chosen for that. The app
 * observes that someone opened the profile; it cannot observe whether they followed, because
 * neither platform will tell a consumer app. So the earned state reads "Tapped through to
 * Instagram" rather than "Followed us on Instagram" — the second would be a fact the app cannot
 * stand behind, which is the same error as drawing a gauge value that was never read.
 *
 * It sits inside the Learn card but visually separated, because it is NOT part of the lesson
 * ring: these badges are unverifiable and must never count toward anything that matters. See
 * `social-links.ts`.
 *
 * The link opens in a new tab with `noopener,noreferrer` — a target="_blank" without it hands the
 * opened page a handle on this one.
 */
export default function SocialFollowRow() {
  const { claimed, canClaim, loading } = useSocialAchievements();
  const claim = useClaimSocialAchievement();

  if (loading) return null;

  const isClaimed = (id: string) => claimed.includes(id as never);

  return (
    <div className="pt-3 mt-1 border-t border-border space-y-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Follow along</p>

      <div className="flex flex-wrap gap-2">
        {SOCIAL_LINKS.map(link => {
          const earned = isClaimed(link.id);
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { if (canClaim && !earned) claim.mutate(link.id); }}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-[var(--radius)] transition-colors ${
                earned ? 'bg-secondary/60' : 'bg-secondary/30 hover:bg-secondary/60'
              }`}
            >
              {earned
                ? <Check className="w-3 h-3 text-primary" aria-hidden="true" />
                : <ExternalLink className="w-3 h-3 text-muted-foreground" aria-hidden="true" />}
              <span>{link.network}</span>
              <span className="text-muted-foreground">{link.handle}</span>
            </a>
          );
        })}
      </div>

      {/* Says what was actually recorded. A user who reads this and disagrees is right to, and
          would be able to tell that the app is not claiming to have checked. */}
      {claimed.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {SOCIAL_LINKS.filter(l => isClaimed(l.id)).map(l => l.earnedLabel).join(' · ')}
        </p>
      )}
    </div>
  );
}
