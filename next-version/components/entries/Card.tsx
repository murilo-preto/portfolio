type CardProps = {
  title: string;
  value: string | number;
};

export function Card({ title, value }: CardProps) {
  return (
    <div className="bg-bone dark:bg-neutral-900 p-6 rounded-xl shadow text-black dark:text-white">
      <p className="text-sm opacity-70">{title}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}
