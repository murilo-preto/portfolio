"use client";

type Category = {
  id: number;
  name: string;
};

type CategorySelectorProps = {
  categories: Category[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  loading?: boolean;
  error?: string | null;
};

export function CategorySelector({
  categories,
  selectedId,
  onSelect,
  loading = false,
  error = null,
}: CategorySelectorProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Category
      </label>

      {loading && (
        <p className="text-sm text-gray-400 py-2">Loading categories...</p>
      )}

      {error && (
        <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {!loading && !error && (
        <select
          value={selectedId ?? ""}
          onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}
          className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-neutral-600
                     bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100
                     text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="">— Select a category —</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
