import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const ext = 'apps/extension';
const out = `${ext}/dist`;
const server = 'apps/server';

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
  await build({
    entryPoints: { content: `${ext}/src/content/capture.ts` },
    outdir: out,
    bundle: true,
    format: 'iife',
    // Stylesheets go into the inline cards' shadow root as text: no web_accessible_resources for X to probe.
    loader: { '.css': 'text' },
    target: 'chrome120',
    tsconfig: `${ext}/tsconfig.json`,
  });
}

async function bundleServer() {
  await build({
    entryPoints: { server: `${server}/src/main.ts` },
    outdir: `${server}/dist`,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: `${server}/tsconfig.json`,
  });
  await cp(`${server}/assets`, `${server}/dist/assets`, { recursive: true });
}

async function copyStatic() {
  await cp(`${ext}/manifest.json`, `${out}/manifest.json`);
  await cp(`${ext}/src/panel/panel.html`, `${out}/panel.html`);
  await cp(`${ext}/src/panel/panel.css`, `${out}/panel.css`);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await bundle();
await rm(`${server}/dist`, { recursive: true, force: true });
await bundleServer();
await copyStatic();
