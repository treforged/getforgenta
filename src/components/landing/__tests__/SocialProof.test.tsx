// @vitest-environment jsdom
// Text and attributes only, which jsdom reports truthfully; no geometry is asserted here.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@/lib/i18n';
import SocialProof from '../SocialProof';
import type { Testimonial } from '@/data/testimonials';

afterEach(cleanup);

const rewarded: Testimonial = { id: 't1', quote: 'Paid off a card in 4 months.', name: 'Sam R.', rewarded: true };
const unpaid: Testimonial = { id: 't2', quote: 'Finally see my month.', name: 'Jo K.', rewarded: false };

describe('SocialProof (ask 4f473837)', () => {
  it('shows the LIVE rating and links to the App Store reviews', async () => {
    render(<SocialProof loadRating={async () => ({ average: 5, count: 5 })} testimonials={[]} />);
    const link = await screen.findByTestId('store-rating');
    expect(link.textContent).toContain('5.0');
    expect(link.textContent).toContain('5 ratings on the App Store');
    expect(link.getAttribute('href')).toContain('id6762540239');
  });

  it('uses the singular for one rating', async () => {
    render(<SocialProof loadRating={async () => ({ average: 4, count: 1 })} testimonials={[]} />);
    expect((await screen.findByTestId('store-rating')).textContent).toContain('1 rating on the App Store');
  });

  it('renders NOTHING when there is no rating and no testimonial', async () => {
    let settled = false;
    const { container } = render(
      <SocialProof loadRating={async () => { settled = true; return null; }} testimonials={[]} />,
    );
    await waitFor(() => expect(settled).toBe(true));
    expect(container.innerHTML).toBe('');
  });

  it('a REWARDED testimonial carries the disclosure; an unrewarded one does not', async () => {
    render(<SocialProof loadRating={async () => null} testimonials={[rewarded, unpaid]} />);
    const items = await screen.findAllByTestId('testimonial');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Received 3 free months of Premium');
    expect(items[1].querySelector('[data-testid="testimonial-disclosure"]')).toBeNull();
  });
});
