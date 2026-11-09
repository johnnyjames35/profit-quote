// Find each account's first recorded generation before applying a date window.
// Legacy first_quote events can precede the current quote_completed event.
module.exports = `
  SELECT MIN(created_at) AS created_at
  FROM events
  WHERE event_type IN ('first_quote', 'quote_completed') AND user_id IS NOT NULL
  GROUP BY user_id
`;
