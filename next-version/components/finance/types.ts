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
