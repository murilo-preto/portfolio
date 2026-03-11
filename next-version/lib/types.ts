// Shared types for API responses

export interface User {
  id: number;
  username: string;
}

export interface TimeEntry {
  id: number;
  category: string;
  start_time: string;
  end_time: string;
  duration_seconds?: number;
}

export interface FinanceEntry {
  id: number;
  category: string;
  product_name: string;
  price: number;
  purchase_date: string;
  status: "planned" | "done";
}

export interface Category {
  id: number;
  name: string;
}

export interface FinanceCategory {
  id: number;
  name: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
  username?: string;
  entries?: T[];
  categories?: Category[];
  message?: string;
  error?: string;
  authenticated?: boolean;
  user_id?: number;
  access_token?: string;
}

export interface AuthResponse {
  authenticated: true;
  user_id: number;
  username: string;
}

export interface ErrorResponse {
  error: string;
}
