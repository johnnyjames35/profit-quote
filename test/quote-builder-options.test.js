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

test('quote builder offers a guided ADHD-friendly scope flow', () => {
  const dashboard = fs.readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8');
  assert.match(dashboard, /id="q-job-type"/);
  assert.match(dashboard, /id="scope-task-list"/);
  assert.match(dashboard, /Anything else we should know/);
  assert.match(dashboard, /const JOB_SCOPE_OPTIONS=/);
  assert.match(dashboard, /scopeTasks:\[\.\.\.selectedScopeTasks\]/);
  assert.match(dashboard, /readonly><\/textarea>/);
});
