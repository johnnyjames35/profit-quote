const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('quote builder supports multiple skips and client-supplied materials', () => {
  const dashboard = fs.readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'routes', 'quotes.js'), 'utf8');

  assert.match(dashboard, /id="q-skip-quantity"[^>]*min="1"[^>]*max="20"/);
  assert.match(dashboard, /const skipCost=skipQuantity\*skipUnitCost/);
  assert.match(dashboard, /id="client-materials-yes"/);
  assert.match(dashboard, /id="q-client-materials"[^>]*maxlength="300"/);
  assert.match(dashboard, /These items are not included in the quotation total/);
  assert.match(route, /quoteData\.clientSuppliesMaterials/);
  assert.match(route, /These items are not included in the quotation total/);
});
