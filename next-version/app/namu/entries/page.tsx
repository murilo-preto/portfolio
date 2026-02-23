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

const LIGHT_CHART_PALETTE = [
  "#a3b18a",
  "#9EA479",
  "#899063",
  "#354024",
  "#3A3D29",
];

const DARK_CHART_PALETTE = [
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
];

export default function Entries() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function get_entries() {
    try {
      const res = await fetch("/api/entries", {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch entries");
      }

      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    get_entries();
  }, []);

  /* -------------------------
     Derived Metrics
  -------------------------- */

  const totalSeconds = useMemo(() => {
    if (!data) return 0;
    return data.entries.reduce((acc, e) => acc + e.duration_seconds, 0);
  }, [data]);

  const totalHours = (totalSeconds / 3600).toFixed(1);

  const sessionsCount = data?.entries.length ?? 0;

  const longestSession = useMemo(() => {
    if (!data || data.entries.length === 0) return 0;
    return Math.max(...data.entries.map((e) => e.duration_seconds));
  }, [data]);

  const longestSessionHours = (longestSession / 3600).toFixed(2);

  const categoryBreakdown = useMemo(() => {
    if (!data) return [];

    const grouped: Record<string, number> = {};

    data.entries.forEach((entry) => {
      grouped[entry.category] =
        (grouped[entry.category] || 0) + entry.duration_seconds;
    });

    const categories = Object.entries(grouped);

    return categories.map(([category, seconds], index) => ({
      category,
      hours: +(seconds / 3600).toFixed(2),
      fill: LIGHT_CHART_PALETTE[index % LIGHT_CHART_PALETTE.length],
    }));
  }, [data]);

  function formatDuration(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  if (loading) {
    return <main className="p-6">Loading dashboard...</main>;
  }

  if (error) {
    return <main className="p-6 text-red-500">{error}</main>;
  }

  if (!data) return null;

  return (
    <main className="flex-1 p-6 space-y-12 max-w-6xl mx-auto">
      {/* -------------------------
          Header
      -------------------------- */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{data.username}'s Dashboard</h1>
          <p className="text-sm text-gray-500">Weekly Overview</p>
        </div>

        {/* Placeholder Week Selector */}
        {/* <select className="border rounded px-3 py-2 bg-transparent"> */}
        {/*   <option>This Week</option> */}
        {/*   <option>Last Week</option> */}
        {/* </select> */}
      </div>

      {/* -------------------------
          Row 1: Stats Cards
      -------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-bone dark:bg-neutral-900 p-6 rounded-xl shadow text-black dark:text-white">
          <p className="text-sm opacity-70">Total Hours</p>
          <p className="text-3xl font-bold">{totalHours}h</p>
        </div>

        <div className="bg-bone dark:bg-neutral-900 p-6 rounded-xl shadow text-black dark:text-white">
          <p className="text-sm opacity-70">Sessions</p>
          <p className="text-3xl font-bold">{sessionsCount}</p>
        </div>

        <div className="bg-bone dark:bg-neutral-900 p-6 rounded-xl shadow text-black dark:text-white">
          <p className="text-sm opacity-70">Longest Session</p>
          <p className="text-3xl font-bold">{longestSessionHours}h</p>
        </div>
      </div>

      {/* -------------------------
          Row 2: Bar Chart
      -------------------------- */}

      <div className="bg-offwhite p-6 rounded-xl shadow text-black">
        <h2 className="text-lg font-semibold mb-4">Hours by Category</h2>

        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={categoryBreakdown}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="hours" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* -------------------------
          Row 3: Detailed Table
      -------------------------- */}
      <div className="bg-bone p-6 rounded-xl shadow text-black overflow-x-auto">
        <h2 className="text-lg font-semibold mb-4">Detailed Entries</h2>

        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#F3ECE3]">
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
                className="border-b border-[#F3ECE3] hover:bg-[#F3ECE3] transition"
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
