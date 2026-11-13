import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';

const node = { platform: 'node', format: 'cjs', external: ['electron'], bundle: true };

await build({ ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' });
await build({ ...node, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js' });
await build({
  entryPoints: ['src/renderer/renderer.ts'],
  outfile: 'dist/renderer/renderer.js',
  platform: 'browser',
  format: 'iife',
  bundle: true,
});

mkdirSync('dist/renderer', { recursive: true });
copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
copyFileSync('src/renderer/styles.css', 'dist/renderer/styles.css');

// Icon files are generated from the stage-1 flame sprite so they are never stale.
const iconSrc = await build({
  entryPoints: ['scripts/icon.ts'], bundle: true, write: false, platform: 'node', format: 'esm', outfile: 'icon.mjs',
});
const { generateIcons } = await import('data:text/javascript;base64,' + Buffer.from(iconSrc.outputFiles[0].text).toString('base64'));
const icons = generateIcons();
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.ico', icons.ico);
writeFileSync('dist/icon.png', icons.png);
