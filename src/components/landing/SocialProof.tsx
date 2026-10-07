import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import {
  APP_STORE_REVIEWS_URL,
  fetchAppStoreRating,
  formatAverage,
  type StoreRating,
} from '@/lib/store-rating';
import { TESTIMONIALS, type Testimonial } from '@/data/testimonials';

interface SocialProofProps {
  /** Injected in tests; the page passes nothing. */
  loadRating?: () => Promise<StoreRating | null>;
  testimonials?: readonly Testimonial[];
}

/**
 * Live App Store rating + approved testimonials, beside the download buttons (ask 4f473837).
 * Renders NOTHING when there is no real rating and no approved testimonial - never a placeholder.
 */
export default function SocialProof({
  loadRating = fetchAppStoreRating,
  testimonials = TESTIMONIALS,
}: SocialProofProps) {
  const { t } = useTranslation('landing');
  const [rating, setRating] = useState<StoreRating | null>(null);

  useEffect(() => {
    let alive = true;
    loadRating().then((r) => {
      if (alive) setRating(r);
    });
    return () => {
      alive = false;
    };
  }, [loadRating]);

  if (!rating && testimonials.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col items-center gap-4 w-full max-w-2xl" data-testid="social-proof">
      {rating && (
        <a
          href={APP_STORE_REVIEWS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-foreground/80 hover:text-foreground"
          data-testid="store-rating"
        >
          <Star className="w-4 h-4 fill-gold text-gold" aria-hidden="true" />
          <span className="font-semibold text-foreground">{formatAverage(rating.average)}</span>
          <span>{t('socialProof.ratingCount', { count: rating.count })}</span>
        </a>
      )}

      {testimonials.length > 0 && (
        <ul className="grid gap-3 w-full sm:grid-cols-2" aria-label={t('socialProof.testimonialsLabel')}>
          {testimonials.map((item) => (
            <li key={item.id} className="card-forged p-4 text-left" data-testid="testimonial">
              <blockquote className="text-sm text-foreground">&ldquo;{item.quote}&rdquo;</blockquote>
              <p className="mt-2 text-xs text-foreground/70">{item.name}</p>
              {item.rewarded && (
                <p className="mt-1 text-[11px] text-muted-foreground" data-testid="testimonial-disclosure">
                  {t('socialProof.rewardDisclosure')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
