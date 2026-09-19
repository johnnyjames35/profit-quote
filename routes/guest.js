const router=require('express').Router();
const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const auth=require('../middleware/auth');
const {browserTrial,digest,ipHash,access}=require('../utils/quote-access');
router.post('/start',async(req,res)=>{
  const browserId=String(req.body?.browser_id||'');
  if(!/^[a-zA-Z0-9_-]{12,100}$/.test(browserId)) return res.status(400).json({error:'A valid browser ID is required'});
  const client=await req.app.locals.pool.connect();
  try{
    await client.query('BEGIN');
    const network=ipHash(req);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[network]);
    const trial=await browserTrial(client,req,res);
    const browserHash=digest(`${process.env.JWT_SECRET}|browser|${browserId}`);
    const existing=(await client.query('SELECT * FROM guest_sessions WHERE browser_hash=$1 FOR UPDATE',[browserHash])).rows[0];
    if(existing?.converted_user_id){await client.query('COMMIT');return res.status(409).json({error:'You have already created an account in this browser. Please sign in.',code:'sign_in'});}
    let id=existing?.id;
    if(!id){
      const recent=await client.query("SELECT COUNT(*)::int AS n FROM guest_sessions WHERE ip_hash=$1 AND created_at>NOW()-INTERVAL '24 hours'",[network]);
      if(recent.rows[0].n>=5) throw Object.assign(new Error('Too many free sessions from this connection today. Please sign in or try again tomorrow.'),{status:429});
      id=crypto.randomUUID();
      await client.query('INSERT INTO guest_sessions(id,browser_hash,ip_hash,trial_id) VALUES($1,$2,$3,$4)',[id,browserHash,network,trial]);
      await client.query("INSERT INTO events(event_type,source,meta) VALUES('guest_session_started','guest',$1)",[JSON.stringify({guest_id:id})]);
    }else{
      await client.query("UPDATE guest_sessions SET expires_at=NOW()+INTERVAL '30 days' WHERE id=$1",[id]);
    }
    await client.query('COMMIT');
    res.set('Cache-Control','no-store').json({token:jwt.sign({id,guest:true},process.env.JWT_SECRET,{expiresIn:'30d'})});
  }catch(e){await client.query('ROLLBACK');res.status(e.status||500).json({error:e.message});}
  finally{client.release();}
});
router.get('/status',auth,async(req,res)=>{
  if(!req.user.guest) return res.status(400).json({error:'Not a guest session'});
  try{const a=await access(req.app.locals.pool,req.user);res.json({used:a.used,remaining:a.remaining});}
  catch(e){res.status(e.status||500).json({error:e.message});}
});
module.exports=router;
