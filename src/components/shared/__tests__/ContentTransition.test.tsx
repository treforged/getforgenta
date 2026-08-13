// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ContentTransition from '../ContentTransition';

// The animation itself is framer-motion's job and is not what this file pins.
// What it pins is the trap that replacing an early
// `if (loading) return <Skeleton />` return sets: the loading GUARD.
//
// A page that early-returns on `loading` is relying on its body never being
// evaluated while the data is missing. Wrapping that body in a component makes
// it a `children` prop — and JSX children are constructed EAGERLY at the call
// site, so the body runs on the loading branch too and the page crashes on
// `undefined.map`. The function form exists solely to keep that guard, and
// these tests fail if it is ever quietly dropped.

afterEach(() => {
  cleanup();
});

describe('ContentTransition — the loading guard survives the wrapper', () => {
  it('does not evaluate function children while loading', () => {
    const render_ = vi.fn(() => <div>content</div>);

    render(
      <ContentTransition loading skeleton={<div>skeleton</div>}>
        {render_}
      </ContentTransition>,
    );

    // This is the whole point of the function form. If this ever fires while
    // loading, every page using it is one `undefined` away from a crash.
    expect(render_).not.toHaveBeenCalled();
    expect(screen.getByText('skeleton')).toBeTruthy();
  });

  it('evaluates function children once loading finishes', () => {
    const render_ = vi.fn(() => <div>content</div>);

    render(
      <ContentTransition loading={false} skeleton={<div>skeleton</div>}>
        {render_}
      </ContentTransition>,
    );

    expect(render_).toHaveBeenCalled();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('sequences skeleton out, then content in, when loading flips', async () => {
    const { rerender } = render(
      <ContentTransition loading skeleton={<div>skeleton</div>}>
        {() => <div>content</div>}
      </ContentTransition>,
    );
    expect(screen.queryByText('content')).toBeNull();

    rerender(
      <ContentTransition loading={false} skeleton={<div>skeleton</div>}>
        {() => <div>content</div>}
      </ContentTransition>,
    );

    // Deliberately awaited rather than asserted synchronously. `mode="wait"`
    // means the content is held back until the skeleton has finished exiting,
    // and that is the documented tradeoff of sequencing over an overlapping
    // cross-fade — the alternative needs both states absolutely positioned in
    // one box and breaks the moment content is a different height from its
    // skeleton. If someone switches this to a synchronous swap, this test is
    // where the behaviour change gets noticed.
    expect(await screen.findByText('content')).toBeTruthy();
    expect(screen.queryByText('skeleton')).toBeNull();
  });

  it('still accepts plain element children, for content with nothing to guard', () => {
    render(
      <ContentTransition loading={false} skeleton={<div>skeleton</div>}>
        <div>plain</div>
      </ContentTransition>,
    );
    expect(screen.getByText('plain')).toBeTruthy();
  });
});
