const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');

async function landing({search='', referrer='', blocked=false}={}) {
  const events=[], links=[];
  vm.runInNewContext(fs.readFileSync('public/commercial-pages.js','utf8'), {
    document:{body:{dataset:{landingPage:'electricians'}},referrer,querySelectorAll:()=>[{addEventListener:(name,handler)=>links.push(handler)}]},
    location:{search,hostname:'profitquote.co.uk'}, URL,URLSearchParams,Blob,
    window:{},navigator:{sendBeacon:(url,body)=>{events.push(body);return true;}},
    sessionStorage:{getItem:()=>{if(blocked)throw Error('blocked');return null;},setItem:()=>{}}
  });
  await new Promise(r=>setImmediate(r));
  return {event:JSON.parse(await events[0].text()),links};
}
test('commercial landing attribution preserves campaign and search traffic even with blocked storage',async()=>{
  assert.equal((await landing({search:'?utm_source=LinkedIn'})).event.source,'linkedin');
  assert.equal((await landing({referrer:'https://www.google.co.uk/search?q=test'})).event.source,'google');
  assert.equal((await landing({referrer:'https://google.com.attacker.invalid/'})).event.source,'referral');
  const blocked=await landing({blocked:true});assert.equal(blocked.event.source,'direct');assert.equal(blocked.links.length,0,'CTA listener is owned by the shared tracker');
});
test('public event cannot impersonate an account and source length cannot reject a visit',async t=>{
  const rows=[];const app=express();app.use(express.json());
  app.locals.pool={query:async(sql,args)=>{rows.push(args);return{rows:[]};}};
  app.use('/events',require('../routes/events'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_type:'page_viewed',user_id:99999,source:'x'.repeat(100)})});
  assert.equal(response.status,200);assert.equal(rows[0][1],null);assert.equal(rows[0][2].length,50);
});
