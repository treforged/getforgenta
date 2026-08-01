import { useState, useMemo, useEffect, useRef } from 'react';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useTransactions, useDebts, useSavingsGoals, useAccounts, useRecurringRules, useCarFunds } from '@/hooks/useSupabaseData';
import { mergeWithGeneratedTransactions, type EnrichedTransaction } from '@/lib/pay-schedule';
import type { Json } from '@/integrations/supabase/types';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/lib/supabase';
import { tracedInvoke } from '@/lib/tracer';
import { formatCurrency } from '@/lib/calculations';
import { categorizeExpenses } from '@/lib/expense-filtering';
import PremiumGate from '@/components/shared/PremiumGate';
import {
  Sparkles, TrendingUp, AlertTriangle, CheckCircle2, Loader2,
  Send, ChevronRight, User, ArrowLeft, Plus, MessageSquare, History, X,
} from 'lucide-react';

const AI_CONSENT_VERSION = '2026-04-30-gemini-2.5-flash';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Insight {
  type: 'positive' | 'warning' | 'action';
  title: string;
  body: string;
}

type ResponseSection =
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'pie'; title: string; data: { label: string; value: number }[] };

interface AdviceResult {
  summary: string;
  score: number;
  scoreLabel: string;
  sections?: ResponseSection[];
  insights?: Insight[];
  nextMove: string;
  _history_id?: string;
  _history_created_at?: string;
  usage?: {
    used_today: number;
    limit_day: number;
    used_week: number;
    limit_week: number;
  };
}

interface ConversationTurn {
  question: string | null;
  summary: string;
  nextMove: string;
}

interface ChatEntry {
  id: string;
  question: string | null;
  result: AdviceResult;
  created_at: string;
  _pending?: boolean;
}

interface Conversation {
  id: string;
  title: string | null;
  entries: ChatEntry[];
  created_at: string;
}

interface AiHistoryRow {
  id: string;
  question: string | null;
  result: Json;
  created_at: string;
  conversation_id: string | null;
}

const QUICK_QUESTIONS = [
  'Am I on track to be debt-free this year?',
  'Where should I cut spending first?',
  'How much more should I be saving?',
  'Is my savings rate good for my income?',
];

const COOLDOWN_MS = 3000;

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreColor(pct: number) {
  if (pct >= 80) return '#22c55e';
  if (pct >= 60) return '#3b82f6';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(pct: number) {
  if (pct >= 80) return 'Excellent';
  if (pct >= 60) return 'Good';
  if (pct >= 40) return 'Fair';
  return 'Poor';
}

// ── ScoreRing ─────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 88 }: { score: number; size?: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = scoreColor(pct);
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const cx = size / 2;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0" style={{ display: 'block' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-border/50" />
        <circle
          cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.9s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-bold leading-none" style={{ color, fontSize: size * 0.26 }}>{score}</span>
        <span className="text-muted-foreground leading-none mt-0.5" style={{ fontSize: size * 0.11 }}>/100</span>
      </div>
    </div>
  );
}

// ── InsightCard ───────────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: Insight }) {
  const cfg = {
    positive: { Icon: CheckCircle2, border: 'border-green-500/25', bg: 'bg-green-500/8', label: 'text-green-400' },
    warning:  { Icon: AlertTriangle, border: 'border-amber-500/25', bg: 'bg-amber-500/8', label: 'text-amber-400' },
    action:   { Icon: ChevronRight,  border: 'border-primary/20',   bg: 'bg-primary/6',   label: 'text-primary' },
  }[insight.type] ?? { Icon: ChevronRight, border: 'border-border/50', bg: 'bg-secondary/50', label: 'text-muted-foreground' };

  return (
    <div className={`flex gap-3 p-3 border ${cfg.border} ${cfg.bg}`} style={{ borderRadius: 'var(--radius)' }}>
      <cfg.Icon size={14} className={`shrink-0 mt-0.5 ${cfg.label}`} />
      <div className="min-w-0">
        <p className={`text-xs font-semibold ${cfg.label}`}>{insight.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
      </div>
    </div>
  );
}

// ── MiniPieChart ──────────────────────────────────────────────────────────────

const PIE_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function MiniPieChart({ title, data }: { title: string; data: { label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const size = 80; const r = 30; const cx = 40; const cy = 40;
  // Each slice's start angle comes from a prefix sum rather than an accumulator mutated inside
  // map(): mutating a variable declared in render from within the callback is exactly what
  // React 19 flags, and the prefix sum makes each slice independent of iteration order.
  const startAngles: number[] = [];
  data.reduce((acc, d) => { startAngles.push(acc); return acc + (d.value / total) * 2 * Math.PI; }, -Math.PI / 2);
  const slices = data.map((d, i) => {
    const sweep = (d.value / total) * 2 * Math.PI;
    const angle = startAngles[i];
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sweep);
    const y2 = cy + r * Math.sin(angle + sweep);
    return { path: `M${cx},${cy}L${x1},${y1}A${r},${r},0,${sweep > Math.PI ? 1 : 0},1,${x2},${y2}Z`, color: PIE_COLORS[i % PIE_COLORS.length], ...d };
  });
  return (
    <div className="space-y-2">
      {title && <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>}
      <div className="flex gap-4 items-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
          {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
        </svg>
        <div className="space-y-1 min-w-0">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-muted-foreground truncate">{s.label}</span>
              <span className="text-foreground font-medium ml-auto pl-2 tabular-nums">${s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Inline markdown renderer (bold, italic, code) ────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2] !== undefined) parts.push(<strong key={key++} className="font-semibold text-foreground">{m[2]}</strong>);
    else if (m[3] !== undefined) parts.push(<em key={key++} className="italic">{m[3]}</em>);
    else if (m[4] !== undefined) parts.push(<code key={key++} className="font-mono text-[11px] bg-secondary px-1 py-0.5 rounded">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── SectionView — renders a single flexible AI response section ───────────────

function SectionView({ section }: { section: ResponseSection }) {
  if (section.type === 'paragraph') {
    return <p className="text-xs text-foreground leading-relaxed">{renderInline(section.text)}</p>;
  }
  if (section.type === 'bullets') {
    return (
      <ul className="space-y-1.5">
        {section.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <span className="text-primary shrink-0 mt-0.5">•</span>
            <span className="text-foreground leading-relaxed">{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (section.type === 'table') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border/50">
              {section.headers.map((h, i) => (
                <th key={i} className="text-left py-1.5 pr-4 text-muted-foreground font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/20 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="py-1.5 pr-4 text-foreground">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (section.type === 'pie') {
    return <MiniPieChart title={section.title} data={section.data} />;
  }
  return null;
}

// ── EntryView — full AI response card ─────────────────────────────────────────

function EntryView({ entry, isFirst }: { entry: ChatEntry; isFirst: boolean }) {
  if (entry._pending) {
    return (
      <div className="space-y-3">
        {entry.question && (
          <div className="flex justify-end">
            <div className="flex items-center gap-2 max-w-[88%] min-w-0">
              <div
                className="text-xs px-3 py-2 bg-primary text-primary-foreground font-medium leading-snug wrap-break-word min-w-0"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {entry.question}
              </div>
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <User size={13} className="text-primary" />
              </div>
            </div>
          </div>
        )}
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles size={13} className="text-primary" />
          </div>
          <div className="flex items-center gap-2 px-4 py-3 bg-secondary/60 border border-border/40" style={{ borderRadius: 'var(--radius)' }}>
            <Loader2 size={13} className="animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Forgenta is thinking…</span>
          </div>
        </div>
      </div>
    );
  }

  const { result, question } = entry;
  const pct = Math.min(100, Math.max(0, result.score ?? 0));
  const color = scoreColor(pct);
  const label = scoreLabel(pct);

  return (
    <div className="space-y-3">
      {question && (
        <div className="flex justify-end">
          <div className="flex items-center gap-2 max-w-[88%] min-w-0">
            <div
              className="text-xs px-3 py-2 bg-primary text-primary-foreground font-medium leading-snug wrap-break-word min-w-0"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {question}
            </div>
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <User size={13} className="text-primary" />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles size={13} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">

          {isFirst ? (
            <div className="flex gap-3 p-3.5 bg-secondary/50 border border-border/40 min-w-0 overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
              <ScoreRing score={result.score ?? 0} size={80} />
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Financial Health</p>
                <p className="text-sm font-bold" style={{ color }}>{label}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>
              </div>
            </div>
          ) : (
            result.summary && (
              <p className="text-xs text-foreground leading-relaxed">{result.summary}</p>
            )
          )}

          {result.nextMove && (
            <div className="flex gap-3 p-3 bg-primary/8 border border-primary/25" style={{ borderRadius: 'var(--radius)' }}>
              <TrendingUp size={14} className="text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[9px] font-bold text-primary uppercase tracking-wider mb-0.5">Your Move This Month</p>
                <p className="text-xs font-medium text-foreground leading-relaxed">{result.nextMove}</p>
              </div>
            </div>
          )}

          {/* Flexible sections — new responses */}
          {(result.sections?.length ?? 0) > 0 && (
            <div className="space-y-3">
              {result.sections!.map((s, i) => <SectionView key={i} section={s} />)}
            </div>
          )}

          {/* Insight cards — old history entries without sections */}
          {!(result.sections?.length) && (result.insights?.length ?? 0) > 0 && (
            <div className="space-y-2">
              {result.insights!.map((ins, i) => <InsightCard key={i} insight={ins} />)}
            </div>
          )}

          <p className="text-xs text-muted-foreground/50 pl-1">
            {new Date(entry.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── ScoreBadge ────────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color = scoreColor(score);
  const label = scoreLabel(score);
  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 text-xs font-bold border shrink-0"
      style={{ borderRadius: 'var(--radius)', color, borderColor: `${color}40`, background: `${color}12` }}
    >
      {score} <span className="font-normal opacity-70">{label}</span>
    </div>
  );
}

// ── ConsentGate — shown before first AI use ───────────────────────────────────

function ConsentGate({
  onAccept,
  onDecline,
  saving,
  error,
}: {
  onAccept: () => void;
  onDecline: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full overflow-hidden">
      <div className="px-4 pt-4 pb-3 lg:px-6 lg:pt-5 border-b border-border/40 shrink-0 flex items-center gap-2">
        <Sparkles size={16} className="text-primary" />
        <span className="font-display font-bold text-base tracking-tight">Forgenta AI</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-6" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        <div className="max-w-lg mx-auto space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Sparkles size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Before You Continue</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Review how Forgenta AI uses your data</p>
            </div>
          </div>

          <div className="bg-secondary/40 border border-border/50 p-4 space-y-3 text-xs text-muted-foreground leading-relaxed" style={{ borderRadius: 'var(--radius)' }}>
            <p className="text-foreground font-medium text-sm">
              Forgenta AI uses an AI model to generate personalized financial insights.
            </p>
            <ul className="space-y-2.5">
              <li className="flex gap-2">
                <span className="text-primary shrink-0 mt-0.5">•</span>
                <span>Your prompts, chat messages, and relevant financial context (income, expenses, debts, savings goals) are sent to an AI model to generate responses.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-400 shrink-0 mt-0.5">•</span>
                <span><strong className="text-foreground">AI responses may be inaccurate, incomplete, or outdated.</strong> They are not financial, legal, tax, or investment advice. You are responsible for all financial decisions you make.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary shrink-0 mt-0.5">•</span>
                <span>AI chat history may be saved to your account for continuity across sessions.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary shrink-0 mt-0.5">•</span>
                <span>TRE Forgenta LLC does not sell your personal data.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary shrink-0 mt-0.5">•</span>
                <span>You may delete your AI chat history from your account at any time.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary shrink-0 mt-0.5">•</span>
                <span>Forgenta AI is subject to daily and weekly usage limits to manage service costs.</span>
              </li>
            </ul>
            <p className="pt-1 border-t border-border/30">
              By clicking <strong className="text-foreground">I Agree</strong>, you confirm you have read and accept how Forgenta AI processes your data as described in our{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>
              {' '}and{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Terms of Service</a>.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pb-4">
            <button
              onClick={onDecline}
              disabled={saving}
              className="flex-1 px-4 py-2.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Decline
            </button>
            <button
              onClick={onAccept}
              disabled={saving}
              className="flex-1 px-4 py-2.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors btn-press disabled:opacity-50 flex items-center justify-center gap-1.5"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : 'I Agree'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── HistoryDrawer — slide-in overlay from left ────────────────────────────────

function HistoryDrawer({
  open,
  onClose,
  conversations,
  onSelect,
  onNew,
}: {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  onSelect: (c: Conversation) => void;
  onNew: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div
        className={`fixed left-0 top-0 bottom-0 z-40 w-72 max-w-[85vw] bg-background border-r border-border/60 flex flex-col transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Drawer header */}
        <div className="px-4 py-3.5 border-b border-border/40 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <History size={14} className="text-primary" />
            <span className="text-sm font-semibold">Chat History</span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md hover:bg-secondary transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* New chat button */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <button
            onClick={() => { onNew(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-semibold transition-colors btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Plus size={12} /> New Chat
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
          {conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No past chats yet</p>
          ) : (
            conversations.map(convo => {
              const ts = new Date(convo.created_at);
              const isToday = ts.toDateString() === new Date().toDateString();
              const timeStr = isToday
                ? ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                : ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const score = convo.entries[0]?.result?.score;

              return (
                <button
                  key={convo.id}
                  onClick={() => { onSelect(convo); onClose(); }}
                  className="w-full flex items-center gap-2.5 p-3 text-left bg-secondary/30 hover:bg-secondary/70 border border-border/30 hover:border-border/60 transition-all group"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <MessageSquare size={11} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {convo.title || 'General Analysis'}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{timeStr}</p>
                  </div>
                  {score !== undefined && <ScoreBadge score={score} />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiAdvisor() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const { data: rawTxns = [] }  = useTransactions();
  const { data: rules = [] }    = useRecurringRules();
  const { data: debts = [] }    = useDebts();
  const { data: goals = [] }    = useSavingsGoals();
  const { data: accounts = [] } = useAccounts();
  const { data: carFunds = [] } = useCarFunds();

  const allTxns = useMemo(
    () => mergeWithGeneratedTransactions(rawTxns, rules, accounts),
    [rawTxns, rules, accounts],
  );

  // Consent gate state — checked against profiles on mount
  const [consentStatus, setConsentStatus] = useState<'loading' | 'accepted' | 'pending' | 'declined'>('loading');
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // View: 'new' = fresh chat, 'chat' = active conversation
  const [view, setView] = useState<'new' | 'chat'>('new');
  const [historyOpen, setHistoryOpen] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [activeEntries, setActiveEntries] = useState<ChatEntry[]>([]);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedToday, setUsedToday] = useState(0);
  const [limitDay, setLimitDay] = useState(() => isPremium ? 150 : 20);
  const [usedWeek, setUsedWeek] = useState(0);
  const [limitWeek, setLimitWeek] = useState(() => isPremium ? 750 : 75);
  const [cooldown, setCooldown] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastAskTime = useRef(0);

  // Financial snapshot
  const snapshot = useMemo(() => {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentDate = now.toISOString().split('T')[0];
    const thisMonth = allTxns.filter(t => t.date?.startsWith(currentMonthStr));

    const monthlyIncome = thisMonth
      .filter(t => t.type === 'income' && t.category !== 'Balance Adjustment')
      .reduce((s, t) => s + Number(t.amount ?? 0), 0);

    const isDebtTx = (t: EnrichedTransaction) =>
      t.isDebtPayment ||
      t.category?.toLowerCase().includes('debt') ||
      t.category?.toLowerCase().includes('credit card');

    const monthlyDebtPayments = thisMonth
      .filter(t => t.type === 'expense' && t.category !== 'Balance Adjustment' && isDebtTx(t))
      .reduce((s, t) => s + Number(t.amount ?? 0), 0);

    const monthlyExpenses = thisMonth
      .filter(t => t.type === 'expense' && t.category !== 'Balance Adjustment' && !isDebtTx(t))
      .reduce((s, t) => s + Number(t.amount ?? 0), 0);

    const activeAccounts = accounts.filter(a => a.active !== false);

    // Credit cards from accounts table
    const creditCards = activeAccounts
      .filter(a => a.account_type === 'credit_card')
      .map(a => ({
        name: String(a.name ?? 'Credit Card'),
        balance: Number(a.balance ?? 0),
        limit: Number(a.credit_limit ?? 0),
        apr: Number(a.apr ?? 0),
        paymentPreference: a.payment_preference ?? null,
      }));

    const ccDebt = creditCards.reduce((s: number, c) => s + c.balance, 0);

    // Loan accounts (mortgage, auto, etc.)
    const LOAN_TYPES = ['loan', 'mortgage', 'auto_loan', 'student_loan', 'personal_loan'];
    const loans = activeAccounts
      .filter(a => LOAN_TYPES.includes(a.account_type))
      .map(a => {
        // accounts has no monthly_payment column for loan types (only credit cards store
        // min_payment there) — the real figure lives on the matching debts row, same as
        // debtDetails below. This was previously always 0 (reading a nonexistent column),
        // silently telling the advisor every loan had no payment.
        const matchDebt = debts.find(d => d.name.toLowerCase() === String(a.name ?? '').toLowerCase());
        return {
          name: String(a.name ?? 'Loan'),
          type: String(a.account_type ?? 'loan'),
          balance: Number(a.balance ?? 0),
          apr: Number(a.apr ?? 0),
          monthlyPayment: Number(matchDebt?.min_payment ?? 0),
        };
      });

    // Investment & retirement accounts
    const INVESTMENT_TYPES = ['brokerage', '401k', 'roth_ira', 'ira', 'hsa', 'crypto'];
    const investments = activeAccounts
      .filter(a => INVESTMENT_TYPES.includes(a.account_type))
      .map(a => ({
        name: String(a.name ?? 'Investment'),
        type: String(a.account_type ?? 'investment'),
        balance: Number(a.balance ?? 0),
      }));

    // Total debt = credit card balances + loan balances, sourced from accounts table only.
    // The debts table is intentionally excluded here — credit cards tracked there are already
    // in accounts (credit_card type), so adding both would double-count them.
    const loanDebt = loans.reduce((s: number, l) => s + l.balance, 0);
    const totalDebt = ccDebt + loanDebt;

    const savingsBalance = activeAccounts
      .filter(a => ['savings', 'high_yield_savings'].includes(a.account_type))
      .reduce((s, a) => s + Number(a.balance ?? 0), 0);

    const cashOnHand = activeAccounts
      .filter(a => ['checking', 'cash'].includes(a.account_type))
      .reduce((s, a) => s + Number(a.balance ?? 0), 0);

    const LIABILITY_TYPES = ['credit_card', 'loan', 'mortgage', 'auto_loan', 'student_loan', 'personal_loan'];
    const totalAssets = activeAccounts
      .filter(a => !LIABILITY_TYPES.includes(a.account_type))
      .reduce((s, a) => s + Number(a.balance ?? 0), 0);
    const netWorth = totalAssets - totalDebt;

    const savingsRate = monthlyIncome > 0
      ? ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100
      : 0;

    const emergencyRunwayMonths = monthlyExpenses > 0
      ? Math.round((savingsBalance / monthlyExpenses) * 10) / 10
      : null;

    const breakdown = categorizeExpenses(thisMonth, true);
    const topCategories = Object.entries(breakdown)
      .map(([category, amount]) => ({ category, amount: amount as number }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    const debtDetails = debts.map(d => {
      const balance = Number(d.balance ?? 0);
      const apr = Number(d.apr ?? 0);
      const targetPayment = Number(d.target_payment ?? 0);
      const monthlyRate = apr / 100 / 12;
      let projectedPayoffMonths: number | null = null;
      if (balance > 0 && targetPayment > balance * monthlyRate) {
        const n = monthlyRate === 0
          ? balance / targetPayment
          : -Math.log(1 - (monthlyRate * balance) / targetPayment) / Math.log(1 + monthlyRate);
        projectedPayoffMonths = isFinite(n) && n > 0 ? Math.ceil(n) : null;
      }
      return {
        name: String(d.name ?? 'Unknown'),
        balance,
        apr,
        minPayment: Number(d.min_payment ?? 0),
        targetPayment,
        projectedPayoffMonths,
      };
    });

    const savingsGoals = goals.map(g => ({
      name: String(g.name ?? 'Unnamed Goal'),
      targetAmount: Number(g.target_amount ?? 0),
      currentAmount: Number(g.current_amount ?? 0),
      monthlyContribution: Number(g.monthly_contribution ?? 0),
      targetDate: g.target_date ?? null,
    }));

    const carFundDetails = carFunds.map(cf => ({
      vehicleName: String(cf.vehicle_name ?? 'Vehicle'),
      phase: String(cf.phase ?? 'saving'),
      loanAmount: Number(cf.loan_amount ?? 0),
      monthlyPayment: Number(cf.actual_monthly_payment ?? 0),
      apr: Number(cf.expected_apr ?? 0),
      loanTermMonths: Number(cf.loan_term_months ?? 60),
      plannedPurchaseDate: cf.planned_purchase_date ?? null,
      currentSaved: Number(cf.current_saved ?? 0),
      downPaymentGoal: Number(cf.down_payment_goal ?? 0),
    }));

    // Recurring expense obligations for context
    const recurringObligations = rules
      .filter(r => r.active && r.rule_type === 'expense')
      .map(r => ({
        name: String(r.name ?? 'Unknown'),
        amount: Number(r.amount ?? 0),
        frequency: String(r.frequency ?? 'monthly'),
        category: String(r.category ?? 'Other'),
      }));

    return {
      currentDate,
      monthlyIncome, monthlyExpenses, monthlyDebtPayments, totalDebt,
      savingsBalance, cashOnHand, netWorth, savingsRate,
      emergencyRunwayMonths,
      topCategories, debtDetails, savingsGoals,
      creditCards, loans, investments,
      carFunds: carFundDetails,
      recurringObligations,
    };
  }, [allTxns, debts, goals, accounts, carFunds, rules]);

  // Make this page fill the layout's content area exactly so only the
  // chat thread scrolls — not the outer main element.
  useEffect(() => {
    const main = document.querySelector('main');
    const wrapper = main?.firstElementChild as HTMLElement | null;
    if (!wrapper) return;
    const orig = wrapper.style.height;
    wrapper.style.height = '100%';
    return () => { wrapper.style.height = orig; };
  }, []);

  // Load consent status, history, and today's usage count on mount
  useEffect(() => {
    // Short-circuit for demo/logged-out: skip the history + usage fetch and mark
    // the page loaded. Cannot be a lazy initializer — `user` starts null and is
    // populated by auth hydration after mount, so this branch has to react to
    // that transition rather than be decided once at mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!user || isDemo) { setConsentStatus('accepted'); setHistoryLoaded(true); return; }
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    Promise.all([
      supabase
        .from('ai_advisor_history')
        .select('id, question, result, created_at, conversation_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('ai_usage_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', todayStart.toISOString()),
      supabase
        .from('profiles')
        .select('ai_consent_accepted, ai_consent_version')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]).then(([{ data }, { count }, { data: profile }]) => {
      if (data && data.length > 0) {
        const grouped = new Map<string, AiHistoryRow[]>();
        data.forEach(row => {
          const key = row.conversation_id ?? row.id;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(row);
        });
        const convos: Conversation[] = Array.from(grouped.entries())
          .map(([key, rows]) => {
            const sorted = [...rows].sort((a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return {
              id: key,
              title: sorted[0].question,
              entries: sorted.map(r => ({
                id: r.id,
                question: r.question,
                result: r.result as unknown as AdviceResult,
                created_at: r.created_at,
              })),
              created_at: sorted[0].created_at,
            };
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setConversations(convos);
      }
      setUsedToday(count ?? 0);

      const hasValidConsent =
        profile?.ai_consent_accepted === true &&
        profile?.ai_consent_version === AI_CONSENT_VERSION;
      setConsentStatus(hasValidConsent ? 'accepted' : 'pending');
      setHistoryLoaded(true);
    });
  }, [user, isDemo]);

  // Scroll to bottom on new entries
  useEffect(() => {
    if (view === 'chat' && activeEntries.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [activeEntries.length, view]);

  const atLimit = usedToday >= limitDay;
  const blocked = loading || cooldown || atLimit;

  const openConversation = (convo: Conversation) => {
    setActiveEntries(convo.entries);
    setActiveTitle(convo.title);
    setActiveConversationId(convo.id);
    setError(null);
    setView('chat');
  };

  const startNew = () => {
    setActiveEntries([]);
    setActiveTitle(null);
    setActiveConversationId(null);
    setQuestion('');
    setError(null);
    setView('new');
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handleConsentAccept = async () => {
    setConsentSaving(true);
    setConsentError(null);
    const { error } = await supabase
      .from('profiles')
      .update({
        ai_consent_accepted: true,
        ai_consent_accepted_at: new Date().toISOString(),
        ai_consent_version: AI_CONSENT_VERSION,
      })
      .eq('user_id', user!.id);
    if (error) {
      setConsentError('Failed to save consent. Please try again.');
    } else {
      setConsentStatus('accepted');
    }
    setConsentSaving(false);
  };

  const handleConsentDecline = () => setConsentStatus('declined');

  const handleAsk = async (q?: string) => {
    const rawQ = (q ?? question).trim().slice(0, LIMITS.aiPrompt);
    const { clean: finalQ, flagged: qFlagged } = filterProfanity(rawQ);
    if (qFlagged) { toast.warning('Your message contained inappropriate language and was cleaned.'); }

    // False positive: handleAsk is only ever invoked from onClick/onKeyDown (see the three call
    // sites below), never during render, so this clock read and the lastAskTime ref access that
    // depends on it are both event-handler code. The compiler-backed rule cannot see that the
    // arrow wrappers (`() => handleAsk(q)`) keep it out of the render path.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (now - lastAskTime.current < COOLDOWN_MS) {
      setError('Please wait a moment before asking again.');
      return;
    }
    if (atLimit) {
      setError(`You've reached your ${limitDay} daily questions. Resets at midnight UTC.`);
      return;
    }

    lastAskTime.current = now;

    // Resolve or create conversation ID for this thread
    const convId = activeConversationId ?? crypto.randomUUID();
    if (!activeConversationId) setActiveConversationId(convId);

    // Show the question immediately before the API returns
    const pendingId = crypto.randomUUID();
    setActiveEntries(prev => [...prev, {
      id: pendingId,
      question: finalQ || null,
      result: {} as AdviceResult,
      created_at: new Date().toISOString(),
      _pending: true,
    }]);
    if (view === 'new') setView('chat');

    setLoading(true);
    setError(null);
    setQuestion('');

    // Build conversation history from completed entries (last 4 turns)
    const historyForApi: ConversationTurn[] = activeEntries
      .filter(e => !e._pending && e.result?.summary)
      .slice(-4)
      .map(e => ({
        question: e.question,
        summary: e.result.summary,
        nextMove: e.result.nextMove ?? '',
      }));

    try {
      const debtStrategy = (localStorage.getItem('tre:debt:strategy') || 'avalanche') as 'avalanche' | 'snowball';
      const paymentMode = (localStorage.getItem('tre:debt:paymentMode') || 'variable') as 'variable' | 'consistent';

      const { data, error: fnErr } = await tracedInvoke<AdviceResult>(supabase, 'ai-advisor', {
        body: {
          ...snapshot,
          debtStrategy,
          paymentMode,
          question: finalQ || undefined,
          conversationId: convId,
          conversationHistory: historyForApi.length > 0 ? historyForApi : undefined,
        },
      });

      if (fnErr) {
        let errMsg = 'AI request failed. Please try again.';
        try {
          // Supabase's FunctionsHttpError carries a .context Response at runtime, but its type
          // declaration doesn't expose it — narrow through unknown rather than `any`.
          const errWithContext = fnErr as unknown as { context?: { json?: () => Promise<unknown> } };
          const ctx = await errWithContext.context?.json?.() as
            { error?: string; usage?: AdviceResult['usage'] } | undefined;
          if (ctx?.error === 'ai_consent_required') {
            setActiveEntries(prev => prev.filter(e => e.id !== pendingId));
            setConsentStatus('pending');
            return;
          }
          if (ctx?.error) errMsg = ctx.error;
          if (ctx?.usage) {
            setUsedToday(ctx.usage.used_today);
            setLimitDay(ctx.usage.limit_day);
            setUsedWeek(ctx.usage.used_week);
            setLimitWeek(ctx.usage.limit_week);
          }
        } catch { /* fall back to generic message */ }
        throw new Error(errMsg);
      }

      const advice = data as AdviceResult;
      const entry: ChatEntry = {
        id: advice._history_id ?? crypto.randomUUID(),
        question: finalQ || null,
        result: advice,
        created_at: advice._history_created_at ?? new Date().toISOString(),
      };

      // Replace the pending entry with the real response
      setActiveEntries(prev => prev.map(e => e.id === pendingId ? entry : e));

      // Update existing conversation or create new one in history
      setConversations(prev => {
        const existingIdx = prev.findIndex(c => c.id === convId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            entries: [...updated[existingIdx].entries.filter(e => e.id !== pendingId), entry],
          };
          return updated;
        }
        return [{
          id: convId,
          title: entry.question,
          entries: [entry],
          created_at: entry.created_at,
        }, ...prev];
      });

      if (!activeTitle && finalQ) setActiveTitle(finalQ);
      if (advice.usage) {
        setUsedToday(advice.usage.used_today);
        setLimitDay(advice.usage.limit_day);
        setUsedWeek(advice.usage.used_week);
        setLimitWeek(advice.usage.limit_week);
      }

      setCooldown(true);
      setTimeout(() => setCooldown(false), COOLDOWN_MS);
    } catch (e) {
      // Remove pending entry so the chat doesn't show a stuck bubble
      setActiveEntries(prev => prev.filter(entry => entry.id !== pendingId));
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  // ── Demo gate ─────────────────────────────────────────────────────────────────

  if (isDemo) {
    return (
      <div className="py-4 lg:py-6 max-w-3xl mx-auto overflow-x-hidden">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles size={18} className="text-primary" />
          <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Forgenta AI</h1>
        </div>
        <div className="border border-border/60 bg-secondary/30 p-8 text-center space-y-4" style={{ borderRadius: 'var(--radius)' }}>
          <div className="w-12 h-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto">
            <Sparkles size={22} className="text-primary" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-display font-bold text-lg tracking-tight">Forgenta AI is a Premium Feature</h2>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
              Create a free account and upgrade to Forgenta Premium to get your personalized financial health score and ask unlimited money questions.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <a href="/auth" className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-primary/90" style={{ borderRadius: 'var(--radius)' }}>
              Create Free Account
            </a>
            <a href="/auth" className="inline-flex items-center justify-center gap-2 border border-border px-6 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" style={{ borderRadius: 'var(--radius)' }}>
              Sign In
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Premium gate ──────────────────────────────────────────────────────────────

  if (!isPremium) {
    return (
      <div className="flex flex-col h-[calc(100dvh-56px)] lg:h-screen overflow-x-hidden">
        <div className="px-4 pt-4 pb-3 lg:px-6 lg:pt-5 border-b border-border/40 shrink-0 flex items-center gap-2">
          <Sparkles size={18} className="text-primary" />
          <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Forgenta AI</h1>
        </div>
        <PremiumGate
          title="AI Budget Advisor"
          features={['Financial health score (1–100)', 'Spending pattern analysis', 'Ask any money question']}
          isPremium={false}
          className="flex-1 min-h-0"
        >
          <div className="flex flex-col h-full p-4 gap-3 overflow-hidden">
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles size={12} className="text-primary" />
              </div>
              <div className="card-forged p-3 max-w-[92%] sm:max-w-[80%] text-xs text-foreground leading-relaxed">
                Your financial health score is <span className="text-primary font-bold">74/100</span>. You're covering essentials well, but your discretionary spend is 12% above your 3-month average.
              </div>
            </div>
            <div className="flex gap-2 items-start justify-end">
              <div className="bg-primary/10 border border-primary/20 p-3 max-w-[75%] text-xs text-foreground leading-relaxed" style={{ borderRadius: 'var(--radius)' }}>
                How can I improve my score?
              </div>
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User size={12} className="text-muted-foreground" />
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles size={12} className="text-primary" />
              </div>
              <div className="card-forged p-3 max-w-[92%] sm:max-w-[80%] text-xs text-foreground leading-relaxed">
                Three quick wins: <span className="text-primary font-semibold">reduce dining out by $120</span>, redirect that to your emergency fund, and set your Chase card to auto-pay minimum to avoid late fees.
              </div>
            </div>
            <div className="mt-auto flex gap-2 items-center border border-border bg-card px-3 py-2" style={{ borderRadius: 'var(--radius)' }}>
              <span className="flex-1 text-xs text-muted-foreground">Ask about your finances…</span>
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                <Send size={10} className="text-primary" />
              </div>
            </div>
          </div>
        </PremiumGate>
      </div>
    );
  }

  // ── Consent gate ─────────────────────────────────────────────────────────────

  if (consentStatus === 'loading') {
    return (
      <div className="flex flex-col h-full max-w-3xl mx-auto w-full overflow-hidden">
        <div className="px-4 pt-4 pb-3 lg:px-6 lg:pt-5 border-b border-border/40 shrink-0 flex items-center gap-2">
          <Sparkles size={16} className="text-primary" />
          <span className="font-display font-bold text-base tracking-tight">Forgenta AI</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (consentStatus === 'pending') {
    return (
      <ConsentGate
        onAccept={handleConsentAccept}
        onDecline={handleConsentDecline}
        saving={consentSaving}
        error={consentError}
      />
    );
  }

  if (consentStatus === 'declined') {
    return (
      <div className="flex flex-col h-full max-w-3xl mx-auto w-full overflow-hidden">
        <div className="px-4 pt-4 pb-3 lg:px-6 lg:pt-5 border-b border-border/40 shrink-0 flex items-center gap-2">
          <Sparkles size={16} className="text-primary" />
          <span className="font-display font-bold text-base tracking-tight">Forgenta AI</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-6">
          <div className="w-12 h-12 rounded-xl bg-border/40 border border-border/60 flex items-center justify-center">
            <Sparkles size={22} className="text-muted-foreground" />
          </div>
          <div className="space-y-2 max-w-xs">
            <p className="text-sm font-semibold">Forgenta AI Requires Your Consent</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              No financial data is sent to AI services until you accept the AI data terms.
            </p>
          </div>
          <button
            onClick={() => { setConsentError(null); setConsentStatus('pending'); }}
            className="px-5 py-2.5 bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Review &amp; Accept
          </button>
        </div>
      </div>
    );
  }

  // ── Snapshot bar ──────────────────────────────────────────────────────────────

  // A plain render helper, not a component: declaring a component inside render creates a new
  // component type on every render, which makes React unmount and remount the whole subtree.
  // Calling this instead splices the JSX straight into the parent's tree.
  const renderSnapshotBar = () => (
    <div className="px-4 py-2 lg:px-6 border-b border-border/30 shrink-0 grid grid-cols-3 gap-2">
      {[
        { label: 'Income',     value: formatCurrency(snapshot.monthlyIncome, false) },
        { label: 'Expenses',   value: formatCurrency(snapshot.monthlyExpenses, false) },
        { label: 'Total Debt', value: formatCurrency(snapshot.totalDebt, false) },
      ].map(k => (
        <div key={k.label} className="bg-secondary/50 rounded-md px-2.5 py-1.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{k.label}</p>
          <p className="text-xs font-bold mt-0.5">{k.value}</p>
        </div>
      ))}
    </div>
  );

  // ── Main chat layout ──────────────────────────────────────────────────────────

  return (
    <>
      {/* History drawer — overlays everything */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={conversations}
        onSelect={openConversation}
        onNew={startNew}
      />

      <div className="flex flex-col h-full max-w-3xl mx-auto w-full overflow-hidden">

        {/* ── Header ── */}
        <div className="px-4 pt-4 pb-3 lg:px-6 lg:pt-5 border-b border-border/40 shrink-0 flex items-center gap-3">
          {view === 'chat' && activeEntries.length > 0 ? (
            <button
              onClick={startNew}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary hover:bg-secondary/80 border border-border/60 transition-colors shrink-0"
            >
              <ArrowLeft size={15} />
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <Sparkles size={16} className="text-primary" />
              <span className="font-display font-bold text-base tracking-tight">Forgenta AI</span>
            </div>
          )}

          {/* Active chat title */}
          <div className="flex-1 min-w-0">
            {view === 'chat' && activeTitle && (
              <p className="text-sm font-semibold truncate">{activeTitle}</p>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Quota */}
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-muted-foreground tabular-nums leading-none">{usedToday}/{limitDay}</span>
              <div className="w-14 h-1 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (usedToday / limitDay) * 100)}%`,
                    background: usedToday >= limitDay ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
                  }}
                />
              </div>
            </div>

            {/* History */}
            <button
              onClick={() => setHistoryOpen(true)}
              title="Chat history"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary hover:bg-secondary/80 border border-border/60 transition-colors relative"
            >
              <History size={14} />
              {conversations.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
              )}
            </button>

            {/* New chat */}
            <button
              onClick={startNew}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-semibold transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Plus size={11} /> New
            </button>
          </div>
        </div>

        {/* Snapshot bar — only on fresh chat */}
        {view === 'new' && renderSnapshotBar()}

        {/* ── Chat thread ── */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 lg:px-6 py-4 space-y-6"
          style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          {/* Empty state */}
          {activeEntries.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Sparkles size={24} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Ask Forgenta anything about your finances</p>
                <p className="text-xs text-muted-foreground mt-1">Personalized advice based on your live data</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 w-full max-w-sm">
                {QUICK_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => handleAsk(q)}
                    disabled={blocked}
                    className="text-xs px-3 py-2 bg-secondary border border-border hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-colors btn-press disabled:opacity-40"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Entries */}
          {activeEntries.map((entry, index) => (
            <EntryView key={entry.id} entry={entry} isFirst={index === 0} />
          ))}

          <div ref={bottomRef} />
        </div>

        {/* ── Input bar ── */}
        <div
          className="px-4 pt-3 border-t border-border/40 shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={question}
              onChange={e => {
                setQuestion(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !blocked && question.trim()) {
                  e.preventDefault();
                  handleAsk();
                }
              }}
              placeholder={atLimit ? `Daily limit reached (${limitDay}/day) — resets midnight UTC` : (activeEntries.length > 0 ? 'Ask a follow-up…' : 'Ask anything about your finances…')}
              maxLength={500}
              className="flex-1 bg-secondary border border-border px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50 min-w-0 resize-none overflow-y-auto leading-snug"
              style={{ borderRadius: 'var(--radius)' }}
              disabled={blocked}
            />
            <button
              onClick={() => handleAsk()}
              disabled={blocked || !question.trim()}
              className="flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-4 py-2.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 mt-2 text-xs text-destructive">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {atLimit && !error && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {usedWeek}/{limitWeek} used this week
            </p>
          )}
        </div>
      </div>
    </>
  );
}
