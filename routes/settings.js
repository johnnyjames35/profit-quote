const router = require('express').Router();
const auth = require('../middleware/auth');

router.put('/', auth, async (req, res) => {
  const numberInRange = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
  };
  const dayRate = numberInRange(req.body.day_rate, 200, 0, 10000);
  const hourlyRate = numberInRange(req.body.hourly_rate, 35, 0, 1000);
  const overheadPerDay = numberInRange(req.body.overhead_per_day, 50, 0, 10000);
  const markupPercent = numberInRange(req.body.markup_percent, 20, 0, 500);
  const profitTarget = numberInRange(req.body.profit_target, 30, 0, 80);
  const vatRate = numberInRange(req.body.vat_rate, 0, 0, 30);
  const businessName = String(req.body.business_name || '').trim().slice(0, 200);
  const phone = String(req.body.phone || '').trim().slice(0, 50);
  const contactEmail = String(req.body.contact_email || '').trim().slice(0, 255);
  const town = String(req.body.town || '').trim().slice(0, 100);
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'UPDATE users SET day_rate=$1,hourly_rate=$2,overhead_per_day=$3,markup_percent=$4,profit_target=$5,vat_rate=$6,business_name=$7,phone=$8,contact_email=$9,town=$10 WHERE id=$11 RETURNING id,name,email,trade,plan,day_rate,hourly_rate,overhead_per_day,markup_percent,profit_target,vat_rate,business_name,phone,contact_email,town',
      [dayRate, hourlyRate, overheadPerDay, markupPercent, profitTarget, vatRate, businessName, phone, contactEmail, town, req.user.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
