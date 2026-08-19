const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

test('admin dashboard exposes traffic reporting only through its reporting tab', () => {
  assert.match(adminHtml, /id="tab-reporting-btn"/);
  assert.match(adminHtml, /id="view-reporting"/);
  assert.match(adminHtml, /if \(tab === 'reporting' && !window\.reportingLoaded\) loadReporting\(\)/);
  assert.match(adminHtml, /fetch\(API \+ '\/api\/admin\/reporting\/daily'/);
  assert.match(adminHtml, /'Authorization': 'Bearer ' \+ adminToken/);
});

test('traffic reporting renders daily detail and both comparison periods', () => {
  assert.match(adminHtml, /comparisons\.sevenDay/);
  assert.match(adminHtml, /comparisons\.thirtyDay/);
  assert.match(adminHtml, /ga4\.landingPages/);
  assert.match(adminHtml, /search\.topQueries/);
  assert.match(adminHtml, /search\.topPages/);
  assert.match(adminHtml, /Top Google Search Queries \(30 days\)/);
  assert.match(adminHtml, /number\(item\.impressions\).*percent\(item\.ctr\).*decimal\(item\.averagePosition\)/);
  assert.match(adminHtml, /\.report-list li \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
});

test('inline admin scripts remain valid JavaScript', () => {
  const scripts = [...adminHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter(Boolean);
  assert.ok(scripts.length > 0);
  scripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
});
