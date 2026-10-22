import { build } from 'esbuild';
import { cp, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await rm('dist', { recursive: true, force: true });
await cp('static', 'dist', { recursive: true });
await cp('icons', 'dist/icons', { recursive: true });

const common = { bundle: true, target: 'chrome114', sourcemap: true, logLevel: 'info' };
const entries = [
  { entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'esm' },
  { entryPoints: ['src/content/main.ts'], outfile: 'dist/content.js', format: 'iife' },
  { entryPoints: ['src/sidepanel/main.ts'], outfile: 'dist/sidepanel.js', format: 'iife' },
  { entryPoints: ['src/options/main.ts'], outfile: 'dist/options.js', format: 'iife' },
  { entryPoints: ['src/wordbook/main.ts'], outfile: 'dist/wordbook.js', format: 'iife' },
];

for (const entry of entries) {
  const options = { ...common, ...entry };
  if (watch) await (await import('esbuild')).context(options).then((c) => c.watch());
  else await build(options);
}
