const REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function active() {
  return process.env.PROFITQUOTE_PAID_FIRST === '1';
}

function isVerificationEmail(email) {
  return /^profitquote-release-check-[a-z0-9]+@example\.invalid$/i.test(email || '');
}

async function firstQuote(db, userId) {
  return (await db.query(`
    SELECT p.session_id, p.payment_intent, p.paid_at, p.first_quote_offer,
           p.refunded_at, r.requested_at
      FROM commercial_payments p
      LEFT JOIN first_quote_refund_requests r ON r.session_id = p.session_id
     WHERE p.user_id = $1
     ORDER BY COALESCE(p.paid_at, p.created_at), p.session_id
     LIMIT 1`, [userId])).rows[0];
}

async function refundStatus(db, userId, now = Date.now()) {
  const payment = await firstQuote(db, userId);
  if (!payment?.first_quote_offer || !payment.paid_at || !payment.payment_intent) {
    return { eligible: false, status: 'unavailable' };
  }
  const deadline = new Date(payment.paid_at).getTime() + REFUND_WINDOW_MS;
  const status = payment.refunded_at ? 'refunded' : payment.requested_at ? 'requested'
    : now < deadline ? 'available' : 'expired';
  return { eligible: status === 'available', status, deadline: new Date(deadline) };
}

async function requestRefund(db, userId, reason) {
  const explanation = typeof reason === 'string' ? reason.trim() : '';
  if (explanation.length < 3 || explanation.length > 500) {
    throw Object.assign(new Error('Tell us briefly what did not work (3–500 characters).'), { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    // Only the first recorded one-off payment can qualify. Evaluate age in the database.
    await client.query(`
      WITH first_payment AS (
        SELECT session_id, payment_intent, paid_at, first_quote_offer, refunded_at
          FROM commercial_payments WHERE user_id = $1
         ORDER BY COALESCE(paid_at, created_at), session_id LIMIT 1
      )
      INSERT INTO first_quote_refund_requests (session_id, reason)
      SELECT session_id, $2 FROM first_payment
       WHERE first_quote_offer AND payment_intent IS NOT NULL AND refunded_at IS NULL
         AND paid_at > NOW() - INTERVAL '168 hours'
      ON CONFLICT (session_id) DO NOTHING RETURNING session_id`, [userId, explanation]);
    const status = await refundStatus(client, userId);
    if (status.status !== 'requested' && status.status !== 'refunded') {
      throw Object.assign(new Error('Only the first eligible paid quote can be refunded under this offer, within seven days of purchase.'), { status: 409 });
    }
    await client.query('COMMIT');
    return status;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { active, isVerificationEmail, refundStatus, requestRefund };
