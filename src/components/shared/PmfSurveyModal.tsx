import { useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ModalShell from '@/components/shared/ModalShell';
import {
  PMF_FOLLOW_UP,
  PMF_OPTIONS,
  PMF_QUESTION,
  PMF_SEEN_FLAG,
  PMF_SURVEY_VERSION,
  type PmfSentiment,
} from '@/lib/pmf-survey';

interface Props {
  /** Called once the account has been marked as asked, whatever the user did. */
  onDismiss: () => void;
}

/**
 * The Sean Ellis survey, asked once per account.
 *
 * ⚠️ THE FOLLOW-UP IS ONLY SHOWN TO `very_disappointed`, AND THAT IS THE POINT OF THE SURVEY.
 * Asking everyone what they would miss most produces a list from people who would miss nothing.
 * The disappointed users are the only ones whose answer names a value proposition.
 *
 * ⚠️ THE SENTIMENT IS WRITTEN BEFORE THE FOLLOW-UP IS ANSWERED, and the follow-up is a second
 * write. That order is deliberate: somebody who picks an answer and then closes the modal without
 * typing has still told us the thing the survey is for. Holding the sentiment hostage to a free
 * text box would silently drop the answers of everyone who does not feel like writing - which
 * biases the proportion toward the people who write, not the people who feel.
 *
 * ⚠️ IT IS MARKED AS ASKED EVEN IF THEY CLOSE IT UNANSWERED. A survey that returns until it gets
 * an answer is a survey that gets a random answer.
 */
export default function PmfSurveyModal({ onDismiss }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sentiment, setSentiment] = useState<PmfSentiment | null>(null);
  /**
   * ⚠️ THE VIEW IS DRIVEN BY THIS, NOT BY `sentiment`, AND A TEST FOUND OUT WHY.
   * Driving it off `sentiment` meant that choosing "Not disappointed" flipped to the follow-up
   * step and only THEN closed the modal - so a user who is not disappointed saw
   * "What would you miss most?" flash at them on the way out. It threw nothing, every write was
   * correct, and the only thing wrong was the frame in between.
   */
  const [askFollowUp, setAskFollowUp] = useState(false);
  const [wouldMiss, setWouldMiss] = useState('');
  const [busy, setBusy] = useState(false);

  /** Record that this account has been ASKED. Separate from what they said - see pmf-survey.ts. */
  const markAsked = async () => {
    if (!user) return;
    const { data } = await supabase.from('profiles').select('tour_flags').eq('user_id', user.id).maybeSingle();
    const flags = (data?.tour_flags as Record<string, boolean> | null) ?? {};
    await supabase
      .from('profiles')
      .update({ tour_flags: { ...flags, [PMF_SEEN_FLAG]: true } })
      .eq('user_id', user.id);
    qc.invalidateQueries({ queryKey: ['profile'] });
  };

  const close = async () => {
    if (busy) return;
    setBusy(true);
    await markAsked();
    onDismiss();
  };

  const choose = async (id: PmfSentiment) => {
    if (busy || sentiment) return;
    setSentiment(id);
    if (id === 'very_disappointed') setAskFollowUp(true);
    if (!user) return;
    // Upsert on (user_id, survey_version): the unique index is the guard, so a double press or a
    // second device cannot create a second row and count one person twice.
    // ⚠️ THE ERROR IS READ, AND THAT IS NOT DEFENSIVE BOILERPLATE - IT IS THE DEFECT THIS FILE
    // ALREADY HAD. The first live run of this modal rendered the question, accepted the press and
    // advanced to the follow-up while writing NOTHING: the table's UPDATE privilege had been
    // revoked, and an upsert is INSERT ... ON CONFLICT DO UPDATE, so PostgREST refused it. Every
    // jsdom test passed, because the mock resolves `{ error: null }`. A survey that looks like it
    // recorded an answer and did not is worse than no survey - it produces a confident proportion
    // over the people whose writes happened to succeed.
    const { error } = await supabase
      .from('pmf_responses')
      .upsert(
        { user_id: user.id, survey_version: PMF_SURVEY_VERSION, sentiment: id },
        { onConflict: 'user_id,survey_version' },
      );
    if (error) {
      setSentiment(null);
      setAskFollowUp(false);
      toast.error('Could not save that - please try again.');
      return;
    }
    if (id !== 'very_disappointed') await close();
  };

  const submitFollowUp = async () => {
    if (busy || !user) return;
    setBusy(true);
    const text = wouldMiss.trim();
    if (text) {
      const { error } = await supabase
        .from('pmf_responses')
        .update({ would_miss: text })
        .eq('user_id', user.id)
        .eq('survey_version', PMF_SURVEY_VERSION);
      if (error) {
        setBusy(false);
        toast.error('Could not save that - please try again.');
        return;
      }
    }
    await markAsked();
    onDismiss();
  };

  return (
    <ModalShell onDismiss={close}>
      <div className="flex items-start justify-between px-6 pt-6 pb-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">One quick question</p>
        <button
          onClick={close}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 -mt-1 -mr-1"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {!askFollowUp ? (
          <>
            <h2 className="text-base font-semibold text-foreground leading-snug">{PMF_QUESTION}</h2>
            <div className="space-y-2" role="radiogroup" aria-label={PMF_QUESTION}>
              {PMF_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={false}
                  onClick={() => void choose(o.id)}
                  disabled={busy}
                  className="w-full text-left px-4 py-3 text-sm border border-border btn-press hover:border-primary transition-colors disabled:opacity-60"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-foreground leading-snug">{PMF_FOLLOW_UP}</h2>
            <p className="text-xs text-muted-foreground">
              Thanks - this is the part that actually helps. A sentence is plenty.
            </p>
            <textarea
              value={wouldMiss}
              onChange={(e) => setWouldMiss(e.target.value)}
              rows={4}
              maxLength={1000}
              aria-label={PMF_FOLLOW_UP}
              className="w-full bg-input text-foreground border border-border px-3 py-2 text-sm"
              style={{ borderRadius: 'max(0px, calc(var(--radius) - 4px))' }}
            />
          </>
        )}
      </div>

      {askFollowUp && (
        <div className="px-6 pb-6 pt-4 border-t border-border/40">
          <button
            onClick={() => void submitFollowUp()}
            disabled={busy}
            className="w-full py-2.5 bg-primary text-primary-foreground text-xs font-semibold btn-press disabled:opacity-60"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Send
          </button>
        </div>
      )}
    </ModalShell>
  );
}
