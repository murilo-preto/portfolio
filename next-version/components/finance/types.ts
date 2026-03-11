export type FinanceEntry = {
  id: number;
  category: string;
  product_name: string;
  price: number;
  purchase_date: string;
  status: "planned" | "done";
};

export type ApiResponse = {
  username: string;
  entries: FinanceEntry[];
};

export type RecurringExpense = {
  id: number;
  category: string;
  name: string;
  amount: number;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  next_payment_date: string | null;
  created_at: string;
  updated_at: string;
};

export type RecurringExpensesApiResponse = {
  username: string;
  expenses: RecurringExpense[];
};
