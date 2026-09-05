import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { initMonitoring } from './lib/monitoring'
import { installModalDismissGuard } from './lib/modal-dismiss-guard'
import { maybeLoadDebugConsole } from './lib/debug-console'
// Side-effect import: i18next must be initialised BEFORE the first render, or the
// first paint shows raw translation keys and then restates itself.
import './lib/i18n'

// MONITORING IS NOT PART OF THE FIRST PAINT, and it used to be. The two vendor
// chunks behind it are the largest things this app ships after the charts
// bundle -- 421 kB and 365 kB raw, about 225 kB gzipped between them -- and
// calling `initMonitoring()` on this line started both downloads before the
// React root had been created. Measured on production: one of them was among
// the slowest resources on a cold load of the marketing page, where nothing
// about it is needed at all.
//
// They were already dynamic imports, which is why this was easy to miss: the
// chunks are split correctly and are still fetched immediately, competing for
// bandwidth and for main-thread parse time with the code that actually draws
// the screen.
//
// So it waits for the browser to be idle, with a timeout so it always runs on a
// page that never goes idle. The cost is a window of a second or so at startup
// in which a thrown error is not reported to the vendor; `reportError` no-ops
// until the plugins are up, and the ErrorBoundary still catches and still
// renders. That is the right trade for a finance app whose first screen is a
// person waiting to see their money.
// Before the first render, and cheap: two document listeners. A modal that
// closes while you are selecting text in it is a bug you can hit on the first
// screen, so this one does not wait for idle.
installModalDismissGuard();

// Opt-in in-page debug console, for testing a preview build on a real phone.
// It loads in NON-PRODUCTION builds that explicitly ask for it and nowhere
// else; in a production build the branch inside folds to `false` and the
// dynamic import is eliminated entirely. `npm run check:debug-console`
// fails the build if it ever is not. See src/lib/debug-console.ts.
void maybeLoadDebugConsole();

const startMonitoring = () => initMonitoring();
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  window.requestIdleCallback(startMonitoring, { timeout: 3000 });
} else {
  setTimeout(startMonitoring, 1500);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
