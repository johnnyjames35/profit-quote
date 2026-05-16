const router = require('express').Router();
const auth = require('../middleware/auth');

router.put('/', auth, async (req, res) => {
  const { trade, day_rate, hourly_rate, markup_percent, profit_target, vat_registered, skip_clean, skip_mixed, skip_plasterboard, skip_inert, skip_hazardous } = req.body;
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'UPDATE users SET trade=$1,day_rate=$2,hourly_rate=$3,markup_percent=$4,profit_target=$5,vat_registered=$6,skip_clean=$7,skip_mixed=$8,skip_plasterboard=$9,skip_inert=$10,skip_hazardous=$11 WHERE id=$12 RETURNING id,name,email,trade,plan,day_rate,hourly_rate,markup_percent,profit_target,vat_registered,skip_clean,skip_mixed,skip_plasterboard,skip_inert,skip_hazardous',
      [trade, day_rate, hourly_rate, markup_percent, profit_target, vat_registered, skip_clean, skip_mixed, skip_plasterboard, skip_inert, skip_hazardous, req.user.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
