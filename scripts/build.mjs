import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const ext = 'apps/extension';
const out = `${ext}/dist`;

async function bundle() {
  await build({
    entryPoints: {
      sw: `${ext}/src/background/sw.ts`,
      panel: `${ext}/src/panel/panel.ts`,
    },
    outdir: out,
    bundle: true,
    format: 'esm',
    target: 'chrome120',
    tsconfig: `${ext}/tsconfig.json`,
  });
}

async function copyStatic() {
  await cp(`${ext}/manifest.json`, `${out}/manifest.json`);
  await cp(`${ext}/src/panel/panel.html`, `${out}/panel.html`);
  await cp(`${ext}/src/panel/panel.css`, `${out}/panel.css`);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await bundle();
await copyStatic();
