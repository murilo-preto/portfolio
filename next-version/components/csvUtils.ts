// CSV parsing and formatting utilities for batch import/export

// ─── Time Entry Types ──────────────────────────────────────────────────────────

export type TimeEntryCSV = {
  category: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
};

export type TimeEntryAPI = {
  category: string;
  start_time: string; // ISO format
  end_time: string; // ISO format
};

// ─── Finance Entry Types ───────────────────────────────────────────────────────

export type FinanceEntryCSV = {
  category: string;
  product_name: string;
  price: string;
  purchase_date: string;
  status: string;
};

export type FinanceEntryAPI = {
  category: string;
  product_name: string;
  price: number;
  purchase_date: string; // ISO format
  status: "planned" | "done";
};

// ─── Recurring Expense Types ───────────────────────────────────────────────────

export type RecurringExpenseCSV = {
  category: string;
  name: string;
  amount: string;
  frequency: string;
  start_date: string;
  end_date: string;
  next_payment_date: string;
  is_active: string;
};

export type RecurringExpenseAPI = {
  category: string;
  name: string;
  amount: number;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  start_date: string;
  end_date?: string;
  next_payment_date?: string;
  is_active: boolean;
};

// ─── CSV Parsing Helpers ───────────────────────────────────────────────────────

export function parseCSV(csv: string): string[][] {
  const lines = csv.trim().split("\n");
  const rows: string[][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    // Simple CSV parsing (doesn't handle quoted commas)
    const parts = line.split(",").map((p) => p.trim());
    rows.push(parts);
  }

  return rows;
}

export function skipHeader(rows: string[][]): string[][] {
  if (rows.length === 0) return [];
  // Check if first row looks like a header
  const firstRow = rows[0].join(",").toLowerCase();
  if (
    firstRow.includes("category") ||
    firstRow.includes("name") ||
    firstRow.includes("date") ||
    firstRow.includes("amount") ||
    firstRow.includes("price")
  ) {
    return rows.slice(1);
  }
  return rows;
}

// ─── Time Entry CSV Parsing ────────────────────────────────────────────────────

export function parseTimeEntriesCSV(csv: string): { entries: TimeEntryAPI[]; errors: string[] } {
  const rows = parseCSV(csv);
  const dataRows = skipHeader(rows);
  const entries: TimeEntryAPI[] = [];
  const errors: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const lineNum = i + 2; // Account for header and 0-index

    try {
      if (row.length < 5) {
        errors.push(`Line ${lineNum}: Not enough columns (expected 5)`);
        continue;
      }

      const [start_date, start_time, end_date, end_time, category] = row;

      if (!category || !start_date || !start_time || !end_date || !end_time) {
        errors.push(`Line ${lineNum}: Missing required fields`);
        continue;
      }

      const startISO = parseDateTime(start_date, start_time);
      const endISO = parseDateTime(end_date, end_time);

      if (!startISO || !endISO) {
        errors.push(`Line ${lineNum}: Invalid date/time format`);
        continue;
      }

      const start = new Date(startISO);
      const end = new Date(endISO);

      if (end <= start) {
        errors.push(`Line ${lineNum}: End time must be after start time`);
        continue;
      }

      entries.push({
        category: category.trim(),
        start_time: startISO,
        end_time: endISO,
      });
    } catch (err) {
      errors.push(`Line ${lineNum}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return { entries, errors };
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

// ─── Finance Entry CSV Parsing ─────────────────────────────────────────────────

export function parseFinanceEntriesCSV(csv: string): { entries: FinanceEntryAPI[]; errors: string[] } {
  const rows = parseCSV(csv);
  const dataRows = skipHeader(rows);
  const entries: FinanceEntryAPI[] = [];
  const errors: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const lineNum = i + 2;

    try {
      if (row.length < 5) {
        errors.push(`Line ${lineNum}: Not enough columns (expected 5: category, product_name, price, purchase_date, status)`);
        continue;
      }

      const [category, product_name, price, purchase_date, status] = row;

      if (!category || !product_name || !price || !purchase_date) {
        errors.push(`Line ${lineNum}: Missing required fields`);
        continue;
      }

      const priceValue = parseFloat(price);
      if (isNaN(priceValue) || priceValue < 0) {
        errors.push(`Line ${lineNum}: Invalid price (must be non-negative number)`);
        continue;
      }

      const statusValue = (status || "planned").toLowerCase().trim();
      if (statusValue !== "planned" && statusValue !== "done") {
        errors.push(`Line ${lineNum}: Invalid status (must be 'planned' or 'done')`);
        continue;
      }

      // Parse purchase_date - support both YYYY-MM-DD HH:MM:SS and YYYY-MM-DD formats
      let purchaseDateISO: string;
      if (purchase_date.includes(" ")) {
        purchaseDateISO = new Date(purchase_date.replace(" ", "T")).toISOString();
      } else {
        purchaseDateISO = new Date(purchase_date).toISOString();
      }

      if (isNaN(new Date(purchaseDateISO).getTime())) {
        errors.push(`Line ${lineNum}: Invalid date format`);
        continue;
      }

      entries.push({
        category: category.trim(),
        product_name: product_name.trim(),
        price: priceValue,
        purchase_date: purchaseDateISO,
        status: statusValue as "planned" | "done",
      });
    } catch (err) {
      errors.push(`Line ${lineNum}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return { entries, errors };
}

// ─── Recurring Expense CSV Parsing ─────────────────────────────────────────────

export function parseRecurringExpensesCSV(csv: string): { expenses: RecurringExpenseAPI[]; errors: string[] } {
  const rows = parseCSV(csv);
  const dataRows = skipHeader(rows);
  const expenses: RecurringExpenseAPI[] = [];
  const errors: string[] = [];

  const validFrequencies = ["weekly", "biweekly", "monthly", "quarterly", "yearly"];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const lineNum = i + 2;

    try {
      if (row.length < 5) {
        errors.push(`Line ${lineNum}: Not enough columns (expected at least 5: category, name, amount, frequency, start_date)`);
        continue;
      }

      const [category, name, amount, frequency, start_date, end_date, next_payment_date, is_active] = row;

      if (!category || !name || !amount || !frequency || !start_date) {
        errors.push(`Line ${lineNum}: Missing required fields`);
        continue;
      }

      const amountValue = parseFloat(amount);
      if (isNaN(amountValue) || amountValue < 0) {
        errors.push(`Line ${lineNum}: Invalid amount (must be non-negative number)`);
        continue;
      }

      const frequencyValue = frequency.toLowerCase().trim();
      if (!validFrequencies.includes(frequencyValue)) {
        errors.push(`Line ${lineNum}: Invalid frequency (must be one of: ${validFrequencies.join(", ")})`);
        continue;
      }

      // Parse dates (YYYY-MM-DD format)
      const startDateObj = new Date(start_date);
      if (isNaN(startDateObj.getTime())) {
        errors.push(`Line ${lineNum}: Invalid start_date format (use YYYY-MM-DD)`);
        continue;
      }

      let endDateValue: string | undefined;
      if (end_date && end_date.trim()) {
        const endDateObj = new Date(end_date);
        if (isNaN(endDateObj.getTime())) {
          errors.push(`Line ${lineNum}: Invalid end_date format (use YYYY-MM-DD)`);
          continue;
        }
        if (endDateObj < startDateObj) {
          errors.push(`Line ${lineNum}: end_date must be after start_date`);
          continue;
        }
        endDateValue = end_date.trim();
      }

      let nextPaymentDateValue: string | undefined;
      if (next_payment_date && next_payment_date.trim()) {
        const nextPaymentDateObj = new Date(next_payment_date);
        if (isNaN(nextPaymentDateObj.getTime())) {
          errors.push(`Line ${lineNum}: Invalid next_payment_date format (use YYYY-MM-DD)`);
          continue;
        }
        nextPaymentDateValue = next_payment_date.trim();
      }

      const isActiveValue = is_active ? is_active.toLowerCase().trim() === "true" : true;

      expenses.push({
        category: category.trim(),
        name: name.trim(),
        amount: amountValue,
        frequency: frequencyValue as RecurringExpenseAPI["frequency"],
        start_date: start_date.trim(),
        end_date: endDateValue,
        next_payment_date: nextPaymentDateValue,
        is_active: isActiveValue,
      });
    } catch (err) {
      errors.push(`Line ${lineNum}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return { expenses, errors };
}

// ─── CSV Export Helpers ────────────────────────────────────────────────────────

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function formatTimeEntriesCSV(entries: TimeEntryAPI[]): string {
  const header = "category,start_date,start_time,end_date,end_time";
  const rows = entries.map((entry) => {
    const start = new Date(entry.start_time);
    const end = new Date(entry.end_time);
    const startDate = `${start.getMonth() + 1}/${start.getDate()}/${start.getFullYear()}`;
    const startTime = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
    const endDate = `${end.getMonth() + 1}/${end.getDate()}/${end.getFullYear()}`;
    const endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
    return `${entry.category},${startDate},${startTime},${endDate},${endTime}`;
  });
  return [header, ...rows].join("\n");
}

export function formatFinanceEntriesCSV(entries: FinanceEntryAPI[]): string {
  const header = "category,product_name,price,purchase_date,status";
  const rows = entries.map((entry) => {
    const date = new Date(entry.purchase_date);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
    return `${entry.category},${entry.product_name},${entry.price},${dateStr},${entry.status}`;
  });
  return [header, ...rows].join("\n");
}

export function formatRecurringExpensesCSV(expenses: RecurringExpenseAPI[]): string {
  const header = "category,name,amount,frequency,start_date,end_date,next_payment_date,is_active";
  const rows = expenses.map((expense) => {
    return `${expense.category},${expense.name},${expense.amount},${expense.frequency},${expense.start_date},${expense.end_date || ""},${expense.next_payment_date || ""},${expense.is_active}`;
  });
  return [header, ...rows].join("\n");
}

// ─── Template Generators ───────────────────────────────────────────────────────

export function getTimeEntriesTemplate(): string {
  return `category,start_date,start_time,end_date,end_time
Work,01/15/2024,09:00,01/15/2024,10:30
Study,01/16/2024,14:00,01/16/2024,15:30
Exercise,01/17/2024,07:00,01/17/2024,08:00`;
}

export function getFinanceEntriesTemplate(): string {
  return `category,product_name,price,purchase_date,status
Food,Groceries,85.50,2024-01-15 10:30:00,done
Entertainment,Netflix,15.99,2024-01-16 00:00:00,planned
Utilities,Electric Bill,120.00,2024-01-17 09:00:00,done
Transportation,Gas,45.00,2024-01-18 14:30:00,done`;
}

export function getRecurringExpensesTemplate(): string {
  return `category,name,amount,frequency,start_date,end_date,next_payment_date,is_active
Subscriptions,Netflix,15.99,monthly,2024-01-01,,2024-02-01,true
Utilities,Electric,120.00,monthly,2024-01-01,2024-12-31,,true
Insurance,Health,350.00,monthly,2024-01-01,,,true
Gym,Membership,50.00,monthly,2024-01-01,,,true`;
}
