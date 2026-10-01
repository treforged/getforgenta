/**
 * Whether this page is running inside the HIDDEN background WebView that refreshes the home-screen
 * widgets while the app is closed (ask e74da89c), and the one channel that WebView offers back.
 *
 * ⚠️ WHY IT IS A GUARD AND NOT JUST A TRANSPORT. The hidden WebView shares the app's localStorage,
 * so it holds the user's real session. It must never run the idle sign-out or the resume recovery:
 * either could end the session the real app is about to open with. And it must never count as the
 * user opening the app, or Tre's 7-day inactivity rule (ask a7b1509e) would never fire.
 *
 * The native side exposes exactly one channel and no Capacitor bridge:
 *   Android  window.ForgentaWidgetHost.postMessage(json)
 *   iOS      window.webkit.messageHandlers.forgentaWidgetHost.postMessage(json)
 */
export interface WidgetHost {
  post: (json: string) => void;
}

type Channel = { postMessage: (json: string) => void };

function asChannel(value: unknown): Channel | null {
  if (typeof value !== 'object' || value === null) return null;
  const postMessage = (value as { postMessage?: unknown }).postMessage;
  return typeof postMessage === 'function' ? (value as Channel) : null;
}

export function getWidgetHost(win: Window = window): WidgetHost | null {
  try {
    const w = win as unknown as {
      ForgentaWidgetHost?: unknown;
      webkit?: { messageHandlers?: { forgentaWidgetHost?: unknown } };
    };
    const channel = asChannel(w.ForgentaWidgetHost)
      ?? asChannel(w.webkit?.messageHandlers?.forgentaWidgetHost);
    return channel ? { post: (json: string) => channel.postMessage(json) } : null;
  } catch {
    return null;
  }
}

export function isWidgetHost(win: Window = window): boolean {
  return getWidgetHost(win) !== null;
}
