// Format duration in seconds to human-readable string
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

// The backend serializes some timestamps as naive ISO strings (no "Z" or
// offset) even though the underlying value is UTC. Only skip the UTC
// assumption when an explicit offset is already present.
function parseServerDate(iso: string): Date {
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const hasOffset = /Z$|[+-]\d{2}:\d{2}$/.test(normalized);
  return new Date(hasOffset ? normalized : normalized + "Z");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Format datetime to local string
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Format date only
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Get priority color
export function getPriorityColor(priority: string): string {
  switch (priority) {
    case "high":
      return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
    case "medium":
      return "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800";
    case "low":
      return "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800";
    default:
      return "text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800";
  }
}

// Get status color
export function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800";
    case "in_progress":
      return "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800";
    case "pending":
      return "text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800";
    default:
      return "text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800";
  }
}

// Check if item is overdue
export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === "completed") return false;
  const due = parseServerDate(dueDate);
  const now = new Date();
  return due < now;
}

// Convert to local datetime value for input
export function toLocalDatetimeValue(iso: string | null): string {
  if (!iso) return "";
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return "";
  return toDatetimeLocalValue(d);
}

// A date `daysFromNow` days out at 23:59, formatted for a datetime-local input.
// A due date most naturally lands at end-of-day, so all presets share this.
export function endOfDayOffsetLocalValue(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(23, 59, 0, 0);
  return toDatetimeLocalValue(d);
}

// Today's date at 23:59, formatted for a datetime-local input
export function endOfTodayLocalValue(): string {
  return endOfDayOffsetLocalValue(0);
}
