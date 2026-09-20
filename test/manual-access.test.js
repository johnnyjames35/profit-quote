const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const jwt=require('jsonwebtoken');
const {PGlite}=require('@electric-sql/pglite');
test('admin cancellation revokes only manual access and preserves customer data',async()=>{
 process.env.ADMIN_SECRET='local-test-secret';
 const db=new PGlite();
 await db.exec(`CREATE TABLE users(id SERIAL PRIMARY KEY,paid_at TIMESTAMPTZ,billing_managed BOOLEAN DEFAULT FALSE);
 INSERT INTO users(paid_at,billing_managed)VALUES(NOW(),FALSE),(NOW(),TRUE);
 CREATE TABLE events(event_type TEXT,user_id INTEGER,source TEXT);
 CREATE TABLE quotes(id SERIAL PRIMARY KEY,user_id INTEGER);INSERT INTO quotes(user_id)VALUES(1);`);
 const app=express();app.locals.pool=db;
 app.use('/api/admin',require('../routes/admin'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=(id,auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/${id}/mark-cancelled`,{method:'PATCH',headers:auth?{Authorization:'Bearer '+jwt.sign({admin:true},process.env.ADMIN_SECRET)}:{}});
 try{
  assert.equal((await call(1,false)).status,401);
  assert.equal((await call(1)).status,200);
  assert.equal((await db.query('SELECT paid_at FROM users WHERE id=1')).rows[0].paid_at,null);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM quotes')).rows[0].n,1);
  assert.equal((await call(2)).status,409);
  assert.ok((await db.query('SELECT paid_at FROM users WHERE id=2')).rows[0].paid_at);
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
