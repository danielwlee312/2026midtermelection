#!/usr/bin/env node
/*
 * Bundle the dashboard into one self-contained HTML file (CSS, scripts and
 * poll data inlined).
 *
 *   node scripts/build-standalone.js [out.html]             full HTML document
 *   node scripts/build-standalone.js --artifact out.html    page body for a claude.ai Artifact
 *
 * The Artifact variant omits <!doctype>/<html>/<head>/<body> (the host adds
 * them). An Artifact may not call Wikipedia, so its Refresh button loads
 * data/polls.json instead: publish that file alongside the page.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCRIPTS = ['js/config.js', 'js/model.js', 'js/wikipedia.js', 'data/polls.js', 'js/app.js'];

function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end);
  if (a < 0 || b < 0) throw new Error('Missing marker ' + start);
  return text.slice(a + start.length, b).trim();
}

function inlineScript(src) {
  return '<script>\n' + src.replace(/<\/(script)/gi, '<\\/$1') + '\n</script>';
}

function main() {
  const args = process.argv.slice(2);
  const artifact = args.includes('--artifact');
  const out = args.filter((a) => a !== '--artifact')[0] || path.join(ROOT, 'dist', artifact ? 'artifact.html' : 'midterm-forecast.html');
  const html = read('index.html');
  const head = between(html, '<!-- head:start -->', '<!-- head:end -->');
  const body = between(html, '<!-- app:start -->', '<!-- app:end -->');
  const css = read('css/dashboard.css');
  const env = { hosted: artifact ? 'artifact' : 'file' };
  const scripts = [inlineScript('window.DASHBOARD_ENV = ' + JSON.stringify(env) + ';')]
    .concat(SCRIPTS.map((p) => inlineScript(read(p))));

  const page = artifact
    ? [head, '<style>\n' + css + '\n</style>', body].concat(scripts).join('\n')
    : ['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      head, '<style>\n' + css + '\n</style>', '</head>', '<body>', body].concat(scripts, ['</body>', '</html>']).join('\n');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page + '\n');
  console.log('Wrote ' + out + ' (' + Math.round(Buffer.byteLength(page) / 1024) + ' KB)');
}

main();
