import type { Sprite } from '../core/mascot';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Inline SVG in an HTML document needs no namespace attribute.
export function spriteToSvg(sprite: Sprite, cell: number, label: string | null): string {
  const a11y = label === null ? 'aria-hidden="true"' : `role="img" aria-label="${attr(label)}"`;
  const rects = sprite.rects
    .map(([x, y, w, h, color]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"></rect>`)
    .join('');
  return `<svg ${a11y} width="${sprite.w * cell}" height="${sprite.h * cell}" viewBox="0 0 ${sprite.w} ${sprite.h}" shape-rendering="crispEdges">${rects}</svg>`;
}
