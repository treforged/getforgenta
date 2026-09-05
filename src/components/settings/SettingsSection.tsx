import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * ONE SHAPE FOR EVERY SECTION OF THE SECURITY TAB.
 *
 * Item 20 — Tre asked for symmetry across these sections, and the header markup was already
 * identical in all six places. That was the problem: identical by COPY, in five separate files,
 * with nothing keeping them that way. What had already drifted was everything around it — Change
 * Email and Two-Factor Authentication carried no description at all while the other four did, and
 * Change Email's button was `px-3 py-2` against `px-2.5 py-1` everywhere else. Six copies is five
 * chances to drift again on the next edit.
 *
 * So the header, the description and the optional state badge live HERE, and the sections pass
 * their own content. A new section gets the shape for free and cannot invent a sixth variant.
 *
 * WHY EVERY SECTION MUST HAVE A DESCRIPTION. These are security controls: what "Trusted Devices"
 * or "Partner Link" actually shares is not guessable from two words, and a person deciding whether
 * to turn one on is exactly the person who should not have to guess. `description` is therefore
 * required, not optional — the type is what stops the next section shipping without one.
 */
type Props = {
  icon: LucideIcon;
  title: string;
  /** Required. One sentence saying what this control does, in plain words. See above. */
  description: string;
  /** Tone of the leading icon. `active` marks a protection that is currently switched ON. */
  tone?: 'default' | 'active';
  /** A short state word beside the title — "ON", "Linked". Absent when there is no state to state. */
  badge?: string;
  children?: ReactNode;
};

/**
 * The heading and blurb on their own, for a section whose body has SEVERAL RETURN BRANCHES.
 *
 * `PartnerLink` and `FriendLink` each render six or four different bodies — demo teaser, loading,
 * unlinked, pending, linked — and every one of them opens its own wrapper. Wrapping those in
 * `SettingsSection` would mean threading the same title and description through six call sites, or
 * restructuring a live security surface for no visible change. They render this instead, so the
 * part that must not drift — the heading and the blurb — has ONE implementation either way, which
 * is the whole point of the exercise.
 */
export function SettingsSectionHeading({ icon: Icon, title, description, tone = 'default', badge }: Omit<Props, 'children'>) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Icon size={13} className={tone === 'active' ? 'text-primary' : 'text-muted-foreground'} />
        <span className="text-xs font-medium">{title}</span>
        {badge && (
          <span
            className="text-xs px-1 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </>
  );
}

export default function SettingsSection({ children, ...heading }: Props) {
  return (
    <div className="space-y-3">
      <SettingsSectionHeading {...heading} />
      {children}
    </div>
  );
}
