import { createRoot } from 'react-dom/client';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { createClient } from '@launchdarkly/js-client-sdk';
import Observability from '@launchdarkly/observability';
import SessionReplay from '@launchdarkly/session-replay';
import App from './App.tsx';
import './index.css';

const ldClientId = import.meta.env.VITE_LD_CLIENT_ID;
if (ldClientId) {
  try {
    createClient(
      ldClientId,
      { kind: 'user', anonymous: true },
      {
        plugins: [
          new Observability({
            networkRecording: { enabled: true, recordHeadersAndBody: true },
            serviceName: 'forged-web',
          }),
          new SessionReplay({
            privacySetting: 'strict',
            serviceName: 'forged-web',
          }),
        ],
      }
    );
  } catch (_e) {
    // non-critical — app renders without observability
  }
}

try { injectSpeedInsights(); } catch (_e) { /* no-op outside Vercel */ }

createRoot(document.getElementById('root')!).render(<App />);
