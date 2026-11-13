// The item `id` moved to `toIndex` (clamped), in a new list; an unknown id gives the list unchanged.
export function moveById<T extends { id: string }>(list: readonly T[], id: string, toIndex: number): T[] {
  const item = list.find((x) => x.id === id);
  if (!item) return [...list];
  const rest = list.filter((x) => x.id !== id);
  rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, item);
  return rest;
}

// A card at index `from` is dropped into gap `gap` (0 = above the first card, n = below the last).
// Returns the card's new index, or null when the gap is right above or below the card itself.
export function dropIndex(from: number, gap: number): number | null {
  if (gap === from || gap === from + 1) return null;
  return gap > from ? gap - 1 : gap;
}
