const router = require('express').Router();
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT id,customer_name,trade,job_description,total,profit_percent,status,created_at FROM quotes WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  const { customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, quote_data, total, profit_percent } = req.body;
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'INSERT INTO quotes (user_id,customer_name,trade,job_description,spec_level,skip_type,skip_cost,day_rate,days,markup_percent,profit_target,other_costs,quote_data,total,profit_percent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',
      [req.user.id, customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, JSON.stringify(quote_data), total, profit_percent]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/status', auth, async (req, res) => {
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
    await pool.query(
      'UPDATE quotes SET customer_name=$1,trade=$2,job_description=$3,spec_level=$4,skip_type=$5,skip_cost=$6,day_rate=$7,days=$8,markup_percent=$9,profit_target=$10,other_costs=$11,quote_data=$12,total=$13,profit_percent=$14 WHERE id=$15 AND user_id=$16',
      [customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, JSON.stringify(quote_data), total, profit_percent, req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM quotes WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
