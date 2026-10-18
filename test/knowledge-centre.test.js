const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { canonicalForPost, knowledgeCentre } = require('../routes/knowledge-centre');
const base = 'https://profitquote.co.uk/knowledge-centre.html';

test('article and index canonicals are distinct in server-rendered HTML', async () => {
  for (const [post, expected] of [[undefined, base], ['quote-rejection-reasons', base + '?post=quote-rejection-reasons']]) {
    const html = await new Promise((resolve, reject) => knowledgeCentre({query:{post,utm_source:'test'}}, {type(type){assert.equal(type,'html');return this;},send:resolve}, reject));
    const canonicals = html.match(/<link rel="canonical"[^>]*>/g);
    assert.deepEqual(canonicals, [`<link rel="canonical" href="${expected}">`]);
  }
});

test('malformed or repeated post parameters cannot enter canonical HTML', () => {
  for (const post of ['', ['one','two'], {value:'one'}, '"><script>', '../one', 'one&two', 'a'.repeat(201)]) {
    assert.equal(canonicalForPost(post), base);
  }
});

test('canonical route precedes static file serving', () => {
  const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  assert.ok(server.indexOf("app.get('/knowledge-centre.html'") < server.indexOf('app.use(express.static'));
});
