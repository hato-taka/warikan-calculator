import type { Expense, Participant, SettlementEntry } from '../types';

export type CalculatedBalance = {
  participant: Participant;
  paid: number;
  shouldPay: number;
  diff: number;
};

export const calculateBalances = (
  participants: Participant[],
  expenses: Expense[]
): CalculatedBalance[] => {
  const ledger = new Map<string, { participant: Participant; paid: number; shouldPay: number }>();

  participants.forEach((participant) => {
    ledger.set(participant.id, { participant, paid: 0, shouldPay: 0 });
  });

  expenses.forEach((expense) => {
    if (expense.amount <= 0) return;
    const payer = ledger.get(expense.payerId);
    if (payer) {
      payer.paid += expense.amount;
    }

    expense.shares.forEach((share) => {
      const holder = ledger.get(share.participantId);
      if (!holder) return;
      holder.shouldPay += share.amount;
    });
  });

  return Array.from(ledger.values()).map((entry) => {
    const paid = Math.round(entry.paid);
    const shouldPay = Math.round(entry.shouldPay);
    const diff = paid - shouldPay;
    return {
      participant: entry.participant,
      paid,
      shouldPay,
      diff
    };
  });
};

export const buildSettlementPlan = (balances: CalculatedBalance[]): SettlementEntry[] => {
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  balances.forEach((balance) => {
    if (balance.diff > 0) {
      creditors.push({ id: balance.participant.id, amount: balance.diff });
    } else if (balance.diff < 0) {
      debtors.push({ id: balance.participant.id, amount: Math.abs(balance.diff) });
    }
  });

  const settlements: SettlementEntry[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0) {
      settlements.push({ from: debtor.id, to: creditor.id, amount });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount === 0) {
      debtorIndex += 1;
    }
    if (creditor.amount === 0) {
      creditorIndex += 1;
    }
  }

  return settlements;
};
