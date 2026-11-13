import { it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { encodePng, generateIcons } from '../../scripts/icon';
import { ICON_SIZES, rasterizeIcon } from '../../src/core/iconRaster';

it('PNG starts with the signature and inflates back to the RGBA rows', () => {
  const rgba = rasterizeIcon(16);
  const png = encodePng(16, rgba);
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = png.indexOf('IDAT');
  const len = png.readUInt32BE(idat - 4);
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + len));
  expect(raw.length).toBe(16 * (1 + 16 * 4));
  expect(Array.from(raw.subarray(1, 5))).toEqual([0, 0, 0, 0]);
});
it('ICO has a valid header listing the seven sizes', () => {
  const { ico } = generateIcons();
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(7);
  const sizes = [0, 1, 2, 3, 4, 5, 6].map((i) => ico.readUInt8(6 + i * 16) || 256);
  expect(sizes).toEqual([...ICON_SIZES]);
  const last = 6 + 6 * 16;
  const off = ico.readUInt32LE(last + 12), len = ico.readUInt32LE(last + 8);
  expect(off + len).toBe(ico.length);
  expect(Array.from(ico.subarray(off, off + 4))).toEqual([137, 80, 78, 71]);
});
