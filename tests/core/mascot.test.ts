import { describe, it, expect } from 'vitest';
import { MASCOT_ORDER, MASCOT_NAMES, nextMascot, flameStageFor, averageWeeklyPercent, spriteFor } from '../../src/core/mascot';
import { SPRITES } from '../../src/core/mascotPixels';

const all = (percent: number) => ({ label: 'Current week (all models)', percent, resetsText: null });

describe('mascot', () => {
  it('cycles flame, jellyfish, octopus, squid', () => {
    expect(MASCOT_ORDER).toEqual(['flame', 'jellyfish', 'octopus', 'squid']);
    expect(nextMascot('flame')).toBe('jellyfish');
    expect(nextMascot('squid')).toBe('flame');
  });
  it('names every character', () => {
    expect(MASCOT_NAMES).toEqual({ flame: '불불', jellyfish: '둥둥', octopus: '데데', squid: '뾰뾰' });
  });
  it('picks the flame stage at 50 and 90', () => {
    expect([null, 0, 49, 49.9].map(flameStageFor)).toEqual([1, 1, 1, 1]);
    expect([50, 89, 89.9].map(flameStageFor)).toEqual([2, 2, 2]);
    expect([90, 100].map(flameStageFor)).toEqual([3, 3]);
  });
  it('averages the all-models weekly line across accounts', () => {
    expect(averageWeeklyPercent([
      { lines: [all(100), { label: 'Current week (Fable)', percent: 94, resetsText: null }] },
      { lines: [all(12)] },
      { lines: [all(71)] },
    ])).toBe(61);
  });
  it('leaves out accounts with no all-models line', () => {
    expect(averageWeeklyPercent([{ lines: [all(40)] }, { lines: [] }, { lines: [{ label: 'Other', percent: 99, resetsText: null }] }])).toBe(40);
    expect(averageWeeklyPercent([{ lines: [] }])).toBeNull();
    expect(averageWeeklyPercent([])).toBeNull();
  });
  it('only the flame changes with the stage', () => {
    expect(spriteFor('flame', 1)).toBe(SPRITES.flame1);
    expect(spriteFor('flame', 2)).toBe(SPRITES.flame2);
    expect(spriteFor('flame', 3)).toBe(SPRITES.flame3);
    expect(spriteFor('octopus', 3)).toBe(SPRITES.octopus);
  });
  it('every sprite stays inside its grid, and the flames have 1, 2 and 3 tips', () => {
    for (const s of Object.values(SPRITES)) for (const [x, y, w, h] of s.rects) {
      expect(x >= 0 && y >= 0 && x + w <= s.w && y + h <= s.h).toBe(true);
    }
    const runsOnRow3 = (name: 'flame1' | 'flame2' | 'flame3') => {
      const filled = new Set<number>();
      for (const [x, y, w, h] of SPRITES[name].rects) if (y <= 3 && 3 < y + h) for (let i = x; i < x + w; i++) filled.add(i);
      let runs = 0; for (let i = 0; i < 11; i++) if (filled.has(i) && !filled.has(i - 1)) runs++;
      return runs;
    };
    expect([runsOnRow3('flame1'), runsOnRow3('flame2'), runsOnRow3('flame3')]).toEqual([1, 2, 3]);
  });
});
