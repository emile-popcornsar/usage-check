import { it, expect } from 'vitest';
import { ICON_SIZES, iconLayout, rasterizeIcon } from '../../src/core/iconRaster';

const px = (buf: Uint8Array, size: number, x: number, y: number) => Array.from(buf.slice((y * size + x) * 4, (y * size + x) * 4 + 4));

it('lists the seven Windows icon sizes', () => {
  expect([...ICON_SIZES]).toEqual([16, 24, 32, 48, 64, 128, 256]);
});
it('every size is a square RGBA buffer', () => {
  for (const s of ICON_SIZES) expect(rasterizeIcon(s).length).toBe(s * s * 4);
});
it('16 renders at scale 1 with a transparent corner and the tip colour at the sprite top', () => {
  expect(iconLayout(16)).toEqual({ scale: 1, offsetX: 2, offsetY: 1 });
  const b = rasterizeIcon(16);
  expect(px(b, 16, 0, 0)).toEqual([0, 0, 0, 0]);
  expect(px(b, 16, 15, 15)).toEqual([0, 0, 0, 0]);
  expect(px(b, 16, 8, 1)).toEqual([0xd9, 0x77, 0x57, 255]); // sprite cell (6,0), body colour
});
it('256 renders at scale 18, centred, crisp', () => {
  expect(iconLayout(256)).toEqual({ scale: 18, offsetX: 29, offsetY: 2 });
  const b = rasterizeIcon(256);
  expect(px(b, 256, 0, 0)).toEqual([0, 0, 0, 0]);
  expect(px(b, 256, 29 + 6 * 18, 2)).toEqual([0xd9, 0x77, 0x57, 255]);
  expect(px(b, 256, 29 + 6 * 18 + 17, 2 + 17)).toEqual([0xd9, 0x77, 0x57, 255]);
  expect(px(b, 256, 29 + 6 * 18 + 18, 2)).toEqual([0, 0, 0, 0]); // right of the tip cell: no smoothing
  expect(px(b, 256, 29 + 9 * 18, 2 + 2 * 18)).toEqual([0xe8, 0xa0, 0x88, 255]); // spark at upper right
});
