const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isFreeOnboardingOfferActive } = require('../utils/onboarding-offer');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('free onboarding offer runs through the end of September 2026', () => {
  assert.equal(isFreeOnboardingOfferActive(new Date('2026-09-30T23:59:59+01:00')), true);
  assert.equal(isFreeOnboardingOfferActive(new Date('2026-10-01T00:00:00+01:00')), false);
});

test('website and lifecycle messages describe the same onboarding offer', () => {
  assert.match(read('public/index.html'), /Personal setup included free until 30 September 2026\. £99 thereafter\./);
  assert.match(read('routes/auth.js'), /Personal setup included free until 30 September 2026/);
  assert.match(read('server.js'), /Subscribe by 30 September 2026/);
});
