import { useState } from 'react';
import { Award, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useMilestoneAchievements } from '@/hooks/useMilestoneAchievements';
import { lookupMilestone } from '@/lib/milestone-achievements';
import { buildAchievementCard } from '@/lib/share-card';
import { markAnnounced, pickNewBadge, readAnnounced } from '@/lib/new-badge';
import ShareCardButton from '@/components/shared/ShareCardButton';

/**
 * One line on the dashboard's Home tab when a milestone badge has just been earned, with Share and
 * Dismiss (Sam 2026-09-30: invite at a moment of value; the user starts every share).
 *
 * Mounting this is also what GRANTS milestones on a normal visit. Since 2026-09-17 the only caller
 * of `claim_milestone_achievements` was the Trophy Case inside Account > Achievements, so a goal
 * reached earned nothing anyone saw until they happened to open that tab.
 */
export default function NewBadgeRow() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { data } = useMilestoneAchievements();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (isDemo || !user) return null;
  const rows = data.map((m) => ({ ...m, known: !!lookupMilestone(m.id) }));
  const seen = readAnnounced(user.id);
  if (dismissed) seen.add(dismissed);
  const badge = pickNewBadge(rows, seen, new Date());
  if (!badge || !badge.earnedAt) return null;

  const dismiss = () => {
    markAnnounced(user.id, badge.id);
    setDismissed(badge.id);
  };

  return (
    <div className="card-forged px-3 py-2.5 flex items-center gap-2.5" role="status" data-testid="new-badge-row">
      <Award className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
      <p className="text-xs flex-1 min-w-0">
        <span className="text-muted-foreground">New badge: </span>
        <span className="font-medium">{badge.name}</span>
      </p>
      <ShareCardButton
        spec={buildAchievementCard(badge, badge.earnedAt)}
        title={`Share your ${badge.name} badge`}
        note="This is exactly what will be shared. It shows the badge name and the month, never your numbers."
        imageAlt={`Your ${badge.name} badge card`}
        filename="forgenta-badge.png"
        share={{ title: `I earned ${badge.name} on Forgenta`, campaign: 'badge' }}
        buttonTestId={`share-new-badge-${badge.id}`}
      />
      <button
        type="button"
        onClick={dismiss}
        aria-label={`Dismiss the ${badge.name} badge`}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors btn-press p-1"
      >
        <X size={14} />
      </button>
    </div>
  );
}
