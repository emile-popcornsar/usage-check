import { SPRITES } from './mascotPixels';

export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

const sprite = SPRITES.flame1;

/** Largest whole-number scale that fits the sprite in a square canvas, and the offsets that centre it. */
export function iconLayout(size: number): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.max(1, Math.floor(Math.min(size / sprite.w, size / sprite.h)));
  return { scale, offsetX: Math.floor((size - sprite.w * scale) / 2), offsetY: Math.floor((size - sprite.h * scale) / 2) };
}

/** Square RGBA bytes (row-major, transparent background) of the stage-1 flame, nearest-neighbour scaled. */
export function rasterizeIcon(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const { scale, offsetX, offsetY } = iconLayout(size);
  for (const [x, y, w, h, color] of sprite.rects) {
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    for (let py = offsetY + y * scale; py < offsetY + (y + h) * scale; py++) {
      for (let px = offsetX + x * scale; px < offsetX + (x + w) * scale; px++) {
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        out.set([r, g, b, 255], (py * size + px) * 4);
      }
    }
  }
  return out;
}
