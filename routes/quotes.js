const router = require('express').Router();
const auth = require('../middleware/auth');
const { sendToGA } = require('../utils/ga');

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
