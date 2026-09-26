const crypto = require('node:crypto');
const {renderPDF}=require('../utils/quotation-pdf');
const quotationDocument=require('../public/quotation-document');
const router = require('express').Router();
const auth = require('../middleware/auth');
const { sendToGA } = require('../utils/ga');
const https = require('https');
const jwt = require('jsonwebtoken');
const {access,consume,limitError,publicAccess,UUID}=require('../utils/quote-access');

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
  if(req.user.guest) return res.json([]);
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
  if(req.user.guest) return res.status(403).json({error:'Create an account to save this quote for later.',code:'account_required'});
  const data=req.body||{};
  const {customer_name,trade,job_description,spec_level,skip_type,skip_cost,day_rate,days,markup_percent,profit_target,other_costs,total,profit_percent}=data;
  const quote_data={...(data.quote_data||{}),customer_email:data.customer_email||data.quote_data?.customer_email||''};
  const creationKey=UUID.test(data.creation_key||'')?data.creation_key:null;
  const pool=req.app.locals.pool,client=await pool.connect();
  try{
    await client.query('BEGIN');
    const a=await access(client,req.user,true);
    if(creationKey){
      const previous=await client.query('SELECT * FROM quotes WHERE creation_key=$1 AND '+(req.user.guest?'guest_id':'user_id')+'=$2',[creationKey,req.user.id]);
      if(previous.rows.length){await client.query('COMMIT');return res.json({...previous.rows[0],...publicAccess(a),guest_quotes_remaining:a.remaining});}
    }
    if(!a.can_create) throw limitError(req.user.guest);
    const ownerField=req.user.guest?'guest_id':'user_id';
    const saved=await client.query(
      'INSERT INTO quotes ('+ownerField+',customer_name,trade,job_description,spec_level,skip_type,skip_cost,day_rate,days,markup_percent,profit_target,other_costs,quote_data,total,profit_percent,creation_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',
      [req.user.id,customer_name,trade,job_description,spec_level,skip_type,skip_cost,day_rate,days,markup_percent,profit_target,other_costs,JSON.stringify(quote_data),total,profit_percent,creationKey]);
    await consume(client,a,req.user);
    Object.assign(a,await access(client,req.user));
    if(req.user.guest) await client.query('UPDATE guest_sessions SET quote_count=quote_count+1,last_active_at=NOW() WHERE id=$1',[req.user.id]);
    let completionEvent='quote_completed';
    if(data.output_token){
      try{
        const output=jwt.verify(data.output_token,process.env.JWT_SECRET);
        if(output.purpose==='anonymous-quote' && (await client.query('SELECT id FROM guest_sessions WHERE id=$1 AND converted_user_id=$2',[output.guest_id,req.user.id])).rows.length) completionEvent='quote_saved';
      }catch{}
    }
    await client.query('INSERT INTO events(event_type,user_id,source,meta) VALUES($1,$2,$3,$4)',[completionEvent,req.user.id,'dashboard',JSON.stringify({quote_id:saved.rows[0].id})]);
    if(req.user.guest) await client.query("INSERT INTO events(event_type,source,meta) VALUES('guest_quote_completed','guest',$1)",[JSON.stringify({guest_id:req.user.id,quote_number:a.used})]);
    await client.query('COMMIT');
    res.json({...saved.rows[0],...publicAccess(a),guest_quotes_remaining:a.remaining});
  }catch(error){
    await client.query('ROLLBACK');
    res.status(error.status||500).json({error:error.message,code:error.code});
  }finally{client.release();}
});

async function anonymousOutput(req) {
  const a=await access(req.app.locals.pool,req.user);
  if(!a.can_create) throw limitError(true);
  let signed;
  try{signed=jwt.verify(req.body?.output_token,process.env.JWT_SECRET);}
  catch{throw Object.assign(new Error('Generate this quote again before sending or downloading it.'),{status:400});}
  if(signed.purpose!=='anonymous-quote'||signed.guest_id!==req.user.id) throw Object.assign(new Error('Quote not found.'),{status:403});
  // Older active guest drafts predate references; derive a stable reference from their signed token.
  const quote={...signed.quote};
  quote.created_at=quote.created_at||new Date(signed.iat*1000).toISOString();
  quote.reference=quote.reference||guestReference(quote.created_at,crypto.createHash('sha256').update(req.body.output_token).digest('hex'));
  return quote;
}
function guestReference(date,id){
  const day=new Date(date).toLocaleDateString('en-GB',{timeZone:'Europe/London'}).split('/');
  return 'PQ-'+day[0]+day[1]+day[2].slice(-2)+'-'+id.replaceAll('-','').slice(0,8).toUpperCase();
}
router.post('/preview',auth,async(req,res)=>{
  if(!req.user.guest) return res.status(400).json({error:'Use your account quote builder.'});
  try{
    const a=await access(req.app.locals.pool,req.user);
    if(!a.can_create) throw limitError(true);
    const quote={...req.body};delete quote.output_token;delete quote.id;
    if(!Number.isFinite(Number(quote.total))||Number(quote.total)<0||Number(quote.total)>10000000||!quote.quote_data) return res.status(400).json({error:'Check the quote figures and generate again.'});
    quote.created_at=new Date().toISOString();
    quote.reference=guestReference(quote.created_at,crypto.randomUUID());
    quote.customer_email=quote.customer_email||quote.quote_data.customer_email||'';
    const output_token=jwt.sign({purpose:'anonymous-quote',guest_id:req.user.id,quote},process.env.JWT_SECRET,{expiresIn:Math.max(1,Math.floor((new Date(a.trial_ends_at)-Date.now())/1000))});
    await req.app.locals.pool.query("INSERT INTO events(event_type,source,meta) VALUES('anonymous_quote_completed','guest',$1)",[JSON.stringify({guest_id:req.user.id})]);
    res.set('Cache-Control','no-store').json({output_token,reference:quote.reference,created_at:quote.created_at,...publicAccess(a)});
  }catch(e){res.status(e.status||500).json({error:e.message,code:e.code});}
});
// PDF output uses the same HTML/CSS as Print, with server-verified quote data only.
async function sendPDF(req,res,quote){
  const user=req.user.guest?{name:'Guest'}:(await req.app.locals.pool.query('SELECT name,business_name,phone,contact_email,town FROM users WHERE id=$1',[req.user.id])).rows[0];
  if(!user) return res.status(404).json({error:'User not found.'});
  const pdf=await renderPDF(quotationDocument.render(quote,user));
  res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+quotationDocument.filename(quote)+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(pdf);
}
router.post('/preview/pdf',auth,async(req,res)=>{
  if(!req.user.guest) return res.status(400).json({error:'Use your saved quote.'});
  try{await sendPDF(req,res,await anonymousOutput(req));}
  catch(error){console.error('Quotation PDF:',error.message);res.status(error.status||503).json({error:error.status?error.message:'Could not prepare your PDF. Please try again.'});}
});
router.get('/:id/pdf',auth,async(req,res)=>{
  if(req.user.guest) return res.status(403).json({error:'Use your guest quotation.'});
  try{
    const result=await req.app.locals.pool.query('SELECT * FROM quotes WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
    if(!result.rows.length) return res.status(404).json({error:'Quote not found.'});
    await sendPDF(req,res,result.rows[0]);
  }catch(error){console.error('Quotation PDF:',error.message);res.status(error.status||503).json({error:error.status?error.message:'Could not prepare your PDF. Please try again.'});}
});

router.post('/preview/export',auth,async(req,res)=>{
  if(!req.user.guest) return res.status(400).json({error:'Use your saved quote.'});
  try{res.set('Cache-Control','no-store').json(await anonymousOutput(req));}
  catch(e){res.status(e.status||500).json({error:e.message,code:e.code});}
});

// Registered output comes from an owned, counted quote; anonymous output from a signed trial quote.
router.get('/:id/export',auth,async(req,res)=>{
  if(req.user.guest) return res.status(403).json({error:'Create an account to download your quote.'});
  try{
  const result=await req.app.locals.pool.query('SELECT * FROM quotes WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
  if(!result.rows.length) return res.status(404).json({error:'Quote not found.'});
  res.set('Cache-Control','no-store').json(result.rows[0]);
  }catch(e){res.status(500).json({error:'Could not load your quote.'});}
});

router.post('/send-email', auth, async (req, res) => {

  try {
  const pool=req.app.locals.pool;
  const saved=req.user.guest?{rows:[await anonymousOutput(req)]}:await pool.query('SELECT * FROM quotes WHERE id=$1 AND user_id=$2',[Number(req.body?.quote_id)||0,req.user.id]);
  if(!saved.rows.length) return res.status(404).json({error:'Save this quote before emailing it.'});
  const {customer_name,job_description,total,quote_data}=saved.rows[0];
  const customer_email=saved.rows[0].customer_email||quote_data?.customer_email;
  if (!validEmail(customer_email)) return res.status(400).json({ error: 'Enter a valid customer email address.' });
  if (!Number.isFinite(Number(total)) || Number(total) < 0 || Number(total) > 10000000) return res.status(400).json({ error: 'The quote total is invalid.' });
    const recent = await pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='quote_sent' AND (user_id=$1 OR ($2::text IS NOT NULL AND meta->>'guest_id'=$2)) AND created_at >= NOW() - INTERVAL '1 hour'", [req.user.guest?null:req.user.id,req.user.guest?req.user.id:null]);
    if (recent.rows[0].c >= 10) return res.status(429).json({ error: 'Hourly email limit reached. Please try again later.' });
    const userResult = req.user.guest?{rows:[{name:'Your tradesperson',business_name:saved.rows[0].quote_data?.businessName,phone:saved.rows[0].quote_data?.businessPhone}]}:await pool.query('SELECT name,business_name,phone FROM users WHERE id=$1', [req.user.id]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found.' });
    const user = userResult.rows[0];
    const businessName = String(user.business_name || user.name || 'ProfitQuote customer').slice(0, 100);
    await sendCustomerQuoteEmail({
      to: customer_email.trim().toLowerCase(), businessName, customerName: customer_name,
      phone: user.phone, total: Number(total), description: String(job_description || '').slice(0, 5000), quoteData: quote_data || {}
    });
    await pool.query("INSERT INTO events(event_type,user_id,source,meta) VALUES('quote_sent',$1,'profitquote_email',jsonb_build_object('recipient_domain',split_part($2,'@',2),'total',$3::numeric,'guest_id',$4::text))", [req.user.guest?null:req.user.id, customer_email.trim().toLowerCase(), Number(total),req.user.guest?req.user.id:null]);
    sendToGA('quote_sent', req.user.id, 'profitquote_email').catch(() => {});
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, from: CUSTOMER_EMAIL_FROM });
  } catch (error) {
    console.error('Quote email error:', error.message);
    res.status(error.status||502).json({ error: error.status?error.message:'The quote could not be emailed. Please try again.',code:error.code });
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
  if(req.user.guest) return res.status(403).json({error:'Create an account to save this quote for later.',code:'account_required'});
  const { customer_name, trade, job_description, spec_level, skip_type, skip_cost, day_rate, days, markup_percent, profit_target, other_costs, quote_data, total, profit_percent } = req.body;
  try {
    const pool = req.app.locals.pool;
    if(req.user.guest){ const session=await pool.query('SELECT id FROM guest_sessions WHERE id=$1 AND converted_user_id IS NULL AND expires_at>NOW()',[req.user.id]); if(!session.rows.length) return res.status(401).json({error:'Please sign in again.'}); }
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
