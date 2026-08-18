// Shapes shared by the /onboarding wizard and the step components extracted from it. They are the
// wizard's DRAFT rows — strings, because they come straight from text inputs and are only parsed at
// save time — not the database shapes.

export const GOAL_TYPES = ['Emergency Fund', 'Vacation', 'Down Payment', 'Car Fund', 'Retirement', 'Custom'] as const;
export type GoalType = typeof GOAL_TYPES[number];

export interface DebtEntry {
  name: string;
  balance: string;
  apr: string;
  minPayment: string;
  creditLimit: string;
  dueDate: string;
}

export interface GoalEntry {
  name: string;
  targetAmount: string;
  goalType: GoalType;
  // Car Fund fields
  targetPrice: string;
  taxFees: string;
  monthlyInsurance: string;
  expectedApr: string;
  loanTermMonths: string;
}

/** Lives beside the shape so the debts step and the finish summary cannot drift apart. */
export function totalDebtOf(debts: DebtEntry[]): number {
  return debts.reduce((s, d) => s + (parseFloat(d.balance) || 0), 0);
}

export const emptyDebt = (): DebtEntry => ({ name: '', balance: '', apr: '', minPayment: '', creditLimit: '', dueDate: '' });

export const emptyGoal = (type: GoalType = 'Custom'): GoalEntry => ({
  name: type === 'Custom' ? '' : type,
  targetAmount: '',
  goalType: type,
  targetPrice: '',
  taxFees: '',
  monthlyInsurance: '',
  expectedApr: '',
  loanTermMonths: '60',
});
