const fs = require('node:fs');
const path = require('node:path');

const INDEX_URL = 'https://profitquote.co.uk/knowledge-centre.html';

function canonicalForPost(post) {
  // Only a single Soro slug belongs in the canonical; discard tracking parameters.
  return typeof post === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post) && post.length <= 200
    ? `${INDEX_URL}?post=${encodeURIComponent(post)}`
    : INDEX_URL;
}

function renderKnowledgeCentre(html, post) {
  return html.replace(
    /<link rel="canonical" href="https:\/\/profitquote\.co\.uk\/knowledge-centre\.html">/,
    `<link rel="canonical" href="${canonicalForPost(post)}">`
  );
}

function knowledgeCentre(req, res, next) {
  fs.readFile(path.join(__dirname, '../public/knowledge-centre.html'), 'utf8', (error, html) => {
    if (error) return next(error);
    res.type('html').send(renderKnowledgeCentre(html, req.query.post));
  });
}

module.exports = { knowledgeCentre, canonicalForPost, renderKnowledgeCentre };
