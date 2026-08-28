const router = require('express').Router();
const auth = require('../middleware/auth');
const { sendToGA } = require('../utils/ga');
const https = require('https');

const CUSTOMER_EMAIL_FROM = 'hello@profitquote.co.uk';

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sendCustomerQuoteEmail({ to, businessName, customerName, phone, total, description, quoteData }) {
  return new Promise((resolve, reject) => {
    if (!process.env.BREVO_API_KEY) return reject(new Error('Email delivery is not configured'));
    const money = (value) => `£${Math.round(Number(value) || 0).toLocaleString('en-GB')}`;
    const items = String(description || '').split(/,|;|\n| and /i).map((item) => item.trim()).filter((item) => item.length > 4).slice(0, 30);
    const breakdown = [
      ['Labour', quoteData.labour], ['Materials', quoteData.mats],
      [Number(quoteData.skipQuantity) > 1 ? `${Number(quoteData.skipQuantity)} Skips & Waste Disposal` : 'Skip & Waste Disposal', quoteData.skipPrice ?? quoteData.skipCost],
      ['Scaffolding', quoteData.scaffoldPrice ?? quoteData.scaffoldCost], ['Contingency', quoteData.contingencyPrice ?? quoteData.contingencyAmt],
      [Number(quoteData.vatRate) > 0 ? `VAT (${Number(quoteData.vatRate)}%)` : 'VAT', quoteData.vatAmount]
    ].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label}: ${money(value)}`);
    const textContent = [
      `Dear ${String(customerName || 'Customer').slice(0, 200)},`, '',
      `Thank you for inviting ${businessName} to provide a quotation for your project.`, '',
      'Project summary', ...items.map((item) => `• ${item}`), '',
      `Total quotation: ${money(total)}`, '', 'Price breakdown', ...breakdown, '',
      ...(quoteData.clientSuppliesMaterials
        ? [`Client to supply: ${String(quoteData.clientSuppliedItems || 'materials agreed separately').slice(0, 300)}. These items are not included in the quotation total.`, '']
        : []),
      'This quotation includes the agreed scope of work and all identified materials and labour requirements.', '',
      'To accept this quotation, reply to this email or contact us using the details below.', '',
      'Kind regards,', businessName, ...(phone ? [String(phone).slice(0, 50)] : []), CUSTOMER_EMAIL_FROM, '',
      'Generated with ProfitQuote — Profit Protection Software for Tradespeople', 'https://profitquote.co.uk'
    ].join('\n');
    const payload = JSON.stringify({
      sender: { name: `${businessName} via ProfitQuote`.slice(0, 70), email: CUSTOMER_EMAIL_FROM },
      replyTo: { name: 'ProfitQuote', email: CUSTOMER_EMAIL_FROM },
      to: [{ email: to, name: String(customerName || 'Customer').slice(0, 70) }],
      subject: `Your quotation from ${businessName}`.slice(0, 200),
      textContent
    });
    const request = https.request({
      hostname: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'api-key': process.env.BREVO_API_KEY }
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => response.statusCode >= 200 && response.statusCode < 300
        ? resolve()
        : reject(new Error(`Email provider rejected request (${response.statusCode})`)));
    });
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

function logEvent(pool, eventType, userId, source) {
  return pool.query(
    'INSERT INTO events (event_type, user_id, source) VALUES ($1,$2,$3)',
    [eventType, userId || null, source || null]
  ).then(() => sendToGA(eventType, userId, source))
   .catch(e => console.error('Event log error:', e.message));
}

router.get('/', auth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const field = req.user.guest ? 'guest_id' : 'user_id';
    const result = await pool.query(
      `SELECT * FROM quotes WHERE ${field}=$1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  const { customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, quote_data, total, profit_percent } = req.body;
  try {
    const pool = req.app.locals.pool;
    if (req.user.guest) {
      const claim = await pool.query('UPDATE guest_sessions SET quote_count=quote_count+1,last_active_at=NOW() WHERE id=$1 AND expires_at>NOW() AND converted_user_id IS NULL AND quote_count<3 RETURNING quote_count', [req.user.id]);
      if (!claim.rows.length) return res.status(402).json({ error:'guest_limit', message:'You have completed your 3 free quotes. Create an account to keep them and continue.' });
      const guestResult = await pool.query('INSERT INTO quotes (guest_id,customer_name,trade,job_description,spec_level,skip_type,skip_cost,day_rate,days,markup_percent,profit_target,other_costs,quote_data,total,profit_percent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *', [req.user.id, customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, JSON.stringify(quote_data), total, profit_percent]);
      const used = claim.rows[0].quote_count;
      await pool.query("INSERT INTO events(event_type,source,meta) VALUES('guest_quote_completed','guest',jsonb_build_object('guest_id',$1::text,'quote_number',$2::int,'total',$3::numeric))", [req.user.id, used, Number(total)||0]);
      await pool.query("INSERT INTO events(event_type,source,meta) VALUES('quote_completed','guest',jsonb_build_object('guest_id',$1::text,'quote_id',$2::int,'total',$3::numeric))", [req.user.id, guestResult.rows[0].id, Number(total)||0]);
      sendToGA('guest_quote_completed', null, 'guest').catch(() => {});
      sendToGA('quote_completed', null, 'guest').catch(() => {});
      return res.json({ ...guestResult.rows[0], guest_quotes_used:used, guest_quotes_remaining:3-used });
    }
    const result = await pool.query(
      'INSERT INTO quotes (user_id,customer_name,trade,job_description,spec_level,skip_type,skip_cost,day_rate,days,markup_percent,profit_target,other_costs,quote_data,total,profit_percent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',
      [req.user.id, customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, JSON.stringify(quote_data), total, profit_percent]
    );
    res.json(result.rows[0]);

    logEvent(pool, 'quote_completed', req.user.id, 'dashboard');

    const priorQuotes = await pool.query('SELECT id FROM quotes WHERE user_id=$1', [req.user.id]);
    if (priorQuotes.rows.length === 1) {
      logEvent(pool, 'first_quote', req.user.id, null);
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/send-email', auth, async (req, res) => {
  if (req.user.guest) return res.status(403).json({ error: 'Create an account to send quotes directly.' });
  const { customer_email, customer_name, job_description, total, quote_data } = req.body || {};
  if (!validEmail(customer_email)) return res.status(400).json({ error: 'Enter a valid customer email address.' });
  if (!Number.isFinite(Number(total)) || Number(total) < 0 || Number(total) > 10000000) return res.status(400).json({ error: 'The quote total is invalid.' });
  try {
    const pool = req.app.locals.pool;
    const recent = await pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='quote_sent' AND user_id=$1 AND created_at >= NOW() - INTERVAL '1 hour'", [req.user.id]);
    if (recent.rows[0].c >= 10) return res.status(429).json({ error: 'Hourly email limit reached. Please try again later.' });
    const userResult = await pool.query('SELECT name,business_name,phone FROM users WHERE id=$1', [req.user.id]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found.' });
    const user = userResult.rows[0];
    const businessName = String(user.business_name || user.name || 'ProfitQuote customer').slice(0, 100);
    await sendCustomerQuoteEmail({
      to: customer_email.trim().toLowerCase(), businessName, customerName: customer_name,
      phone: user.phone, total: Number(total), description: String(job_description || '').slice(0, 5000), quoteData: quote_data || {}
    });
    await pool.query("INSERT INTO events(event_type,user_id,source,meta) VALUES('quote_sent',$1,'profitquote_email',jsonb_build_object('recipient_domain',split_part($2,'@',2),'total',$3::numeric))", [req.user.id, customer_email.trim().toLowerCase(), Number(total)]);
    sendToGA('quote_sent', req.user.id, 'profitquote_email').catch(() => {});
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, from: CUSTOMER_EMAIL_FROM });
  } catch (error) {
    console.error('Quote email error:', error.message);
    res.status(502).json({ error: 'The quote could not be emailed. Please try again.' });
  }
});

router.patch('/:id/status', auth, async (req, res) => {
  if (req.user.guest) return res.status(403).json({ error: 'Create an account to edit or manage saved quotes.' });
  const { status } = req.body;
  if (!['won', 'lost', 'draft'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'UPDATE quotes SET status=$1 WHERE id=$2 AND user_id=$3',
      [status, req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', auth, async (req, res) => {
  const { customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, quote_data, total, profit_percent } = req.body;
  try {
    const pool = req.app.locals.pool;
    const ownerField = req.user.guest ? 'guest_id' : 'user_id';
    const result = await pool.query(
      `UPDATE quotes SET customer_name=$1,trade=$2,job_description=$3,spec_level=$4,skip_type=$5,skip_cost=$6,day_rate=$7,days=$8,markup_percent=$9,profit_target=$10,other_costs=$11,quote_data=$12,total=$13,profit_percent=$14 WHERE id=$15 AND ${ownerField}=$16 RETURNING id`,
      [customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, JSON.stringify(quote_data), total, profit_percent, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Quote not found' });
    if (req.user.guest) {
      pool.query("INSERT INTO events(event_type,source,meta) VALUES('guest_quote_updated','guest',jsonb_build_object('guest_id',$1::text,'quote_id',$2::int))", [req.user.id, Number(req.params.id)]).catch(()=>{});
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  if (req.user.guest) return res.status(403).json({ error: 'Create an account to edit or manage saved quotes.' });
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM quotes WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
