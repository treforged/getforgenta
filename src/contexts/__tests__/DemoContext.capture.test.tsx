// @vitest-environment jsdom
//
// SCREENSHOT CAPTURE MODE hides the demo's guide cards, and `isCapture` (the tab bar, the demo
// banner and the DEMO chip read it, ask b3573355) is on ONLY for the capture URL. Pressed through the real provider:
// each case asserts what `showDemoGuides` BECOMES, and plain /demo must always bring the guides back.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DemoProvider, useDemo, DEMO_CAPTURE_KEY } from '../DemoContext';

function Probe() {
  const { isDemo, showDemoGuides, isCapture, setIsDemo } = useDemo();
  return (
    <div>
      <p data-testid="state">{`demo=${isDemo} guides=${showDemoGuides} capture=${isCapture}`}</p>
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
    expect(state()).toBe('demo=true guides=true capture=false');
  });

  it('/demo?capture=1 hides the guide cards but is still the demo', () => {
    render(<DemoProvider><Probe /></DemoProvider>);
    fireEvent.click(screen.getByText('capture'));
    expect(state()).toBe('demo=true guides=false capture=true');
    expect(window.sessionStorage.getItem(DEMO_CAPTURE_KEY)).toBe('true');
  });

  it('paired: entering plain /demo after a capture brings the guides back', () => {
    render(<DemoProvider><Probe /></DemoProvider>);
    fireEvent.click(screen.getByText('capture'));
    fireEvent.click(screen.getByText('plain'));
    expect(state()).toBe('demo=true guides=true capture=false');
    expect(window.sessionStorage.getItem(DEMO_CAPTURE_KEY)).toBeNull();
  });

  it('leaving the demo ends capture', () => {
    render(<DemoProvider><Probe /></DemoProvider>);
    fireEvent.click(screen.getByText('capture'));
    fireEvent.click(screen.getByText('leave'));
    fireEvent.click(screen.getByText('bare'));
    expect(state()).toBe('demo=true guides=true capture=false');
  });

  it('isCapture is never on outside the demo', () => {
    window.sessionStorage.setItem(DEMO_CAPTURE_KEY, 'true');
    render(<DemoProvider><Probe /></DemoProvider>);
    expect(state()).toBe('demo=false guides=false capture=false');
  });

  it('a reload inside a capture tab stays in capture mode', () => {
    window.sessionStorage.setItem('forged:demo_session', 'true');
    window.sessionStorage.setItem(DEMO_CAPTURE_KEY, 'true');
    render(<DemoProvider><Probe /></DemoProvider>);
    expect(state()).toBe('demo=true guides=false capture=true');
  });
});
