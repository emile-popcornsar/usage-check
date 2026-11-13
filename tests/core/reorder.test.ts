import { it, expect } from 'vitest';
import { dropIndex, moveById } from '../../src/core/reorder';

// Gaps of a three-card list: 0 above the first card, 1 between the first and second, ..., 3 below the last.
it('turns the gap a card is dropped into into its new index', () => {
  expect(dropIndex(0, 2)).toBe(1); // first card dropped between the second and third
  expect(dropIndex(0, 3)).toBe(2); // first card dropped below the last
  expect(dropIndex(2, 0)).toBe(0); // last card dropped above the first
  expect(dropIndex(2, 1)).toBe(1);
  expect(dropIndex(1, 0)).toBe(0);
  expect(dropIndex(1, 3)).toBe(2);
});
it('moves an item by id to a new index, like the service does', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ids = (l: { id: string }[]) => l.map((x) => x.id);
  expect(ids(moveById(list, 'a', 2))).toEqual(['b', 'c', 'a']);
  expect(ids(moveById(list, 'c', 0))).toEqual(['c', 'a', 'b']);
  expect(ids(moveById(list, 'a', 99))).toEqual(['b', 'c', 'a']);
  expect(ids(moveById(list, 'zz', 0))).toEqual(['a', 'b', 'c']);
  expect(ids(list)).toEqual(['a', 'b', 'c']); // the input is not changed
});
it('a drop on the card\'s own place is no move', () => {
  expect(dropIndex(1, 1)).toBeNull(); // just above itself
  expect(dropIndex(1, 2)).toBeNull(); // just below itself
  expect(dropIndex(0, 0)).toBeNull();
  expect(dropIndex(2, 3)).toBeNull();
});
