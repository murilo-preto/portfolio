export type Entry = {
  id: number;
  category: string;
  duration_seconds: number;
  start_time: string;
  end_time: string;
};

export type ApiResponse = {
  username: string;
  entries: Entry[];
};
