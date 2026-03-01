export const LIGHT_PALETTE = [
  "#a3b18a",
  "#9EA479",
  "#899063",
  "#354024",
  "#3A3D29",
];

export const DARK_PALETTE = [
  "#f72585",
  "#b5179e",
  "#7209b7",
  "#560bad",
  "#480ca8",
  "#3a0ca8",
  "#4361ee",
  "#4cc9f0",
];

export const DARK_COLOR_CLASSES = [
  "bg-[#f72585] border-[#f72585]/60",
  "bg-[#b5179e] border-[#b5179e]/60",
  "bg-[#7209b7] border-[#7209b7]/60",
  "bg-[#560bad] border-[#560bad]/60",
  "bg-[#480ca8] border-[#480ca8]/60",
  "bg-[#3a0ca8] border-[#3a0ca8]/60",
  "bg-[#4361ee] border-[#4361ee]/60",
  "bg-[#4cc9f0] border-[#4cc9f0]/60",
];

let nextIndex = 0;
const colorCache = new Map<string, string>();

export function getDarkEventColor(category: string): string {
  if (colorCache.has(category)) {
    return colorCache.get(category)!;
  }

  const colorClass = DARK_COLOR_CLASSES[nextIndex % DARK_COLOR_CLASSES.length];
  colorCache.set(category, colorClass);
  nextIndex++;
  return colorClass;
}
