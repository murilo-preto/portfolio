export const LIGHT_PALETTE = ["#a3b18a", "#9EA479", "#899063", "#354024", "#3A3D29"];

export const DARK_PALETTE = ["#f72585", "#b5179e", "#7209b7", "#560bad", "#480ca8"];

export const DARK_EVENT_COLORS: Record<string, { bg: string; border: string }> = {
  Exercise: { bg: "bg-[#f72585]", border: "border-[#f72585]/60" },
  Reading: { bg: "bg-[#7209b7]", border: "border-[#7209b7]/60" },
  Work: { bg: "bg-[#480ca8]", border: "border-[#480ca8]/60" },
  Study: { bg: "bg-[#4361ee]", border: "border-[#4361ee]/60" },
};

export function getDarkEventColor(category: string): string {
  const color = DARK_EVENT_COLORS[category];
  if (color) return `${color.bg} ${color.border}`;
  return "bg-[#f72585] border-[#f72585]/60";
}
