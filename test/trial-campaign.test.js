const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),{checkAndSendTrialEmails}=require('../utils/trialEmails');
test('trial campaign deduplicates, retries failed delivery, suppresses buyers and honours opt-out/Sundays',async()=>{
 process.env.JWT_SECRET='test-only';const db=new PGlite();await db.exec(fs.readFileSync('schema.sql','utf8'));
 const now=new Date('2026-09-24T12:00:00Z');
 for(const [i,days] of [[1,1],[2,3],[3,6],[4,7],[5,10],[6,3],[7,3]]){
  const trial=crypto.randomUUID(),start=new Date(now-days*86400000);
  await db.query('INSERT INTO quote_allowances(id,trial_started_at) VALUES($1,$2)',[trial,start]);
  await db.query('INSERT INTO users(id,name,email,password_hash,trial_id,trial_started_at,trial_emails_enabled) VALUES($1,$2,$3,\'test\',$4,$5,$6)',[i,'<Test> Name','trial'+i+'@example.invalid',trial,start,i!==7]);
  if(i===1)await db.query('INSERT INTO quotes(user_id) VALUES(1)');
  if(i===6)await db.query("INSERT INTO commercial_payments(session_id,user_id,amount,credit_available) VALUES('cs_old',6,500,false)");
 }
 const pool={query:db.query.bind(db),connect:async()=>({query:db.query.bind(db),release(){}})},sent=[];
 const deliver=async(to,subject,html)=>{sent.push({to,subject,html});};
 await checkAndSendTrialEmails(pool,now,deliver);assert.equal(sent.length,5);
 assert.match(sent[0].html,/&lt;Test&gt;/);assert.doesNotMatch(sent[0].html,/&lt;Test&gt; Name/);
 await checkAndSendTrialEmails(pool,now,deliver);assert.equal(sent.length,5,'same-stage delivery is not repeated');
 await db.query("DELETE FROM trial_campaign_log WHERE user_id=3");
 await checkAndSendTrialEmails(pool,now,async()=>{throw new Error('provider rejected');});
 assert.equal((await db.query('SELECT 1 FROM trial_campaign_log WHERE user_id=3')).rows.length,0,'failed sends are not marked sent');
 await checkAndSendTrialEmails(pool,now,deliver);assert.equal(sent.length,6);
 await checkAndSendTrialEmails(pool,new Date('2026-09-27T12:00:00Z'),deliver);assert.equal(sent.length,6,'Sunday policy preserved');
 assert.ok(!sent.some(s=>/trial[67]@/.test(s.to)),'converted and opted-out users excluded');
 await db.close();
});
