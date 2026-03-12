"use client";

import { useState, useRef } from "react";
import { formatDuration } from "@/components/entries/utils";

type ParsedEntry = {
  id: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  category: string;
};

type Status = "idle" | "loading" | "success" | "error";

function parseCSV(csv: string): ParsedEntry[] {
  const lines = csv.trim().split("\n");
  const entries: ParsedEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",");
    if (parts.length < 5) continue;

    const hasDuration = parts.length >= 6;
    const category = parts[hasDuration ? 5 : 4].trim();
    const startDate = parts[0].trim();
    const startTime = parts[1].trim();
    const endDate = parts[2].trim();
    const endTime = parts[3].trim();

    const startISO = parseDateTime(startDate, startTime);
    const endISO = parseDateTime(endDate, endTime);

    if (!startISO || !endISO) continue;

    const duration_seconds = Math.floor(
      (new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000,
    );

    if (duration_seconds <= 0) continue;

    entries.push({
      id: `parsed-${i}`,
      start_time: startISO,
      end_time: endISO,
      duration_seconds,
      category: category.trim(),
    });
  }

  return entries;
}

function parseDateTime(date: string, time: string): string | null {
  const dateParts = date.trim().split("/");
  if (dateParts.length !== 3) return null;

  const [month, day, year] = dateParts;
  const [hour, minute] = time.trim().split(":");

  const d = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
  );

  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatDisplayDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CSVPage() {
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text);
      setEntries(parsed);
      setErrorCount(0);
      setStatus("idle");
      setMsg(null);
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (entries.length === 0) return;

    setStatus("loading");
    setMsg(null);

    try {
      const response = await fetch("/api/entry/batch-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entries }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Import failed");
      }

      if (result.failed > 0) {
        setStatus("error");
        setMsg(`Imported ${result.success} entries. ${result.failed} failed.`);
      } else {
        setStatus("success");
        setMsg(`Successfully imported ${result.success} entries!`);
        setEntries([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch (err: any) {
      setStatus("error");
      setMsg(err.message);
    }
  }

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-5xl mx-auto space-y-6 text-gray-900 dark:text-gray-100">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Import CSV</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Upload a CSV file with columns: start_date,start_time,end_date,end_time,duration,category
        </p>
      </div>

      <div className="bg-bone dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow">
        <div className="mb-4">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Expected CSV Format
          </h2>
          <div className="bg-gray-100 dark:bg-neutral-800 rounded-lg p-3 text-xs font-mono overflow-x-auto">
            <p className="text-gray-600 dark:text-gray-400 mb-2">
              Columns (in order): start_date, start_time, end_date, end_time, [duration, ]category
            </p>
            <p className="text-gray-500 dark:text-gray-500 mb-2">
              Duration is optional. Date format: MM/DD/YYYY &nbsp;|&nbsp; Time format: HH:MM (24-hour)
            </p>
            <p className="text-gray-600 dark:text-gray-400 mb-2">Example (with duration):</p>
            <pre className="text-gray-800 dark:text-gray-300 whitespace-pre">{`01/15/2024,09:00,01/15/2024,10:30,90,Work
01/16/2024,14:00,01/16/2024,15:30,90,Study`}</pre>
            <p className="text-gray-600 dark:text-gray-400 mb-2 mt-3">Example (without duration):</p>
            <pre className="text-gray-800 dark:text-gray-300 whitespace-pre">{`01/15/2024,09:00,01/15/2024,10:30,Work
01/16/2024,14:00,01/16/2024,15:30,Study`}</pre>
          </div>
        </div>

        <div className="mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            className="block w-full text-sm text-gray-500 dark:text-gray-400
              file:mr-4 file:py-2 file:px-4
              file:rounded-lg file:border-0
              file:text-sm file:font-medium
              file:bg-neutral-800 file:text-white
              dark:file:bg-neutral-100 dark:file:text-neutral-900
              hover:file:opacity-90 cursor-pointer"
          />
        </div>

        {entries.length > 0 && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {entries.length} entries parsed
          </div>
        )}

        {status === "success" && (
          <p className="mb-4 text-sm text-green-600 dark:text-green-400 text-center">
            {msg}
          </p>
        )}

        {status === "error" && (
          <p className="mb-4 text-sm text-red-500 text-center">{msg}</p>
        )}

        {entries.length > 0 && (
          <>
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
                      <td>{formatDisplayDateTime(entry.start_time)}</td>
                      <td>{formatDisplayDateTime(entry.end_time)}</td>
                      <td>{formatDuration(entry.duration_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    <p>Start: {formatDisplayDateTime(entry.start_time)}</p>
                    <p>End: {formatDisplayDateTime(entry.end_time)}</p>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleSubmit}
              disabled={status === "loading"}
              className="mt-4 w-full py-2.5 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {status === "loading" ? "Submitting..." : "Submit"}
            </button>
          </>
        )}

        {entries.length === 0 && status !== "success" && (
          <div className="flex items-center justify-center h-32 rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-700 text-sm text-gray-400 dark:text-gray-500">
            No entries loaded
          </div>
        )}
      </div>
    </main>
  );
}
