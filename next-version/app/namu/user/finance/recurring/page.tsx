"use client";

import { useEffect, useState } from "react";
import { RecurringExpense } from "@/components/finance/types";
import { BatchImportModal } from "@/components/BatchImportModal";

// ─── Types ───────────────────────────────────────────────────────────────────

type Status = "idle" | "loading" | "success" | "error";

type Category = {
  id: number;
  name: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

function getFrequencyLabel(freq: string): string {
  const labels: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Bi-weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
  };
  return labels[freq] || freq;
}

function getEstimatedMonthly(amount: number, frequency: string): number {
  const multipliers: Record<string, number> = {
    weekly: 4.33,
    biweekly: 2.17,
    monthly: 1,
    quarterly: 0.33,
    yearly: 0.083,
  };
  return amount * (multipliers[frequency] || 1);
}

// ─── Shared UI Primitives ────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
      {children}
    </label>
  );
}

function StatusMessage({
  status,
  message,
}: {
  status: Status;
  message: string | null;
}) {
  if (!message) return null;
  return (
    <p
      className={`text-sm text-center ${status === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
    >
      {message}
    </p>
  );
}

function inputClass() {
  return "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400";
}

function PanelCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
    >
      ✕
    </button>
  );
}

function CategorySelect({
  value,
  onChange,
  categories,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: Category[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass()}
      required
    >
      <option value="">Select a category</option>
      {categories.map((cat) => (
        <option key={cat.id} value={cat.name}>
          {cat.name}
        </option>
      ))}
    </select>
  );
}

// ─── Panels ──────────────────────────────────────────────────────────────────

function CategoryPanel({
  categories,
  onClose,
}: {
  categories: Category[];
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setStatus("loading");
    setMessage(null);

    try {
      const res = await fetch("/api/finance/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage("Category created successfully!");
        setName("");
        setTimeout(() => {
          setStatus("idle");
          setMessage(null);
          onClose();
        }, 1500);
      } else {
        setStatus("error");
        setMessage(data.error || "Failed to create category");
      }
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Failed to create category");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">
          Create Finance Category
        </h2>
        <PanelCloseButton onClick={onClose} />
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label>Category Name</Label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass()}
            placeholder="e.g., Investments"
          />
        </div>
        <StatusMessage status={status} message={message} />
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full py-2 px-4 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {status === "loading" ? "Creating..." : "Create Category"}
        </button>
      </form>
    </div>
  );
}

function CreateExpensePanel({
  categories,
  onClose,
  onCreated,
}: {
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    amount: "",
    frequency: "monthly",
    start_date: new Date().toISOString().split("T")[0],
    end_date: "",
    next_payment_date: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name || !formData.category || !formData.amount) return;

    setStatus("loading");
    setMessage(null);

    try {
      const res = await fetch("/api/recurring-expenses/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          amount: parseFloat(formData.amount),
          end_date: formData.end_date || undefined,
          next_payment_date: formData.next_payment_date || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage("Recurring expense created successfully!");
        setTimeout(() => {
          setStatus("idle");
          setMessage(null);
          onCreated();
          onClose();
        }, 1500);
      } else {
        setStatus("error");
        setMessage(data.error || "Failed to create recurring expense");
      }
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Failed to create recurring expense");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">
          Create Recurring Expense
        </h2>
        <PanelCloseButton onClick={onClose} />
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label>Expense Name</Label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className={inputClass()}
            placeholder="e.g., Netflix Subscription"
            required
          />
        </div>
        <div>
          <Label>Category</Label>
          <CategorySelect
            value={formData.category}
            onChange={(v) => setFormData({ ...formData, category: v })}
            categories={categories}
          />
        </div>
        <div>
          <Label>Amount</Label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            className={inputClass()}
            placeholder="0.00"
            required
          />
        </div>
        <div>
          <Label>Frequency</Label>
          <select
            value={formData.frequency}
            onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RecurringExpense["frequency"] })}
            className={inputClass()}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <Label>Start Date</Label>
          <input
            type="date"
            value={formData.start_date}
            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
            className={inputClass()}
            required
          />
        </div>
        <div>
          <Label>End Date (Optional)</Label>
          <input
            type="date"
            value={formData.end_date}
            onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
            className={inputClass()}
          />
        </div>
        <div>
          <Label>Next Payment Date (Optional)</Label>
          <input
            type="date"
            value={formData.next_payment_date}
            onChange={(e) => setFormData({ ...formData, next_payment_date: e.target.value })}
            className={inputClass()}
          />
        </div>
        <StatusMessage status={status} message={message} />
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full py-2 px-4 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {status === "loading" ? "Creating..." : "Create Expense"}
        </button>
      </form>
    </div>
  );
}

function EditExpensePanel({
  expense,
  categories,
  onClose,
  onSaved,
  onDeleted,
}: {
  expense: RecurringExpense;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: expense.name,
    category: expense.category,
    amount: expense.amount.toString(),
    frequency: expense.frequency,
    start_date: expense.start_date.split("T")[0],
    end_date: expense.end_date?.split("T")[0] || "",
    next_payment_date: expense.next_payment_date?.split("T")[0] || "",
    is_active: expense.is_active,
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name || !formData.category || !formData.amount) return;

    setStatus("loading");
    setMessage(null);

    try {
      const res = await fetch(`/api/recurring-expenses/${expense.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          amount: parseFloat(formData.amount),
          end_date: formData.end_date || undefined,
          next_payment_date: formData.next_payment_date || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage("Recurring expense updated successfully!");
        setTimeout(() => {
          setStatus("idle");
          setMessage(null);
          onSaved();
          onClose();
        }, 1500);
      } else {
        setStatus("error");
        setMessage(data.error || "Failed to update recurring expense");
      }
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Failed to update recurring expense");
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this recurring expense?")) return;

    setStatus("loading");
    setMessage(null);

    try {
      const res = await fetch("/api/recurring-expenses/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expense_id: expense.id }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage("Recurring expense deleted successfully!");
        setTimeout(() => {
          onDeleted();
        }, 1500);
      } else {
        setStatus("error");
        setMessage(data.error || "Failed to delete recurring expense");
      }
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Failed to delete recurring expense");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">
          Edit Recurring Expense
        </h2>
        <PanelCloseButton onClick={onClose} />
      </div>
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <Label>Expense Name</Label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className={inputClass()}
            required
          />
        </div>
        <div>
          <Label>Category</Label>
          <CategorySelect
            value={formData.category}
            onChange={(v) => setFormData({ ...formData, category: v })}
            categories={categories}
          />
        </div>
        <div>
          <Label>Amount</Label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            className={inputClass()}
            required
          />
        </div>
        <div>
          <Label>Frequency</Label>
          <select
            value={formData.frequency}
            onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RecurringExpense["frequency"] })}
            className={inputClass()}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <Label>Start Date</Label>
          <input
            type="date"
            value={formData.start_date}
            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
            className={inputClass()}
            required
          />
        </div>
        <div>
          <Label>End Date (Optional)</Label>
          <input
            type="date"
            value={formData.end_date}
            onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
            className={inputClass()}
          />
        </div>
        <div>
          <Label>Next Payment Date (Optional)</Label>
          <input
            type="date"
            value={formData.next_payment_date}
            onChange={(e) => setFormData({ ...formData, next_payment_date: e.target.value })}
            className={inputClass()}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_active"
            checked={formData.is_active}
            onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
            className="rounded border-gray-300 dark:border-neutral-600"
          />
          <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">
            Active
          </label>
        </div>
        <StatusMessage status={status} message={message} />
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={status === "loading"}
            className="flex-1 py-2 px-4 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {status === "loading" ? "Saving..." : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={status === "loading"}
            className="flex-1 py-2 px-4 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}

function ExpenseList({
  expenses,
  loading,
  error,
  selectedId,
  onSelect,
}: {
  expenses: RecurringExpense[];
  loading: boolean;
  error: string | null;
  selectedId: number | null;
  onSelect: (expense: RecurringExpense) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-700">
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
        Error: {error}
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-700 text-sm text-gray-400 dark:text-gray-500">
        <p>No recurring expenses found.</p>
        <p className="mt-1 text-xs">Click &quot;+ New Expense&quot; to add one.</p>
      </div>
    );
  }

  const monthlyTotal = expenses
    .filter((e) => e.is_active)
    .reduce((sum, e) => sum + getEstimatedMonthly(e.amount, e.frequency), 0);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-900">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
          Recurring Expenses
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Estimated Monthly: <span className="font-medium">{formatPrice(monthlyTotal)}</span>
        </p>
      </div>
      <ul className="divide-y divide-gray-200 dark:divide-neutral-700 max-h-96 overflow-y-auto">
        {expenses.map((expense) => (
          <li key={expense.id}>
            <button
              onClick={() => onSelect(expense)}
              className={`w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors ${
                selectedId === expense.id ? "bg-gray-50 dark:bg-neutral-700" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {expense.name}
                    </p>
                    {!expense.is_active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-neutral-600 text-gray-600 dark:text-gray-400">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {expense.category}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">
                    {formatPrice(expense.amount)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {getFrequencyLabel(expense.frequency)}
                  </p>
                </div>
              </div>
              {expense.next_payment_date && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Next payment: {formatDate(expense.next_payment_date)}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RecurringExpensesPage() {
  const [expenses, setExpenses] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [expensesRes, catsRes] = await Promise.all([
        fetch("/api/recurring-expenses", { credentials: "include" }),
        fetch("/api/finance/categories"),
      ]);
      if (!expensesRes.ok) throw new Error("Failed to fetch recurring expenses");
      const { expenses: e } = await expensesRes.json();
      setExpenses(e ?? []);
      if (catsRes.ok) {
        const { categories: c } = await catsRes.json();
        setCategories(c ?? []);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  const selectedExpense = expenses.find((e) => e.id === selectedId) ?? null;

  function openExpenseForm() {
    setShowExpenseForm(true);
    setSelectedId(null);
  }

  function closeExpenseForm() {
    setShowExpenseForm(false);
  }

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-5xl mx-auto space-y-6 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Recurring Expenses</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your recurring subscriptions and bills.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            Import CSV
          </button>
          <a
            href="/namu/user/finance"
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            Dashboard
          </a>
          <a
            href="/namu/user/finance/manage"
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            Finance Entries
          </a>
          <button
            onClick={() => (showExpenseForm ? closeExpenseForm() : openExpenseForm())}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            {showExpenseForm ? "✕ Close" : "+ New Expense"}
          </button>
          <button
            onClick={() => setShowCatForm((v) => !v)}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            {showCatForm ? "✕ Close" : "+ New Category"}
          </button>
        </div>
      </div>

      {/* Category Panel */}
      {showCatForm && (
        <CategoryPanel
          categories={categories}
          onClose={() => setShowCatForm(false)}
        />
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExpenseList
          expenses={expenses}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={(expense) => {
            setSelectedId(expense.id);
            setShowExpenseForm(false);
          }}
        />

        <div>
          {showExpenseForm ? (
            <CreateExpensePanel
              categories={categories}
              onClose={closeExpenseForm}
              onCreated={fetchAll}
            />
          ) : selectedExpense ? (
            <EditExpensePanel
              key={selectedExpense.id}
              expense={selectedExpense}
              categories={categories}
              onClose={() => setSelectedId(null)}
              onSaved={fetchAll}
              onDeleted={() => {
                setSelectedId(null);
                fetchAll();
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-48 rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-700 text-sm text-gray-400 dark:text-gray-500">
              Select an expense to edit
            </div>
          )}
        </div>
      </div>

      <BatchImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        importType="recurring"
        onImportSuccess={fetchAll}
      />
    </main>
  );
}
