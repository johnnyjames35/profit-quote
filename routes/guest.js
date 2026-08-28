const router = require('express').Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
function digest(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function clientIp(req){return String(req.headers['x-forwarded-for']||req.ip||'').split(',')[0].trim();}
router.post('/start',async(req,res)=>{
 const browserId=String(req.body?.browser_id||'');
 if(!/^[a-zA-Z0-9_-]{12,100}$/.test(browserId))return res.status(400).json({error:'A valid browser ID is required'});
 const pool=req.app.locals.pool,ipHash=digest(`${process.env.JWT_SECRET}|ip|${clientIp(req)}`),browserHash=digest(`${process.env.JWT_SECRET}|browser|${browserId}`);
 try{
  let result=await pool.query('SELECT id FROM guest_sessions WHERE browser_hash=$1 AND expires_at>NOW() AND converted_user_id IS NULL ORDER BY created_at DESC LIMIT 1',[browserHash]);
  let id=result.rows[0]?.id;
  if(!id){const recent=await pool.query("SELECT COUNT(*)::int AS c FROM guest_sessions WHERE ip_hash=$1 AND created_at>NOW()-INTERVAL '24 hours'",[ipHash]);if(recent.rows[0].c>=5)return res.status(429).json({error:'Too many free sessions from this connection today. Please try again tomorrow.'});id=crypto.randomUUID();await pool.query('INSERT INTO guest_sessions(id,browser_hash,ip_hash) VALUES($1,$2,$3)',[id,browserHash,ipHash]);await pool.query("INSERT INTO events(event_type,source,meta) VALUES('guest_session_started','guest',jsonb_build_object('guest_id',$1::text))",[id]);}
  const token=jwt.sign({id,guest:true},process.env.JWT_SECRET,{expiresIn:'30d'});res.set('Cache-Control','no-store');res.json({token});
 }catch(e){console.error('Guest start error:',e.message);res.status(500).json({error:'Unable to start free quote session'});}
});
router.get('/status',auth,async(req,res)=>{if(!req.user.guest)return res.status(400).json({error:'Not a guest session'});const result=await req.app.locals.pool.query("SELECT COALESCE(SUM(other.quote_count),0)::int AS used FROM guest_sessions current_session JOIN guest_sessions other ON other.ip_hash=current_session.ip_hash AND other.created_at>NOW()-INTERVAL '30 days' WHERE current_session.id=$1 AND current_session.expires_at>NOW() AND current_session.converted_user_id IS NULL GROUP BY current_session.id",[req.user.id]);if(!result.rows.length)return res.status(401).json({error:'Guest session expired'});const used=result.rows[0].used;res.json({used,remaining:Math.max(0,3-used)});});
module.exports=router;
