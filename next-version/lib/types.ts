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

export interface Tag {
  id: number;
  name: string;
}

export type RecurrenceRule = "none" | "daily" | "weekly" | "monthly";

export interface TodoItem {
  id: number;
  category: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "completed";
  due_date: string | null;
  recurrence_rule: RecurrenceRule;
  recurrence_parent_id: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
}

export type SessionType = "pomodoro" | "short_break" | "long_break";
export type SessionStatus = "in_progress" | "completed" | "cancelled";

export interface PomodoroSession {
  id: number;
  todo_id: number | null;
  todo_title: string | null;
  session_type: SessionType;
  duration_seconds: number;
  status: SessionStatus;
  session_date: string;
  created_at: string;
}

export interface PomodoroStats {
  username: string;
  stats: {
    total: {
      sessions: number;
      total_seconds: number;
    };
    today: {
      sessions: number;
      total_seconds: number;
    };
    week: {
      sessions: number;
      total_seconds: number;
    };
    today_breaks: {
      sessions: number;
      total_seconds: number;
    };
  };
}

export interface PomodoroSettings {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
}

// TODO API Response types
export interface TodoApiResponse {
  username: string;
  items: TodoItem[];
}

export interface PomodoroSessionsResponse {
  username: string;
  sessions: PomodoroSession[];
}

// TODO filter types
export type StatusFilter = "all" | "pending" | "in_progress" | "completed";
export type PriorityFilter = "all" | "low" | "medium" | "high";

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
