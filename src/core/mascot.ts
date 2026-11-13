import type { FlameStage, MascotId, UsageLine } from './types';
import { SPRITES } from './mascotPixels';

export type Sprite = {
  w: number;
  h: number;
  rects: ReadonlyArray<readonly [x: number, y: number, w: number, h: number, color: string]>;
};

export const MASCOT_ORDER: readonly MascotId[] = ['flame', 'jellyfish', 'octopus', 'squid'];

// What each character calls itself; it says this in a speech bubble when it is picked.
export const MASCOT_NAMES: Readonly<Record<MascotId, string>> = { flame: '불불', jellyfish: '둥둥', octopus: '데데', squid: '뾰뾰' };

export function nextMascot(id: MascotId): MascotId {
  return MASCOT_ORDER[(MASCOT_ORDER.indexOf(id) + 1) % MASCOT_ORDER.length];
}

export function flameStageFor(average: number | null): FlameStage {
  if (average === null || average < 50) return 1;
  return average < 90 ? 2 : 3;
}

export function averageWeeklyPercent(accounts: { lines: UsageLine[] }[]): number | null {
  const percents: number[] = [];
  for (const account of accounts) {
    const line = account.lines.find((l) => l.label === 'Current week (all models)');
    if (line) percents.push(line.percent);
  }
  if (percents.length === 0) return null;
  return percents.reduce((sum, p) => sum + p, 0) / percents.length;
}

export function spriteFor(id: MascotId, stage: FlameStage): Sprite {
  if (id === 'flame') return stage === 1 ? SPRITES.flame1 : stage === 2 ? SPRITES.flame2 : SPRITES.flame3;
  return SPRITES[id];
}
