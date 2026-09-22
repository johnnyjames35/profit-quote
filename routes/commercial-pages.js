const express = require('express');
const path = require('path');
const router = express.Router();
const pages = require('../utils/commercial-pages');
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const slug = req.path.slice(1).replace(/\/$/, '').replace(/\.html$/i, '').toLowerCase();
  if (!pages.includes(slug)) return next();
  if (req.path !== '/' + slug) {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    return res.redirect(301, '/' + slug + query);
  }
  return res.sendFile(path.join(__dirname, '..', 'public', slug + '.html'));
});
module.exports = router;
