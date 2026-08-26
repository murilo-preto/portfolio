export type Entry = {
  id: number;
  category: string;
  duration_seconds: number;
  start_time: string;
  end_time: string;
  /** Free text describing what was done; null when never set. */
  note: string | null;
};

export type ApiResponse = {
  username: string;
  entries: Entry[];
};
