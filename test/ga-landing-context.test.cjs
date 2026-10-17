const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),helper=fs.readFileSync(path.join(root,'public/ga-context.js'),'utf8');
function browser({blocked=false,doNotTrack='0'}={}){
 const calls=[],window={gtag:(command,id,field,cb)=>{calls.push({command,id,field});if(!blocked)cb(field==='client_id'?'123.456':'1792254000')}};
 const context={window,navigator:{doNotTrack},location:{origin:'https://profitquote.co.uk',pathname:'/quoting-software-for-electricians',search:'?email=private@example.invalid'},setTimeout,clearTimeout};
 vm.runInNewContext(helper,context);return {window,calls};
}
test('commercial landing context reaches GA with original client/session and clean page location',async()=>{
 const b=browser(),identity=await b.window.pqGAContext(),sent=[];
 assert.equal(identity.client_id,'123.456');assert.equal(identity.session_id,'1792254000');
 assert.equal(identity.page_location,'https://profitquote.co.uk/quoting-software-for-electricians');
 const original=global.fetch;process.env.GA_MEASUREMENT_ID='G-OFFLINE';process.env.GA_API_SECRET='offline-only';
 global.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return{ok:true}};
 try{const ga=require('../utils/ga');assert.equal(await ga.sendToGA('trial_click',null,'electricians',identity),true)}finally{global.fetch=original;delete process.env.GA_MEASUREMENT_ID;delete process.env.GA_API_SECRET}
 assert.equal(sent.length,1);assert.equal(sent[0].client_id,'123.456');
 assert.equal(sent[0].events[0].params.session_id,1792254000);
 assert.equal(sent[0].events[0].params.page_location,identity.page_location);
 assert.doesNotMatch(JSON.stringify(sent),/private@example/);
});
test('DNT avoids identity lookup and blocked tags cannot manufacture identity',async()=>{
 const dnt=browser({doNotTrack:'1'});assert.equal(Object.keys(await dnt.window.pqGAContext()).length,0);assert.equal(dnt.calls.length,0);
 const blocked=browser({blocked:true});assert.equal(Object.keys(await blocked.window.pqGAContext()).length,0);
});
test('foreign page context is rejected without delivering a conversion',async()=>{
 const {analyticsContext,sendToGA}=require('../utils/ga');
 assert.equal(analyticsContext({client_id:'123.456',session_id:'12',page_location:'https://other.example/path'}),null);
 let calls=0;const original=global.fetch;global.fetch=async()=>{calls++;return{ok:true}};
 try{assert.equal(await sendToGA('trial_click',null,'page',{}),false)}finally{global.fetch=original}
 assert.equal(calls,0);
});
test('all seven commercial pages load identity helper before click handling',()=>{
 const slugs=require('../utils/commercial-pages');
 for(const slug of slugs){
  const page=fs.readFileSync(path.join(root,'public',slug+'.html'),'utf8');
  assert.ok(page.indexOf('/ga-context.js')>=0);assert.ok(page.indexOf('/ga-context.js')<page.indexOf('/commercial-pages.js'));
 }
});
