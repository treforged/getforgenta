// @vitest-environment jsdom
//
// SCREENSHOT CAPTURE MODE hides only the demo's guide cards. Pressed through the real provider:
// each case asserts what `showDemoGuides` BECOMES, and plain /demo must always bring the guides back.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DemoProvider, useDemo, DEMO_CAPTURE_KEY } from '../DemoContext';

function Probe() {
  const { isDemo, showDemoGuides, setIsDemo } = useDemo();
  return (
    <div>
      <p data-testid="state">{`demo=${isDemo} guides=${showDemoGuides}`}</p>
      <button onClick={() => setIsDemo(true, { capture: true })}>capture</button>
      <button onClick={() => setIsDemo(true, { capture: false })}>plain</button>
      <button onClick={() => setIsDemo(true)}>bare</button>
      <button onClick={() => setIsDemo(false)}>leave</button>
    </div>
  );
}

const state = () => screen.getByTestId('state').textContent;

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe('demo capture mode', () => {
  it('plain /demo shows the guide cards', () => {
    render(<DemoProvider><Probe /></DemoProvider>);
    fireEvent.click(screen.getByText('plain'));
    expect(state()).toBe('demo=true guides=true');
  });

  it('/demo?capture=1 hides the guide cards but is still the demo', () => {
    render(<DemoProvider><Probe /></DemoProvider>);
    fireEvent.click(screen.getByText('capture'));
    expect(state()).toBe('demo=true guides=false');
    expect(window.sessionStorage.getItem(DEMO_CAPTURE_KEY)).toBe('true');
  });

  it('paired: entering plain /demo after a capture brings the guides back', () => {
    render(<DemoProvider><Probe /></DemoProvider>);
    fireEvent.click(screen.getByText('capture'));
    fireEvent.click(screen.getByText('plain'));
    expect(state()).toBe('demo=true guides=true');
    expect(window.sessionStorage.getItem(DEMO_CAPTURE_KEY)).toBeNull();
  });

  it('leaving the demo ends capture', () => {
    render(<DemoProvider><Probe /></DemoProvider>);
    fireEvent.click(screen.getByText('capture'));
    fireEvent.click(screen.getByText('leave'));
    fireEvent.click(screen.getByText('bare'));
    expect(state()).toBe('demo=true guides=true');
  });

  it('a reload inside a capture tab stays in capture mode', () => {
    window.sessionStorage.setItem('forged:demo_session', 'true');
    window.sessionStorage.setItem(DEMO_CAPTURE_KEY, 'true');
    render(<DemoProvider><Probe /></DemoProvider>);
    expect(state()).toBe('demo=true guides=false');
  });
});
