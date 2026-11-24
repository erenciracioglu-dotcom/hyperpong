// Bundles src/ into the single self-contained index.html at the repo root (three.js inlined).
import * as esbuild from 'esbuild';
import fs from 'fs';

const result = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/index.template.html', 'utf8');
const html = tpl.replace('<!--APP_SCRIPT-->', () => `<script>${js}</script>`);

fs.writeFileSync('index.html', html);
console.log(`index.html  ${(html.length / 1024).toFixed(0)} KB`);
