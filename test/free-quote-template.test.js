const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('free quote template calculates multiple skips and records customer-supplied items', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'how-to-write-a-professional-quote.html'), 'utf8');
  assert.match(page, /<input[^>]*id="f_skip_quantity"[^>]*>/);
  assert.match(page.match(/<input[^>]*id="f_skip_quantity"[^>]*>/)?.[0] || '', /min="1"/);
  assert.match(page.match(/<input[^>]*id="f_skip_quantity"[^>]*>/)?.[0] || '', /max="20"/);
  assert.match(page, /const waste = skipQuantity \* skipUnitCost/);
  assert.match(page, /id="clientSupplyYes"/);
  assert.match(page, /Customer to supply:/);
  assert.match(page, /These items are not included in the quotation total/);
});

test('free quote template inline application script remains valid JavaScript', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'how-to-write-a-professional-quote.html'), 'utf8');
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/type="application\/ld\+json"/i.test(match[0]))
    .map((match) => match[1])
    .filter((source) => source.trim());
  scripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
});
