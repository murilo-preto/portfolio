type EmptyStateProps = {
  message: string;
  /** Matches the height of the chart it replaces so the layout doesn't jump. */
  height?: number;
};

export function EmptyState({ message, height }: EmptyStateProps) {
  return (
    <div
      className="flex items-center justify-center text-sm text-muted"
      style={height ? { height } : undefined}
    >
      {message}
    </div>
  );
}
