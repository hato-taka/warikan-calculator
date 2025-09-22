export type Participant = {
  id: string;
  name: string;
};

export type ExpenseShare = {
  participantId: string;
  amount: number; // Assigned amount for the expense
};

export type Expense = {
  id: string;
  title: string;
  amount: number;
  payerId: string;
  shares: ExpenseShare[];
};

export type SettlementEntry = {
  from: string;
  to: string;
  amount: number;
};
