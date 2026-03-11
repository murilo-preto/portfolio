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
  const selectedCategory = categories.find((c) => c.id === selectedId);

  return (
    <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
        Category
      </label>

      {loading && (
        <p className="text-sm text-gray-400 py-3">Loading categories...</p>
      )}

      {error && (
        <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {!loading && !error && (
        <div className="space-y-3">
          {/* Dropdown */}
          <select
            value={selectedId ?? ""}
            onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-neutral-600 
                       bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 
                       text-base focus:outline-none focus:ring-2 focus:ring-green-500
                       transition-shadow"
          >
            <option value="">— Select a category —</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          {/* Selected Category Badge */}
          {selectedCategory && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span className="text-sm font-medium text-green-700 dark:text-green-300">
                {selectedCategory.name}
              </span>
            </div>
          )}

          {/* Empty State */}
          {!selectedCategory && categories.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">
              No categories available. Create one to start tracking.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
