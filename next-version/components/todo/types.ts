// TODO Item types
export type TodoItem = {
  id: number;
  category: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "completed";
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

// Category type
export type Category = {
  id: number;
  name: string;
};

// Pomodoro session type
export type PomodoroSession = {
  id: number;
  todo_id: number | null;
  todo_title: string | null;
  duration_seconds: number;
  completed: boolean;
  session_date: string;
  created_at: string;
};

// Pomodoro stats type
export type PomodoroStats = {
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
  };
};

// API Response types
export type TodoApiResponse = {
  username: string;
  items: TodoItem[];
};

export type PomodoroSessionsResponse = {
  username: string;
  sessions: PomodoroSession[];
};

// Filter types
export type StatusFilter = "all" | "pending" | "in_progress" | "completed";
export type PriorityFilter = "all" | "low" | "medium" | "high";
