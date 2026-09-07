/* Bundles the game into one self-contained HTML file — the form an Artifact
   (or an email attachment, or a USB stick) needs. Source stays split.

   Usage: node reroute/tools/bundle.js [outfile]
   Default outfile: reroute/reroute.html */

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/)[0];

const out = [
  '<title>Reroute</title>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  fonts,
  '<style>',
  read('style.css').trim(),
  '</style>',
  '',
  body.replace(/\n?<script src="[^"]*"><\/script>/g, ''),
  '',
  '<script>',
  read('engine.js').trim(),
  '</script>',
  '<script>',
  read('ui.js').trim(),
  '</script>',
  '',
].join('\n');

const target = process.argv[2] || path.join(dir, 'reroute.html');
fs.writeFileSync(target, out);
console.log('wrote ' + target + ' — ' + Math.round(out.length / 1024) + 'KB');
