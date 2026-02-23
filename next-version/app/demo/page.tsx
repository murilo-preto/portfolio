"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type Entry = {
  id: number;
  category: string;
  duration_seconds: number;
  start_time: string;
  end_time: string;
};

type ApiResponse = {
  username: string;
  entries: Entry[];
};

/* -------------------------
   DEMO DATA (Hardcoded)
-------------------------- */

const DEMO_DATA: ApiResponse = {
  username: "bob",
  entries: [
    {
      category: "Exercise",
      duration_seconds: 14100,
      end_time: "Mon, 16 Feb 2026 03:12:39 GMT",
      id: 17,
      start_time: "Sun, 15 Feb 2026 23:17:39 GMT",
    },
    {
      category: "Reading",
      duration_seconds: 7320,
      end_time: "Mon, 16 Feb 2026 12:44:08 GMT",
      id: 12,
      start_time: "Mon, 16 Feb 2026 10:42:08 GMT",
    },
    {
      category: "Work",
      duration_seconds: 10440,
      end_time: "Mon, 16 Feb 2026 13:43:50 GMT",
      id: 41,
      start_time: "Mon, 16 Feb 2026 10:49:50 GMT",
    },
    {
      category: "Study",
      duration_seconds: 10920,
      end_time: "Mon, 16 Feb 2026 17:01:05 GMT",
      id: 42,
      start_time: "Mon, 16 Feb 2026 13:59:05 GMT",
    },
    {
      category: "Work",
      duration_seconds: 9180,
      end_time: "Tue, 17 Feb 2026 07:54:54 GMT",
      id: 46,
      start_time: "Tue, 17 Feb 2026 05:21:54 GMT",
    },
    {
      category: "Exercise",
      duration_seconds: 10260,
      end_time: "Tue, 17 Feb 2026 09:46:25 GMT",
      id: 18,
      start_time: "Tue, 17 Feb 2026 06:55:25 GMT",
    },
    {
      category: "Work",
      duration_seconds: 14400,
      end_time: "Wed, 18 Feb 2026 19:18:56 GMT",
      id: 19,
      start_time: "Wed, 18 Feb 2026 15:18:56 GMT",
    },
    {
      category: "Study",
      duration_seconds: 13080,
      end_time: "Wed, 18 Feb 2026 23:58:15 GMT",
      id: 20,
      start_time: "Wed, 18 Feb 2026 20:20:15 GMT",
    },
    {
      category: "Study",
      duration_seconds: 13440,
      end_time: "Thu, 19 Feb 2026 02:46:56 GMT",
      id: 44,
      start_time: "Wed, 18 Feb 2026 23:02:56 GMT",
    },
    {
      category: "Study",
      duration_seconds: 10440,
      end_time: "Thu, 19 Feb 2026 07:25:33 GMT",
      id: 48,
      start_time: "Thu, 19 Feb 2026 04:31:33 GMT",
    },
    {
      category: "Exercise",
      duration_seconds: 9300,
      end_time: "Thu, 19 Feb 2026 12:46:13 GMT",
      id: 45,
      start_time: "Thu, 19 Feb 2026 10:11:13 GMT",
    },
    {
      category: "Reading",
      duration_seconds: 3360,
      end_time: "Thu, 19 Feb 2026 15:53:04 GMT",
      id: 15,
      start_time: "Thu, 19 Feb 2026 14:57:04 GMT",
    },
    {
      category: "Exercise",
      duration_seconds: 5520,
      end_time: "Thu, 19 Feb 2026 19:00:10 GMT",
      id: 43,
      start_time: "Thu, 19 Feb 2026 17:28:10 GMT",
    },
    {
      category: "Work",
      duration_seconds: 12720,
      end_time: "Fri, 20 Feb 2026 07:08:44 GMT",
      id: 49,
      start_time: "Fri, 20 Feb 2026 03:36:44 GMT",
    },
    {
      category: "Work",
      duration_seconds: 5400,
      end_time: "Fri, 20 Feb 2026 09:22:55 GMT",
      id: 14,
      start_time: "Fri, 20 Feb 2026 07:52:55 GMT",
    },
    {
      category: "Study",
      duration_seconds: 9840,
      end_time: "Fri, 20 Feb 2026 20:51:17 GMT",
      id: 50,
      start_time: "Fri, 20 Feb 2026 18:07:17 GMT",
    },
    {
      category: "Study",
      duration_seconds: 4500,
      end_time: "Fri, 20 Feb 2026 23:43:51 GMT",
      id: 47,
      start_time: "Fri, 20 Feb 2026 22:28:51 GMT",
    },
    {
      category: "Work",
      duration_seconds: 1800,
      end_time: "Sat, 21 Feb 2026 12:01:15 GMT",
      id: 13,
      start_time: "Sat, 21 Feb 2026 11:31:15 GMT",
    },
    {
      category: "Work",
      duration_seconds: 13200,
      end_time: "Sat, 21 Feb 2026 22:55:31 GMT",
      id: 16,
      start_time: "Sat, 21 Feb 2026 19:15:31 GMT",
    },
    {
      category: "Study",
      duration_seconds: 11580,
      end_time: "Sun, 22 Feb 2026 06:28:09 GMT",
      id: 11,
      start_time: "Sun, 22 Feb 2026 03:15:09 GMT",
    },
  ],
};

/* -------------------------
   Palettes
-------------------------- */

const LIGHT_CHART_PALETTE = [
  "#a3b18a",
  "#9EA479",
  "#899063",
  "#354024",
  "#3A3D29",
];

const DARK_CHART_PALETTE = [
  "#00111c",
  "#001523",
  "#001a2c",
  "#002137",
  "#00253e",
  "#002945",
  "#002e4e",
  "#003356",
  "#003a61",
  "#00406c",
];

export default function EntriesDemo() {
  const [data] = useState<ApiResponse>(DEMO_DATA);
  const [isDark, setIsDark] = useState(false);

  /* Detect system theme */
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(media.matches);

    const listener = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
    };

    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  /* Metrics */
  const totalSeconds = useMemo(() => {
    return data.entries.reduce((acc, e) => acc + e.duration_seconds, 0);
  }, [data]);

  const totalHours = (totalSeconds / 3600).toFixed(1);
  const sessionsCount = data.entries.length;

  const longestSession = useMemo(() => {
    return Math.max(...data.entries.map((e) => e.duration_seconds));
  }, [data]);

  const longestSessionHours = (longestSession / 3600).toFixed(2);

  const categoryBreakdown = useMemo(() => {
    const graph_palette = isDark ? DARK_CHART_PALETTE : LIGHT_CHART_PALETTE;

    const grouped: Record<string, number> = {};

    data.entries.forEach((entry) => {
      grouped[entry.category] =
        (grouped[entry.category] || 0) + entry.duration_seconds;
    });

    return Object.entries(grouped).map(([category, seconds], index) => ({
      category,
      hours: +(seconds / 3600).toFixed(2),
      fill: graph_palette[index % graph_palette.length],
    }));
  }, [data, isDark]);

  function formatDuration(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  return (
    <main className="flex-1 p-6 space-y-12 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">{data.username}'s Demo Dashboard</h1>
        <p className="text-sm text-gray-500">Static Demo Version</p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card title="Total Hours" value={`${totalHours}h`} />
        <Card title="Sessions" value={sessionsCount} />
        <Card title="Longest Session" value={`${longestSessionHours}h`} />
      </div>

      {/* Chart */}
      <div className="bg-offwhite dark:bg-neutral-900 p-6 rounded-xl shadow text-black dark:text-white">
        <h2 className="text-lg font-semibold mb-4">Hours by Category</h2>

        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={categoryBreakdown}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" />
            <YAxis />
            <Tooltip
              cursor={{
                fill: isDark ? "#262626" : "#e7e5e4",
              }}
            />
            <Bar dataKey="hours" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="bg-bone dark:bg-neutral-900 p-6 rounded-xl shadow text-black dark:text-white overflow-x-auto">
        <h2 className="text-lg font-semibold mb-4">Detailed Entries</h2>

        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#F3ECE3] dark:border-neutral-800">
              <th className="py-2">Category</th>
              <th>Start</th>
              <th>End</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-[#F3ECE3] dark:border-neutral-800 hover:bg-[#F3ECE3] dark:hover:bg-neutral-700 transition"
              >
                <td className="py-2">{entry.category}</td>
                <td>{new Date(entry.start_time).toLocaleString()}</td>
                <td>{new Date(entry.end_time).toLocaleString()}</td>
                <td>{formatDuration(entry.duration_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/* Reusable Card */
function Card({ title, value }: { title: string; value: any }) {
  return (
    <div className="bg-bone dark:bg-neutral-900 p-6 rounded-xl shadow text-black dark:text-white">
      <p className="text-sm opacity-70">{title}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}
