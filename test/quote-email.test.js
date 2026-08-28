const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('registered quote email is delivered by ProfitQuote and logged after acceptance', () => {
  const route = fs.readFileSync(path.join(root, 'routes', 'quotes.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8');
  assert.match(route, /CUSTOMER_EMAIL_FROM = 'hello@profitquote\.co\.uk'/);
  assert.match(route, /router\.post\('\/send-email', auth/);
  assert.match(route, /recent\.rows\[0\]\.c >= 10/);
  assert.ok(route.indexOf('await sendCustomerQuoteEmail') < route.indexOf("INSERT INTO events(event_type,user_id,source,meta) VALUES('quote_sent'"));
  assert.match(dashboard, /fetch\(API\+'\/api\/quotes\/send-email'/);
  assert.doesNotMatch(dashboard.match(/async function emailQuote\(\)[\s\S]*?\n}\n\nfunction printQuote/)?.[0] || '', /mailto:/);
});
