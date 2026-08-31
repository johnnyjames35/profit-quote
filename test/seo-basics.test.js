const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('homepage has one canonical commercial search identity', () => {
  const html = read('public/index.html');
  assert.match(html, /<title>Quoting Software for UK Tradespeople \| ProfitQuote<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/profitquote\.co\.uk\/">/);
  assert.match(html, /Quoting software for UK tradespeople/);
  assert.match(html, /SoftwareApplication/);
});

test('private application screens explicitly prevent indexing', () => {
  assert.match(read('public/admin.html'), /name="robots" content="noindex, nofollow"/);
  assert.match(read('public/dashboard.html'), /name="robots" content="noindex, nofollow"/);
  assert.match(read('server.js'), /X-Robots-Tag', 'noindex, nofollow'/);
});

test('duplicate homepage URLs permanently redirect to the canonical host', () => {
  const server = read('server.js');
  assert.match(server, /www\.profitquote\.co\.uk/);
  assert.match(server, /res\.redirect\(301, `https:\/\/profitquote\.co\.uk/);
  assert.match(server, /req\.path\.toLowerCase\(\) === '\/index\.html'/);
});

test('transparent company and author page is included in the sitemap', () => {
  const about = read('public/about.html');
  assert.match(about, /Big Bulldog UK Ltd/);
  assert.match(about, /John James/);
  assert.match(read('public/sitemap.xml'), /https:\/\/profitquote\.co\.uk\/about\.html/);
});

test('the demonstrated turnover versus profit opportunity answers its query directly', () => {
  const html = read('public/turnover-vs-profit-explained.html');
  assert.match(html, /<title>Turnover vs Profit: What’s the Difference\? \| ProfitQuote<\/title>/);
  assert.match(html, /<h1 class="article-h1">Turnover vs Profit: What’s the Difference\?<\/h1>/);
  assert.match(html, /Profit = turnover − business costs/);
  assert.match(html, /"dateModified": "2026-08-31"/);
});
