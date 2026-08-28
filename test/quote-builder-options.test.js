const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('protected pricing applies real costs, target margin and VAT correctly', () => {
  const dashboard = fs.readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8');
  const match = dashboard.match(/function calculateProtectedPrice\([\s\S]*?\n}\n\nfunction calcHealthScore/);
  assert.ok(match, 'pricing function should exist');
  const fnSource = match[0].replace(/\n\nfunction calcHealthScore$/, '');
  const calculate = vm.runInNewContext(`(${fnSource})`);
  const result = calculate({ days:5, dayRate:200, overheadPerDay:50, materials:500, markup:20, skipCost:250, scaffoldCost:0, contingency:10, profitTarget:30, vatRate:20 });
  assert.equal(result.knownCost, 2000);
  assert.equal(result.protectedCost, 2200);
  assert.ok(Math.abs(result.subtotalExVat - 3142.857142857143) < 0.001);
  assert.equal(result.profitPct, 30);
  assert.ok(Math.abs(result.total - 3771.4285714285716) < 0.001);
  assert.ok(Math.abs(result.labour + result.mats + result.skipPrice + result.scaffoldPrice + result.contingencyPrice - result.subtotalExVat) < 0.001);
});

test('business setup persists the costing inputs used by quotes', () => {
  const dashboard = fs.readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'routes', 'settings.js'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'routes', 'auth.js'), 'utf8');
  assert.match(dashboard, /id="setup-overhead"/);
  assert.match(dashboard, /id="setup-vat-rate"/);
  assert.match(settings, /overhead_per_day=\$3/);
  assert.match(settings, /vat_rate=\$6/);
  assert.match(settings, /business_name=\$7/);
  assert.match(auth, /overhead_per_day/);
  assert.match(auth, /vat_rate/);
});
