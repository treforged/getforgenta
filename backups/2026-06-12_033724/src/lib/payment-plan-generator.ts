export type PaymentPlanFrequency = 'weekly' | 'biweekly' | 'monthly';

export type PaymentPlan = {
  id: string;
  user_id: string;
  name: string;
  provider: string | null;
  total_amount: number;
  payment_amount: number;
  frequency: PaymentPlanFrequency;
  start_date: string; // YYYY-MM-DD
  total_payments: number;
  category: string;
  payment_source: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

function getPaymentDates(startDate: string, frequency: PaymentPlanFrequency, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(startDate + 'T00:00:00');
  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().split('T')[0]);
    if (frequency === 'weekly') {
      d.setDate(d.getDate() + 7);
    } else if (frequency === 'biweekly') {
      d.setDate(d.getDate() + 14);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
  }
  return dates;
}

export function getNextPaymentDate(plan: PaymentPlan): string | null {
  const today = new Date().toISOString().split('T')[0];
  const dates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
  return dates.find(d => d >= today) ?? null;
}

export function getPlanProgress(plan: PaymentPlan): { paid: number; remaining: number; endDate: string } {
  const today = new Date().toISOString().split('T')[0];
  const dates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
  const paid = dates.filter(d => d < today).length;
  const endDate = dates[dates.length - 1] ?? plan.start_date;
  return { paid, remaining: plan.total_payments - paid, endDate };
}

export function generatePaymentPlanTransactions(plans: PaymentPlan[]): any[] {
  const results: any[] = [];
  for (const plan of plans) {
    if (!plan.active) continue;
    const dates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
    dates.forEach((date, i) => {
      results.push({
        id: `plan:${plan.id}:${i}`,
        date,
        type: 'expense',
        amount: plan.payment_amount,
        category: plan.category,
        note: `${plan.name} (${i + 1}/${plan.total_payments})`,
        payment_source: plan.payment_source ?? '',
        account: '',
        isGenerated: true,
        isPlanPayment: true,
        planId: plan.id,
        paymentIndex: i,
      });
    });
  }
  return results;
}
