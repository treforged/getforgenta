// Unmount what the tests mount. Registered as vitest `setupFiles`.
//
// WHY THIS EXISTS. React Testing Library auto-registers its own `afterEach(cleanup)` ONLY when a
// global `afterEach` is present — i.e. when vitest runs with `globals: true`. This repo does not,
// so nothing ever unmounted anything: every component and hook mounted by `render`/`renderHook`
// stayed mounted for the rest of the file.
//
// That is not merely untidy. React's scheduler queues work with `setImmediate`, and
// `performWorkUntilDeadline` can fire AFTER vitest has torn down the jsdom environment for that
// file — at which point `window` no longer exists and the run dies with
//
//   ReferenceError: window is not defined
//     ❯ node_modules/react-dom/cjs/react-dom-client.development.js
//     ❯ Immediate.performWorkUntilDeadline node_modules/scheduler/cjs/scheduler.development.js
//
// as an UNHANDLED error, which fails the whole run while every individual test still reports
// passing. It landed on CI run 33785823643 in `useSupabaseData.partnerView.test.tsx` and not on
// the run before it, on identical test code — because whether the callback beats the teardown is
// a race, decided by machine speed and file ordering.
//
// `vite.config.ts` already records the lesson this is the second instance of: "an intermittently
// red suite is worse than a slow one: it trains everybody to read a failure as 'probably the
// flaky one', and that is how a real failure gets waved through." A flake that only appears under
// CI load is the same trap wearing different clothes.

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
