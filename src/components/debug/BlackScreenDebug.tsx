import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '@/contexts/AuthContext';

const DEV_EMAIL = 'tre@treforged.com';
const DEV_DEBUG_KEY = 'forged:dev_debug';

const LOG_KEY = 'forged:debug_log';

async function readLog(): Promise<string[]> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: LOG_KEY });
    if (!value) return [];
    return value.split('\n').filter(Boolean).reverse(); // newest first
  } catch {
    return [];
  }
}

async function clearLog(): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: LOG_KEY });
  } catch { /* ignore */ }
}

function parse(raw: string): { time: string; source: 'SWIFT' | 'JS'; event: string } {
  const pipe = raw.indexOf('|');
  const ts = parseInt(raw.slice(0, pipe), 10);
  const rest = raw.slice(pipe + 1);
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const isJS = rest.startsWith('JS:');
  return {
    time: `${hh}:${mm}:${ss}.${ms}`,
    source: isJS ? 'JS' : 'SWIFT',
    event: isJS ? rest.slice(3) : rest,
  };
}

const root: CSSProperties = {
  position: 'fixed',
  bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
  left: 'calc(12px + env(safe-area-inset-left, 0px))',
  zIndex: 99990,
};

const triggerBtn: CSSProperties = {
  background: 'rgba(239,68,68,0.92)', color: '#fff',
  border: 'none', borderRadius: 6,
  padding: '3px 7px', fontSize: 10, fontWeight: 800,
  fontFamily: 'monospace', letterSpacing: 1, cursor: 'pointer',
};

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 99991,
  background: 'rgba(2,6,23,0.97)',
  display: 'flex', flexDirection: 'column',
  fontFamily: 'ui-monospace, monospace', fontSize: 11,
  color: '#e2e8f0',
};

const header: CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0,
  padding: '10px 14px',
  paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
  paddingLeft: 'calc(14px + env(safe-area-inset-left, 0px))',
  paddingRight: 'calc(14px + env(safe-area-inset-right, 0px))',
  borderBottom: '1px solid #1e293b',
};

const legend: CSSProperties = {
  padding: '3px 14px', fontSize: 10, color: '#475569',
  paddingLeft: 'calc(14px + env(safe-area-inset-left, 0px))',
  paddingRight: 'calc(14px + env(safe-area-inset-right, 0px))',
  borderBottom: '1px solid #0f172a', flexShrink: 0,
};

const list: CSSProperties = {
  flex: 1, overflowY: 'auto', padding: '4px 0',
  paddingBottom: 'calc(4px + env(safe-area-inset-bottom, 0px))',
};

function Btn({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: color, color: '#fff', border: 'none',
        borderRadius: 5, padding: '3px 9px',
        fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
        letterSpacing: 0.5, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export default function BlackScreenDebug() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(() => localStorage.getItem(DEV_DEBUG_KEY) === '1');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setEnabled(localStorage.getItem(DEV_DEBUG_KEY) === '1');
    window.addEventListener('forgenta:dev-debug', handler);
    return () => window.removeEventListener('forgenta:dev-debug', handler);
  }, []);

  if (!Capacitor.isNativePlatform()) return null;
  if (user?.email !== DEV_EMAIL) return null;
  if (!enabled) return null;
  const [entries, setEntries] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setEntries(await readLog());
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [open, refresh]);

  return (
    <div style={root}>
      <button style={triggerBtn} onClick={() => setOpen(o => !o)}>DBG</button>

      {open && (
        <div style={overlay}>
          <div style={header}>
            <span style={{ flex: 1, fontWeight: 800, color: '#f87171', fontSize: 12 }}>
              BLACK SCREEN DEBUG
            </span>
            <Btn color="#0ea5e9" onClick={refresh}>↻</Btn>
            <Btn color="#f59e0b" onClick={async () => { await clearLog(); setEntries([]); }}>CLEAR</Btn>
            <Btn color="#475569" onClick={() => setOpen(false)}>✕</Btn>
          </div>

          <div style={legend}>
            <span style={{ color: '#34d399' }}>■ SWIFT</span>
            {'  '}
            <span style={{ color: '#818cf8' }}>■ JS</span>
            {'  ·  newest first  ·  auto-refresh 2 s'}
          </div>

          <div style={list}>
            {entries.length === 0 ? (
              <div style={{ padding: '24px 14px', color: '#334155', textAlign: 'center' }}>
                No events yet — reproduce the black screen then check here.
              </div>
            ) : entries.map((raw, i) => {
              const { time, source, event } = parse(raw);
              const isSwift = source === 'SWIFT';
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex', gap: 8, padding: '2px 14px',
                    borderBottom: '1px solid #0a0f1a',
                    background: isSwift ? 'transparent' : 'rgba(129,140,248,0.04)',
                  }}
                >
                  <span style={{ color: '#334155', flexShrink: 0, fontSize: 10 }}>{time}</span>
                  <span style={{ color: isSwift ? '#34d399' : '#818cf8', flexShrink: 0, width: 36, fontSize: 10 }}>
                    {source}
                  </span>
                  <span style={{ flex: 1, wordBreak: 'break-all', color: isSwift ? '#d1fae5' : '#c7d2fe' }}>
                    {event}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
