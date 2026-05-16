const router = require('express').Router();
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT * FROM issues WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  const { issue_type, description, extra_hours, extra_materials, hourly_rate, total_extra, variation_data } = req.body;
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'INSERT INTO issues (user_id,issue_type,description,extra_hours,extra_materials,hourly_rate,total_extra,variation_data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user.id, issue_type, description, extra_hours, extra_materials, hourly_rate, total_extra, JSON.stringify(variation_data)]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
