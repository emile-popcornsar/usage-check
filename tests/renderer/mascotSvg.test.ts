import { it, expect } from 'vitest';
import { spriteToSvg } from '../../src/renderer/mascotSvg';
import { SPRITES } from '../../src/core/mascotPixels';

it('draws every rect at the given cell size', () => {
  const svg = spriteToSvg(SPRITES.octopus, 3, null);
  expect(svg).toContain('width="39" height="36" viewBox="0 0 13 12"');
  expect(svg).toContain('aria-hidden="true"');
  expect(svg.match(/<rect /g)).toHaveLength(SPRITES.octopus.rects.length);
});
it('labels the sprite when asked', () => {
  expect(spriteToSvg(SPRITES.flame1, 9, '불씨')).toContain('role="img" aria-label="불씨"');
});
