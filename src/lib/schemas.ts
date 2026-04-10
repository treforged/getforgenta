import { z } from 'zod';

// ── Auth ──────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

export const signUpSchema = z.object({
  displayName: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  email: z.string().email('Enter a valid email address').max(254),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

// ── Settings — security ───────────────────────────────────────────────────────

export const emailChangeSchema = z.object({
  newEmail: z.string().trim().email('Enter a valid email address').max(254),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(128),
  newPassword: z.string().min(6, 'New password must be at least 6 characters').max(128),
  confirmNewPassword: z.string(),
}).refine(d => d.newPassword === d.confirmNewPassword, {
  message: 'Passwords do not match',
  path: ['confirmNewPassword'],
}).refine(d => d.newPassword !== d.currentPassword, {
  message: 'New password must be different from current password',
  path: ['newPassword'],
});

export const profileSchema = z.object({
  display_name: z.string().trim().max(50).optional(),
  currency: z.enum(['USD']),
  weekly_gross_income: z.number().min(0).max(10_000_000),
  tax_rate: z.number().min(0).max(100),
  cash_floor: z.number().min(0).max(10_000_000),
  budget_start_day: z.number().int().min(1).max(31),
  paycheck_frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  paycheck_day: z.number().int().min(0).max(31),
  paycheck_start_date: z.string().nullable().optional(),
  show_cents: z.boolean(),
  compact_mode: z.boolean(),
  default_deposit_account: z.string().nullable().optional(),
  auto_generate_recurring: z.boolean(),
});

// ── Accounts ──────────────────────────────────────────────────────────────────

export const accountSchema = z.object({
  name: z.string().trim().min(1, 'Account name is required').max(100),
  account_type: z.enum([
    'checking', 'savings', 'high_yield_savings', 'business_checking',
    'credit_card', 'auto_loan', 'mortgage', 'student_loan', 'personal_loan',
  ]),
  institution: z.string().trim().max(100).optional(),
  balance: z.number().min(-10_000_000).max(10_000_000),
  credit_limit: z.number().min(0).max(10_000_000).nullable().optional(),
  apr: z.number().min(0).max(100).nullable().optional(),
  min_payment: z.number().min(0).max(100_000).nullable().optional(),
  notes: z.string().max(500).optional(),
});

// ── Budget / Recurring Rules ──────────────────────────────────────────────────

export const recurringRuleSchema = z.object({
  name: z.string().trim().min(1, 'Rule name is required').max(100),
  amount: z.number().min(0).max(1_000_000),
  rule_type: z.enum(['income', 'expense', 'transfer', 'savings']),
  frequency: z.enum(['monthly', 'weekly', 'biweekly', 'yearly', 'one_time']),
  due_day: z.number().int().min(1).max(31).optional().nullable(),
  category: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

// ── Transactions ──────────────────────────────────────────────────────────────

export const transactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  type: z.enum(['expense', 'income', 'transfer']),
  amount: z.number().min(0).max(1_000_000),
  category: z.string().max(50).optional(),
  account: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

// ── Savings Goals ─────────────────────────────────────────────────────────────

export const savingsGoalSchema = z.object({
  name: z.string().trim().min(1, 'Goal name is required').max(100),
  target_amount: z.number().min(0).max(10_000_000),
  current_amount: z.number().min(0).max(10_000_000),
  monthly_contribution: z.number().min(0).max(1_000_000),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional().nullable(),
  goal_type: z.enum(['Emergency Fund', 'Vacation', 'Down Payment', 'Car Fund', 'Retirement', 'Custom']),
  linked_account: z.string().nullable().optional(),
});

// ── Query Params ──────────────────────────────────────────────────────────────

export const premiumSuccessParamsSchema = z.object({
  session_id: z.string().regex(/^cs_(test|live)_[a-zA-Z0-9]+$/, 'Invalid session ID').max(200),
});
