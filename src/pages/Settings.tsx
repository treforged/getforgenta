import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useProfile, useAccounts } from '@/hooks/useSupabaseData';
import { useSubscription } from '@/hooks/useSubscription';
import { Capacitor } from '@capacitor/core';
import { Link, useLocation } from 'react-router';
import { Settings as SettingsIcon, Crown, Save, CheckCircle, AlertCircle, Lock, Mail, CreditCard, X, Loader2, Trash2, MessageCircle, Shield, Copy, Share2, Monitor, Bug, LogOut, Terminal, User } from 'lucide-react';

const DEV_EMAIL = 'tre@treforged.com';
const DEV_DEBUG_KEY = 'forged:dev_debug';

interface TrustedDevice {
  device_id: string;
  name: string;
  trusted_at: string;
  last_seen: string;
}
import { LinkedAccounts } from '@/components/settings/LinkedAccounts';
import SettingsSection from '@/components/settings/SettingsSection';
import { PartnerLink } from '@/components/settings/PartnerLink';
import { FriendLink } from '@/components/settings/FriendLink';
import { TwoFactorAuth } from '@/components/settings/TwoFactorAuth';
import MerchantRulesSettings from '@/components/settings/MerchantRulesSettings';
import NotificationSettings from '@/components/settings/NotificationSettings';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeChoice } from '@/lib/theme';
import PanelBar from '@/components/shared/PanelBar';
import SurfaceGuide from '@/components/shared/SurfaceGuide';
import { getDayName } from '@/lib/scheduling';
import { supabase } from '@/integrations/supabase/client';
import { tracedInvoke } from '@/lib/tracer';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { emailChangeSchema, passwordChangeSchema } from '@/lib/schemas';
import { getTrustedDeviceId, TRUSTED_DEVICE_KEY } from '@/lib/trusted-device';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '');

// ── Embedded payment method update form ───────────────────────────────────────
function PaymentUpdateForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    try {
      // Confirm the SetupIntent — 'if_required' avoids redirect for card payments
      const { setupIntent, error } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
      });
      if (error) throw new Error(error.message);
      if (!setupIntent?.payment_method) throw new Error('No payment method returned');

      const pmId = typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method.id;

      // Tell the backend to set this PM as the subscription's default
      const { error: fnErr } = await tracedInvoke(supabase, 'update-payment-method', {
        body: { payment_method_id: pmId },
      });
      if (fnErr) throw fnErr;

      toast.success('Payment method updated');
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update payment method');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={!stripe || loading}
          className="btn btn-md btn-primary flex-1"
          style={{ borderRadius: 'var(--radius)' }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
          {loading ? 'Saving…' : 'Save card'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="btn btn-md btn-secondary w-full sm:w-auto"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}


/** The panel row's own values. `page-guides.ts` keys `settings:<panel>` off exactly these. */
type SettingsPanel = 'account' | 'security' | 'preferences' | 'plan';

export default function SettingsPage() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const location = useLocation();
  const { choice: themeChoice, resolved: resolvedTheme, choose: chooseTheme } = useTheme();

  // ── Panels ────────────────────────────────────────────────────────────────────────────
  // Settings was one scrolling column of nine cards. Tre asked for tabs with "Profile and
  // Invite together", which is the grouping below: Account is who you are and how you share
  // or end the account, and the merchant-memory card moved in beside Display because both are
  // about how the app behaves rather than who you are.
  const [activeTab, setActiveTab] = usePersistedState<SettingsPanel>('tre:settings:activeTab', 'account');

  // ⚠️ THE ROW IS BUILT, NOT HARD-CODED. Security, Plan and the Danger Zone all render nothing
  // in demo, so a fixed row would offer two tabs that open onto an empty page — the emptiest
  // possible empty state, one with not even a reason in it.
  const panels = useMemo<{ key: SettingsPanel; label: string; icon: typeof User }[]>(() => [
    { key: 'account' as const, label: 'Account', icon: User },
    ...(isDemo ? [] : [{ key: 'security' as const, label: 'Security', icon: Shield }]),
    { key: 'preferences' as const, label: 'Preferences', icon: Monitor },
    ...(isDemo ? [] : [{ key: 'plan' as const, label: 'Plan', icon: Crown }]),
  ], [isDemo]);

  // A persisted tab outlives the reason it was available: leaving demo and coming back, or the
  // reverse, can restore a panel this render does not offer. Fall back rather than show nothing.
  const panel: SettingsPanel = panels.some(p => p.key === activeTab) ? activeTab : 'account';

  // ⚠️ `/settings#security` IS A LIVE LINK — the Dashboard's security prompt points at it. Behind
  // a tab that anchor would scroll to an element that is not rendered, i.e. do nothing at all, so
  // the hash selects the panel instead. Deliberately not `panel` in the deps: this must fire when
  // the user ARRIVES on the link, not every time they then click another tab.
  useEffect(() => {
    if (location.hash === '#security' && !isDemo) setActiveTab('security');
  }, [location.hash, isDemo, setActiveTab]);
  const { data: profile, loading, update } = useProfile();
  const { data: accounts } = useAccounts();
  const { subscription, isPremium, hasStripeCustomer, isLoading: subLoading, refetch: refetchSub } = useSubscription();
  const isNative = Capacitor.isNativePlatform();
  const [cancelLoading, setCancelLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [referralCount, setReferralCount] = useState<number | null>(null);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Delete account state — steps: 'hidden' | 'confirm'
  const [deleteStep, setDeleteStep] = useState<'hidden' | 'confirm'>('hidden');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [weeklyGrossIncome, setWeeklyGrossIncome] = useState('1875');
  const [startDay, setStartDay] = useState('1');
  const [showCents, setShowCents] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [taxRate, setTaxRate] = useState('22');
  const [cashFloor, setCashFloor] = useState('1000');
  const [paycheckFrequency, setPaycheckFrequency] = useState('weekly');
  const [paycheckDay, setPaycheckDay] = useState('5');
  const [paycheckStartDate, setPaycheckStartDate] = useState('');
  const [defaultDepositAccount, setDefaultDepositAccount] = useState('');
  const [autoGenerateRecurring, setAutoGenerateRecurring] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [devDebug, setDevDebug] = useState(() => localStorage.getItem(DEV_DEBUG_KEY) === '1');

  const [forceSignOutLoading, setForceSignOutLoading] = useState(false);
  const [forceSignOutConfirm, setForceSignOutConfirm] = useState(false);

  const [signinPasskeyBusy, setSigninPasskeyBusy] = useState(false);
  const [hasSigninPasskey, setHasSigninPasskey] = useState(false);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);

  // Account security state
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Hydrates the settings form from the server profile once it arrives. These
  // fields are user-editable afterwards, so they cannot be derived from `profile`
  // — the form has to own them, and the profile query resolves after mount, so a
  // lazy initializer cannot cover it either. setDirty(false) at the end marks the
  // freshly loaded values as the clean baseline.
  useEffect(() => {
    if (profile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayName(profile.display_name || '');
      setCurrency(profile.currency || 'USD');
      setWeeklyGrossIncome(String(profile.weekly_gross_income || 1875));
      setStartDay(String(profile.budget_start_day || 1));
      setShowCents(profile.show_cents ?? true);
      setCompactMode(profile.compact_mode ?? false);
      setTaxRate(String(profile.tax_rate ?? 22));
      setCashFloor(String(profile.cash_floor ?? 1000));
      setPaycheckFrequency(profile.paycheck_frequency || 'weekly');
      setPaycheckDay(String(profile.paycheck_day ?? 5));
      setPaycheckStartDate(profile.paycheck_start_date || '');
      setDefaultDepositAccount(profile.default_deposit_account || '');
      setAutoGenerateRecurring(profile.auto_generate_recurring ?? true);
      setTrustedDevices((profile.trusted_devices ?? []) as unknown as TrustedDevice[]);
      setDirty(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!user || isDemo) return;
    const refCode = user.id.slice(0, 8);
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', refCode)
      .then(({ count }) => setReferralCount(count ?? 0));
  }, [user, isDemo]);

  const markDirty = () => setDirty(true);

  // FIX #10: Save ALL profile fields including derived fields so they propagate everywhere
  const handleSave = () => {
    const _wgi = parseFloat(weeklyGrossIncome); const wgi = isNaN(_wgi) ? 1875 : _wgi;
    const _tr = parseFloat(taxRate); const tr = isNaN(_tr) ? 22 : _tr;
    const _cf = parseFloat(cashFloor); const cf = isNaN(_cf) ? 1000 : _cf;
    const pd = parseInt(paycheckDay);

    const rawName = displayName.trim().slice(0, LIMITS.username);
    const { clean: cleanName, flagged: nameFlagged } = filterProfanity(rawName);
    if (nameFlagged) toast.warning('Display name contained inappropriate language and was cleaned.');

    update.mutate({
      display_name: cleanName,
      currency,
      weekly_gross_income: wgi,
      // FIX #11: Correctly compute gross_income based on frequency
      gross_income: paycheckFrequency === 'weekly' ? wgi * 52 / 12
        : paycheckFrequency === 'biweekly' ? wgi * 2 * 26 / 12
        : wgi * 52 / 12, // for monthly, weeklyGross * 52/12
      // FIX #12: Correctly compute monthly_income_default (net)
      monthly_income_default: (paycheckFrequency === 'weekly' ? wgi * 52 / 12
        : paycheckFrequency === 'biweekly' ? wgi * 2 * 26 / 12
        : wgi * 52 / 12) * (1 - tr / 100),
      budget_start_day: parseInt(startDay) || 1,
      show_cents: showCents,
      compact_mode: compactMode,
      tax_rate: tr,
      cash_floor: cf,
      paycheck_frequency: paycheckFrequency,
      paycheck_day: pd,
      paycheck_start_date: paycheckStartDate || null,
      default_deposit_account: defaultDepositAccount || null,
      auto_generate_recurring: autoGenerateRecurring,
    });
    setDirty(false);
  };

  const depositAccounts = accounts.filter(a => ['checking', 'savings', 'high_yield_savings', 'business_checking'].includes(a.account_type as string) && a.active);

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleteLoading(true);
    try {
      const { error } = await tracedInvoke(supabase, 'delete-account', {});
      if (error) throw error;
      toast.success('Account permanently deleted. Goodbye.');
      await supabase.auth.signOut();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleteLoading(false);
    }
  };

  const resetDeleteFlow = () => {
    setDeleteStep('hidden');
    setDeleteConfirmText('');
  };

  const handleEmailChange = async () => {
    const result = emailChangeSchema.safeParse({ newEmail });
    if (!result.success) {
      toast.error(result.error.issues[0].message);
      return;
    }
    if (result.data.newEmail === user?.email) {
      toast.error('New email must be different from your current email');
      return;
    }
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      setEmailSent(true);
      setNewEmail('');
      toast.success('Verification sent — check your new email inbox to confirm the change');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    const result = passwordChangeSchema.safeParse({ currentPassword, newPassword, confirmNewPassword });
    if (!result.success) {
      toast.error(result.error.issues[0].message);
      return;
    }
    setPasswordLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-password`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ new_password: newPassword, current_password: currentPassword }),
        }
      );
      const pwBody = await res.json();
      if (!res.ok) throw new Error(pwBody.error ?? 'Failed to update password');
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      toast.success('Password updated successfully');
      setTimeout(() => setPasswordSuccess(false), 4000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleForceSignOut = async () => {
    setForceSignOutLoading(true);
    try {
      await supabase.auth.signOut({ scope: 'global' });
      // SIGNED_OUT event in AuthContext navigates to /auth
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to sign out all devices');
      setForceSignOutLoading(false);
    }
  };

  const handleRegisterSigninPasskey = async () => {
    if (!user) return;
    setSigninPasskeyBusy(true);
    try {
      const userIdBytes = new TextEncoder().encode(user.id).buffer as ArrayBuffer;
      const challenge = crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer;

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Forgenta Budget OS', id: window.location.hostname },
          user: { id: userIdBytes, name: user.email ?? user.id, displayName: profile?.display_name || user.email || 'User' },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256
            { type: 'public-key', alg: -257 },  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;

      if (!credential) throw new Error('Passkey registration cancelled');

      const rawId = new Uint8Array(credential.rawId);
      const credId = btoa(String.fromCharCode(...rawId)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      localStorage.setItem('forged:signin_passkey', JSON.stringify({ credId, email: user.email }));

      setHasSigninPasskey(true);
      toast.success('Sign-in passkey registered — use it on the login page');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      const lower = msg.toLowerCase();
      if (!lower.includes('cancel') && !lower.includes('abort') && !lower.includes('not allowed')) {
        toast.error(msg || 'Passkey registration failed');
      }
    } finally {
      setSigninPasskeyBusy(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      const updated = trustedDevices.filter(d => d.device_id !== deviceId);
      await supabase.from('profiles').update({ trusted_devices: updated as unknown as Json }).eq('user_id', user!.id);
      setTrustedDevices(updated);
      // Shared key — this used to read `forged:trusted_device_id` while Auth wrote `forgenta:`,
      // so revoking the current device never cleared its local pointer.
      if (getTrustedDeviceId() === deviceId) {
        localStorage.removeItem(TRUSTED_DEVICE_KEY);
      }
      toast.success('Device revoked');
    } catch {
      toast.error('Failed to revoke device');
    }
  };

  const handleCancelOrResume = async (action: 'cancel' | 'resume') => {
    setCancelLoading(true);
    setConfirmCancel(false);
    try {
      const { error } = await tracedInvoke(supabase, 'manage-subscription', { body: { action } });
      if (error) throw error;
      await refetchSub();
      toast.success(action === 'cancel' ? 'Subscription will cancel at period end' : 'Subscription resumed');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update subscription');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleShowPaymentUpdate = useCallback(async () => {
    setSetupLoading(true);
    try {
      const { data, error } = await tracedInvoke<{ client_secret: string }>(supabase, 'create-setup-intent', {});
      if (error) throw error;
      if (data?.client_secret) {
        setSetupClientSecret(data.client_secret);
      } else {
        toast.error('Failed to initialize payment form');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to open payment update');
    } finally {
      setSetupLoading(false);
    }
  }, []);

  return (
    <div className="py-4 lg:py-6 max-w-2xl mx-auto stack-section overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <SettingsIcon size={18} className="text-primary" />
          <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Settings</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* ⚠️ SAVE STAYS OUTSIDE THE PANELS, and that is load-bearing: edits on one panel must
              still be savable after switching to another, or tabbing away would quietly discard
              typed work — the rule the backdrop-tap save was built on. */}
          {dirty && !isDemo && (
            <button onClick={handleSave} disabled={update.isPending} className="btn btn-md btn-primary w-full sm:w-auto" style={{ borderRadius: 'var(--radius)' }}>
              <Save size={12} /> {update.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          )}
          <SurfaceGuide surface="settings" />
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 border-primary/30">
          <p className="text-xs text-primary font-medium">Demo Mode</p>
          <p className="text-xs text-muted-foreground mt-0.5">Settings won't persist. Sign up to save your preferences.</p>
        </div>
      )}

      <div className="stack-row">
        <PanelBar>
          {panels.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`seg-item btn-press ${panel === key ? 'seg-item-active' : ''}`}
              style={{ borderRadius: 'var(--radius)' }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </PanelBar>
      </div>

      {/* ── Preferences: how the app behaves ──────────────────────────────────────────── */}
      {panel === 'preferences' && (<>
      {/* Display Preferences */}
      <div className="card-forged p-5 space-y-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Display</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground uppercase">Currency</label>
            {/* DISABLED ON PURPOSE, 2026-09-03. This offered EUR and GBP and changed
                NOTHING: `formatCurrency` takes a currency argument that no call site
                passes, and the only reader of `profile.currency` outside this page is
                the home-screen widget. So a user could select EUR and watch every
                balance, projection and payoff stay in dollars — a control that makes a
                promise the app breaks silently, which is worse than no control.
                Re-enable it in the same change that threads currency AND locale through
                formatCurrency, never before. See docs/international-release-plan.md. */}
            <select value={currency} onChange={e => { setCurrency(e.target.value); markDirty(); }}
              disabled
              aria-describedby="currency-note"
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground disabled:opacity-50" style={{ borderRadius: 'var(--radius)' }}>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
            <p id="currency-note" className="text-[10px] text-muted-foreground mt-1">
              Every figure is shown in US dollars. Other currencies are not supported yet.
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground uppercase">Budget Start Day</label>
            <input type="number" min={1} max={28} value={startDay} onChange={e => { setStartDay(e.target.value); markDirty(); }}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }} />
          </div>
          {/* ⚠️ THEME IS NOT PART OF `dirty` AND HAS NO SAVE BUTTON, unlike everything else on this
              card. It applies the instant it is picked, because the only way to judge a theme is to
              see it — a preview you have to press Save to view is not a preview. It is also stored
              per DEVICE rather than on the profile: a phone read in bed and a desktop under office
              lights are not the same request. See `src/lib/theme.ts`. */}
          <div>
            <label className="text-xs text-muted-foreground uppercase" htmlFor="theme-choice">Appearance</label>
            <select id="theme-choice" value={themeChoice} onChange={e => chooseTheme(e.target.value as ThemeChoice)}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
              <option value="system">Match my device</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">
              {themeChoice === 'system'
                ? `Following your device — currently ${resolvedTheme}. Applies to this device only.`
                : 'Applies to this device only.'}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs">Show cents</span>
          <button onClick={() => { setShowCents(!showCents); markDirty(); }} className={`w-8 h-4 rounded-full transition-colors ${showCents ? 'bg-primary' : 'bg-secondary'} relative`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-background transition-transform ${showCents ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs">Auto-generate recurring entries</span>
          <button onClick={() => { setAutoGenerateRecurring(!autoGenerateRecurring); markDirty(); }} className={`w-8 h-4 rounded-full transition-colors ${autoGenerateRecurring ? 'bg-primary' : 'bg-secondary'} relative`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-background transition-transform ${autoGenerateRecurring ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {/* §1B Stage 7A — merchant memory. THE one place these are edited and switched off, which is
          the whole promise of the feature: a decision the app applies everywhere has to be
          reversible somewhere obvious. Renders nothing at all until something has been learned. */}
      <MerchantRulesSettings />

      {/* Native only - it renders nothing in the browser, where local notifications do not
          exist. See the component for why there is no permission prompt on this screen. */}
      <NotificationSettings />
      </>)}

      {/* ── Account: who you are, how you share it, how you end it ────────────────────── */}
      {panel === 'account' && (<>
      {/* Profile */}
      <div className="card-forged p-5 space-y-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Profile</h2>
        <div>
          <label className="text-xs text-muted-foreground uppercase">Email</label>
          <p className="text-sm mt-0.5">{isDemo ? 'demo@forgenta.com' : user?.email || '—'}</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground uppercase">Display Name</label>
          <input value={displayName} onChange={e => { setDisplayName(e.target.value); markDirty(); }}
            className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring" style={{ borderRadius: 'var(--radius)' }} placeholder="Your name" />
        </div>
      </div>

      </>)}

      {/* ── Security: who can get in ──────────────────────────────────────────────────── */}
      {/* ⚠️ Account renders in TWO fragments — here and again below — because the source order is
          Profile, Security, Invite, Support, Danger Zone and this keeps every card exactly where
          it has always been in the file. Moving 200 lines to make one fragment would buy tidiness
          with a diff nobody can review. On screen they are still contiguous: Security is filtered
          out of the Account panel entirely. */}
      {/* Account Security — hidden in demo.
          ⚠️ THE `id="security"` ANCHOR IS GONE ON PURPOSE. The hash is handled by the effect at
          the top of this component, which selects the panel; leaving the anchor in as well made
          the browser ALSO attempt its native jump, and with the card inside a freshly-mounted
          panel that landed as a sideways scroll with the page cut off at the right edge. One
          mechanism, not two. `/settings#security` still works — it just works once. */}
      {panel === 'security' && !isDemo && (
        <div className="card-forged p-5 space-y-5">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account Security</h2>

          {/* Change Email */}
          <SettingsSection
            icon={Mail}
            title="Change Email"
            description="The address you sign in with, and where account and security notices are sent. The new address has to be confirmed before it takes effect."
          >
            <p className="text-xs text-muted-foreground">
              Current: <span className="text-foreground">{user?.email}</span>
            </p>
            {emailSent ? (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle size={13} />
                Verification sent to your new email. Click the link to confirm the change.
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="New email address"
                  className="w-full sm:flex-1 min-w-0 bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <button
                  onClick={handleEmailChange}
                  disabled={emailLoading || !newEmail.trim()}
                  className="btn btn-sm btn-secondary w-full sm:w-auto"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {emailLoading ? 'Sending…' : 'Send Verification'}
                </button>
              </div>
            )}
            {emailSent && (
              <button onClick={() => setEmailSent(false)} className="text-xs text-muted-foreground hover:text-foreground underline">
                Send again
              </button>
            )}
          </SettingsSection>

          <div className="border-t border-border" />

          {/* Linked Accounts */}
          <LinkedAccounts />

          <div className="border-t border-border" />

          {/* Partner Link (partner-linking design §4 Phase 1) */}
          <PartnerLink />

          <div className="border-t border-border" />

          {/* Friends (friends-leaderboard plan §4 Phase 1) — free tier, no view
              lens: a friend can never see a budget, only shared progress. */}
          <FriendLink />

          <div className="border-t border-border" />

          {/* Two-Factor Auth */}
          <TwoFactorAuth />

          <div className="border-t border-border" />

          {/* Trusted Devices */}
          <SettingsSection
            icon={Monitor}
            title="Trusted Devices"
            description="Devices that skip 2FA for 30 days after you verify once. Revoke one and it has to verify again next time."
          >
            {trustedDevices.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No trusted devices yet.</p>
            ) : (
              <div className="space-y-2">
                {trustedDevices.map(device => {
                  const isCurrentDevice = getTrustedDeviceId() === device.device_id;
                  // Deliberate render-time clock read: trusted-device expiry is a 30-day
                  // threshold, so no realistic re-render can straddle it and flip the badge.
                  // eslint-disable-next-line react-hooks/purity
                  const isExpired = Date.now() - new Date(device.trusted_at).getTime() >= 30 * 24 * 60 * 60 * 1000;
                  return (
                    <div key={device.device_id} className="flex items-center justify-between gap-3 bg-secondary/40 border border-border px-3 py-2.5" style={{ borderRadius: 'var(--radius)' }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-medium truncate">{device.name}</p>
                          {isCurrentDevice && (
                            <span className="text-xs px-1 py-0.5 bg-primary/15 text-primary border border-primary/30 shrink-0" style={{ borderRadius: 'var(--radius)' }}>
                              This device
                            </span>
                          )}
                          {isExpired && (
                            <span className="text-xs px-1 py-0.5 bg-gold/15 text-gold border border-gold/30 shrink-0" style={{ borderRadius: 'var(--radius)' }}>
                              Expired
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Trusted {format(new Date(device.trusted_at), 'MMM d, yyyy')} · Last seen {format(new Date(device.last_seen), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRevokeDevice(device.device_id)}
                        className="btn btn-sm btn-outline text-muted-foreground hover:border-destructive/40 hover:text-destructive shrink-0"
                        style={{ borderRadius: 'var(--radius)' }}
                      >
                        Revoke
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </SettingsSection>

          <div className="border-t border-border" />

          {/* Change Password */}
          <SettingsSection
            icon={Lock}
            title="Change Password"
            description="Set a new sign-in password. You stay signed in on this device; other devices are unaffected."
          >
            {passwordSuccess ? (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle size={13} />
                Password updated successfully.
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="New password (min 6 characters)"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className={`w-full bg-secondary border px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring ${
                    confirmNewPassword && confirmNewPassword !== newPassword
                      ? 'border-destructive focus:ring-destructive'
                      : 'border-border'
                  }`}
                  style={{ borderRadius: 'var(--radius)' }}
                />
                {confirmNewPassword && confirmNewPassword !== newPassword && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
                <button
                  onClick={handlePasswordChange}
                  disabled={passwordLoading || !currentPassword || !newPassword || newPassword !== confirmNewPassword}
                  className="btn btn-md btn-secondary w-full"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {passwordLoading ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            )}
          </SettingsSection>

          <div className="border-t border-border" />

          {/* Sign out all devices */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <LogOut size={13} className="text-muted-foreground" />
              <span className="text-xs font-medium">Sign Out All Devices</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Immediately invalidates all active sessions across every device and browser. Use after a password change or if you suspect unauthorized access.
            </p>
            {forceSignOutConfirm ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-xs text-muted-foreground">Sign out everywhere, including this device?</span>
                <button
                  onClick={handleForceSignOut}
                  disabled={forceSignOutLoading}
                  className="btn btn-md btn-danger w-full sm:w-auto"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {forceSignOutLoading ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                  {forceSignOutLoading ? 'Signing out…' : 'Yes, sign out all'}
                </button>
                <button
                  onClick={() => setForceSignOutConfirm(false)}
                  disabled={forceSignOutLoading}
                  className="btn btn-md btn-ghost"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setForceSignOutConfirm(true)}
                className="btn btn-md bg-secondary border border-border hover:border-destructive/40 hover:text-destructive w-full sm:w-auto"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <LogOut size={12} /> Sign out all devices
              </button>
            )}
          </div>
        </div>
      )}

      {/* Invite a Friend — Tre asked for this to sit with Profile (2026-08-18) */}
      {panel === 'account' && !isDemo && user && (
        <div className="card-forged p-5 space-y-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Share2 size={12} /> Invite a Friend
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Share Forgenta with someone who wants to take control of their finances.
            </p>
            {referralCount !== null && referralCount > 0 && (
              <span className="text-xs font-medium text-primary shrink-0">
                {referralCount} joined via your link
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="w-full sm:flex-1 min-w-0 bg-secondary border border-border px-3 py-2 text-xs text-muted-foreground font-mono truncate" style={{ borderRadius: 'var(--radius)' }}>
              {`https://getforgenta.com?ref=${user.id.slice(0, 8)}`}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`https://getforgenta.com?ref=${user.id.slice(0, 8)}`);
                setInviteCopied(true);
                setTimeout(() => setInviteCopied(false), 2000);
              }}
              className="btn btn-md btn-secondary w-full sm:w-auto shrink-0"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {inviteCopied
                ? <><CheckCircle size={12} className="text-success" /> Copied!</>
                : <><Copy size={12} /> Copy link</>}
            </button>
          </div>
        </div>
      )}

      {/* Support */}
      {panel === 'account' && !isDemo && (
        <div className="card-forged p-5 space-y-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Support</h2>
          {isPremium ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <MessageCircle size={13} className="text-primary" />
                  <span className="text-xs font-medium">Priority Support</span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium" style={{ borderRadius: 'var(--radius)' }}>Premium</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Priority support for premium members. Email us with your account issue and our team will get back to you.
                </p>
              </div>
              <a
                href={`mailto:contact@getforgenta.com?subject=${encodeURIComponent(`[Premium] Support Request — ${user?.email ?? ''}`)}&body=${encodeURIComponent(`Account: ${user?.email ?? ''}\nUser ID: ${user?.id ?? ''}\n\n`)}`}
                className="shrink-0 flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <Mail size={12} /> Email Support
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <MessageCircle size={13} className="text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Priority Support</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Priority support is exclusive to premium members. Upgrade to unlock front-of-queue email support.
                </p>
              </div>
              <Link
                to="/premium"
                className="shrink-0 flex items-center gap-1.5 bg-secondary border border-primary/30 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/10 transition-colors btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <Crown size={12} /> Upgrade
              </Link>
            </div>
          )}

          <div className="border-t border-border pt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Bug size={13} className="text-muted-foreground" />
                <span className="text-xs font-medium">Report a Bug</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Found something broken? Let us know and we'll fix it fast.
              </p>
            </div>
            <a
              href={`mailto:contact@getforgenta.com?subject=${encodeURIComponent(`[Bug Report] — ${user?.email ?? ''}`)}&body=${encodeURIComponent(`Account: ${user?.email ?? ''}\nUser ID: ${user?.id ?? ''}\n\nDescribe the bug:\n\nSteps to reproduce:\n1. \n2. \n3. \n\nExpected behavior:\n\nActual behavior:\n`)}`}
              className="shrink-0 flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Bug size={12} /> Report Bug
            </a>
          </div>
        </div>
      )}

      {/* Danger Zone — hidden in demo mode. Last card on Account, and deliberately so: the way
          out of the product sits at the bottom of the page about the account, not beside a
          preference someone is mid-way through changing. */}
      {panel === 'account' && !isDemo && (
        <div className="card-forged p-5 space-y-4 border border-destructive/20">
          <h2 className="text-xs font-medium text-destructive uppercase tracking-wider">Danger Zone</h2>

          {deleteStep === 'hidden' && (() => {
            const provider = subscription?.purchase_provider;
            // Block only if actively renewing — cancel_at_period_end means no future charge risk
            const hasMobileSub = isPremium && (provider === 'apple' || provider === 'google') && !subscription?.cancel_at_period_end;
            const storeLabel = provider === 'apple' ? 'App Store' : 'Google Play';
            const storeSteps = provider === 'apple'
              ? 'Settings → [your name] → Subscriptions → Forgenta → Cancel'
              : 'Play Store → Profile → Payments & subscriptions → Subscriptions → Forgenta → Cancel';

            return (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium">Delete Account</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {hasMobileSub
                      ? 'You must cancel your active subscription before deleting your account.'
                      : 'Permanently deletes your account and all data. Active subscriptions are cancelled immediately. Billing records are retained per IRS requirements.'}
                  </p>
                  <Link to="/delete-data" className="text-xs text-muted-foreground underline hover:text-foreground mt-1 inline-block">
                    What gets deleted and what we keep
                  </Link>
                  {hasMobileSub && (
                    <div className="mt-2 flex items-start gap-2 bg-gold/10 border border-gold/30 px-3 py-2.5 text-xs text-gold" style={{ borderRadius: 'var(--radius)' }}>
                      <Crown size={13} className="mt-0.5 shrink-0 text-gold" />
                      <span>
                        You have an active <strong>{storeLabel} subscription</strong>. Cancel it first to avoid further charges, then return here to delete your account.
                        <br />
                        <span className="text-gold/80 mt-1 block">{storeSteps}</span>
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => !hasMobileSub && setDeleteStep('confirm')}
                  disabled={hasMobileSub}
                  className="btn btn-md bg-secondary border border-destructive/30 text-destructive hover:bg-destructive/10 shrink-0"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <Trash2 size={12} />
                  Delete account
                </button>
              </div>
            );
          })()}

          {deleteStep === 'confirm' && (
            <div className="space-y-3">
              {/* Irreversible warning */}
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>
                  This is <strong>permanent and irreversible</strong>. All your budgets, accounts, transactions, and goals will be deleted.
                </span>
              </div>

              {/* Subscription cancellation notice */}
              {isPremium && (
                <div className="flex items-start gap-2 bg-gold/10 border border-gold/30 px-3 py-2.5 text-xs text-gold" style={{ borderRadius: 'var(--radius)' }}>
                  <Crown size={13} className="mt-0.5 shrink-0 text-gold" />
                  <span>
                    Your <strong>Premium subscription will be cancelled immediately</strong> with no refund. You will lose access to all premium features upon deletion.
                  </span>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Type <strong className="text-foreground">DELETE</strong> to confirm:
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full bg-secondary border border-destructive/30 px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-destructive"
                style={{ borderRadius: 'var(--radius)' }}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirmText !== 'DELETE' || deleteLoading}
                  className="btn btn-md btn-danger w-full sm:w-auto"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {deleteLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {deleteLoading ? 'Deleting…' : 'Permanently delete my account'}
                </button>
                <button
                  onClick={resetDeleteFlow}
                  disabled={deleteLoading}
                  className="btn btn-md btn-ghost"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Plan: the subscription ─────────────────────────────────────────────────────── */}
      {/* Subscription Management — hidden in demo mode */}
      {panel === 'plan' && !isDemo && (
        <div className="card-forged p-5 space-y-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subscription</h2>

          {subLoading ? (
            <p className="text-xs text-muted-foreground">Loading subscription info…</p>
          ) : isPremium ? (
            <div className="space-y-4">
              {/* Status row */}
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-primary" />
                <span className="text-sm font-semibold text-primary">Premium Active</span>
              </div>

              {/* Plan details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="font-medium capitalize">{subscription?.subscription_status || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {subscription?.cancel_at_period_end ? 'Cancels on' : 'Renews'}
                  </span>
                  <p className="font-medium">
                    {subscription?.current_period_end
                      ? format(new Date(subscription.current_period_end), 'MMM d, yyyy')
                      : '—'}
                  </p>
                </div>
              </div>

              {/* Pending cancellation warning */}
              {subscription?.cancel_at_period_end && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Your subscription will cancel on{' '}
                    <strong>
                      {subscription.current_period_end
                        ? format(new Date(subscription.current_period_end), 'MMM d, yyyy')
                        : 'period end'}
                    </strong>
                    . You'll keep access until then.
                  </span>
                </div>
              )}

              {/* Actions — only shown when payment update is not open */}
              {!setupClientSecret && hasStripeCustomer && (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {/* Update payment method */}
                  <button
                    onClick={handleShowPaymentUpdate}
                    disabled={setupLoading}
                    className="btn btn-md btn-secondary w-full sm:w-auto"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {setupLoading ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                    Update payment method
                  </button>

                  {/* Cancel / Resume */}
                  {subscription?.cancel_at_period_end ? (
                    <button
                      onClick={() => handleCancelOrResume('resume')}
                      disabled={cancelLoading}
                      className="btn btn-md btn-primary w-full sm:w-auto"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {cancelLoading ? <Loader2 size={12} className="animate-spin" /> : <Crown size={12} />}
                      Keep subscription
                    </button>
                  ) : (
                    <>
                      {confirmCancel ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <span className="text-xs text-muted-foreground">Cancel at period end?</span>
                          <button
                            onClick={() => handleCancelOrResume('cancel')}
                            disabled={cancelLoading}
                            className="btn btn-md btn-danger"
                            style={{ borderRadius: 'var(--radius)' }}
                          >
                            {cancelLoading ? <Loader2 size={12} className="animate-spin" /> : 'Yes, cancel'}
                          </button>
                          <button
                            onClick={() => setConfirmCancel(false)}
                            className="btn btn-md btn-ghost"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmCancel(true)}
                          className="btn btn-md bg-secondary border border-border hover:border-destructive/40 hover:text-destructive w-full sm:w-auto"
                          style={{ borderRadius: 'var(--radius)' }}
                        >
                          Cancel subscription
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Embedded payment method update (Stripe Elements) */}
              {setupClientSecret && (
                <div className="card-forged overflow-hidden p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Update payment method</span>
                    <button onClick={() => setSetupClientSecret(null)} className="text-muted-foreground hover:text-foreground p-2 -mr-1 min-w-[44px] min-h-[44px] flex items-center justify-center">
                      <X size={14} />
                    </button>
                  </div>
                  <Elements
                    stripe={stripePromise}
                    options={{ clientSecret: setupClientSecret, appearance: { theme: 'night', variables: { fontSizeBase: '13px' } } }}
                  >
                    <PaymentUpdateForm
                      onSuccess={() => { setSetupClientSecret(null); refetchSub(); }}
                      onCancel={() => setSetupClientSecret(null)}
                    />
                  </Elements>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-muted-foreground" />
                <span className="text-sm font-medium">Free Plan</span>
              </div>
              <p className="text-xs text-muted-foreground">Upgrade to Premium for advanced features, unlimited history, and priority support.</p>
              <Link to="/premium" className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
                <Crown size={12} /> Upgrade to Premium
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Developer — only visible to tre@treforged.com. Filed under Plan because it is the only
          panel a signed-in owner reaches that is not about their own data. */}
      {panel === 'plan' && isNative && user?.email === DEV_EMAIL && (
        <div className="card-forged p-5 space-y-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Terminal size={12} /> Developer
          </h2>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Bug size={13} className="text-muted-foreground" />
                <span className="text-xs font-medium">Black Screen Debug Panel</span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                Shows the DBG button overlay for inspecting Swift/JS lifecycle events.
              </p>
            </div>
            <button
              onClick={() => {
                const next = !devDebug;
                setDevDebug(next);
                if (next) localStorage.setItem(DEV_DEBUG_KEY, '1');
                else localStorage.removeItem(DEV_DEBUG_KEY);
                window.dispatchEvent(new CustomEvent('forgenta:dev-debug'));
              }}
              className={`shrink-0 w-10 h-5 rounded-full transition-colors relative overflow-hidden ${devDebug ? 'bg-primary' : 'bg-secondary border border-border'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background border border-border/50 transition-transform ${devDebug ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
