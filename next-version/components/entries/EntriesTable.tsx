import { Entry } from "@/components/entries/types";
import { formatDuration } from "@/components/entries/utils";

type EntriesTableProps = {
  entries: Entry[];
  showAll: boolean;
};

export function EntriesTable({ entries, showAll }: EntriesTableProps) {
  return (
    <div className="bg-bone dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Detailed Entries</h2>
        <span className="text-xs opacity-70">
          Scope: {showAll ? "All entries" : "Selected week"}
        </span>
      </div>

      <div className="md:hidden space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="border border-[#F3ECE3] dark:border-neutral-800 rounded-lg p-3 space-y-1"
          >
            <div className="flex justify-between items-center">
              <span className="font-medium">{entry.category}</span>
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                {formatDuration(entry.duration_seconds)}
              </span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
              <p>
                Start:{" "}
                {new Date(entry.start_time).toLocaleString(undefined, {
                  hour12: false,
                })}
              </p>
              <p>
                End:{" "}
                {new Date(entry.end_time).toLocaleString(undefined, {
                  hour12: false,
                })}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block overflow-x-auto justify-center">
        <table className="w-full text-center">
          <thead>
            <tr className="border-b border-[#F3ECE3] dark:border-neutral-800">
              <th className="py-2">Category</th>
              <th>Start</th>
              <th>End</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-[#F3ECE3] dark:border-neutral-800 hover:bg-[#F3ECE3] dark:hover:bg-neutral-700 transition"
              >
                <td className="py-2">{entry.category}</td>
                <td>
                  {new Date(entry.start_time).toLocaleString(undefined, {
                    hour12: false,
                  })}
                </td>
                <td>
                  {new Date(entry.end_time).toLocaleString(undefined, {
                    hour12: false,
                  })}
                </td>
                <td>{formatDuration(entry.duration_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
