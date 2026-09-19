const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/dashboard.html'),'utf8');
const functions=html.slice(html.indexOf('function showGuestSignup(){'),html.indexOf('let quotes = [];'));
const email=html.slice(html.indexOf('async function emailQuote(){'),html.indexOf('async function printQuote(){'));
const print=html.slice(html.indexOf('async function printQuote(){'),html.indexOf('// VARIATIONS'));
const render=html.slice(html.indexOf('function renderCompletedQuote(){'),html.indexOf('function flashProfitHero('));
const quote={id:42,customer_name:'Test customer',customer_email:'customer@example.invalid',job_description:'Complete rewire',days:6.5,total:8698,quote_data:{customer_email:'customer@example.invalid',labour:1300,mats:3600,contingencyPrice:791,total:8698,profit:2610,profitPct:30,protectedCost:6089,subtotalExVat:8698,vatAmount:0,vatRate:0,builderDetails:'Saved scope',roomSummary:'Whole house',skipCost:0,skipPrice:0,skipQuantity:1,scaffoldCost:0,scaffoldPrice:0,contingency:10}};
function harness(guest=true){
  const elements={},storage=new Map(),requests=[],opened=[],events=[];
  const element=id=>elements[id]??={style:{},classList:{add(){},remove(){}},textContent:'',value:'',disabled:false};
  const context=vm.createContext({API:'',token:'test',currentUser:{guest,name:'Electrician'},currentQuoteData:structuredClone(quote),editingQuoteId:42,quotes:[structuredClone(quote)],currentBuilderStep:6,selectedRisk:'low',needsSkip:false,needsScaffold:false,
    document:{getElementById:element,querySelector:element},sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)},
    fetch:async(url,options)=>{requests.push({url,options});return Response.json(url.endsWith('send-email')?{from:'hello@profitquote.co.uk'}:{ok:true,id:42});},
    window:{open:(...args)=>{opened.push(args);return {document:{write(){},close(){}},focus(){},print(){}};}},
    trackFunnelEvent:e=>events.push(e),showToast:message=>context.toast=message,editQuote:id=>context.edited=id,switchTab:tab=>context.tab=tab,calcHealthScore:()=>80,setTimeout:fn=>fn(),Date,console});
  vm.runInContext(functions+email+print+render,context);
  return {context,elements,storage,requests,opened,events};
}
for(const action of ['printQuote','emailQuote']) test(`guest ${action} saves latest quote and gates output`,async()=>{
  const h=harness();
  await vm.runInContext(`${action}()`,h.context);
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].options.method,'PATCH');
  assert.deepEqual(JSON.parse(h.requests[0].options.body),quote);
  assert.equal(h.storage.get('pq_quote_return_v1'),'42');
  assert.equal(h.elements['register-screen'].style.display,'flex');
  assert.equal(h.elements['quote-signup-prompt'].style.display,'block');
  assert.match(h.elements['#register-screen .auth-left-sub'].textContent,/No card required/);
  assert.equal(h.opened.length,0);
  assert.equal(h.events.length,0);
});
test('failed save keeps guest quote intact and does not enter signup',async()=>{
  const h=harness(); h.context.fetch=async()=>Response.json({error:'Save failed'},{status:500});
  await vm.runInContext('emailQuote()',h.context);
  assert.equal(h.storage.size,0);
  assert.equal(h.elements['register-screen'],undefined);
  assert.equal(h.context.currentQuoteData.total,8698);
  assert.match(h.context.toast,/still here/);
});
test('signup return after reload restores exact saved result without generation or sending',()=>{
  const h=harness(false); h.context.currentQuoteData=null;
  h.context.quotes=[{...structuredClone(quote),customer_email:undefined}];
  h.storage.set('pq_quote_return_v1','42');
  vm.runInContext('returnToCompletedQuote()',h.context);
  assert.equal(h.context.edited,42);
  assert.equal(h.context.currentBuilderStep,6);
  assert.equal(h.context.currentQuoteData.customer_email,quote.customer_email);
  assert.equal(h.context.currentQuoteData.total,8698);
  assert.equal(h.elements['step-6'].style.display,'block');
  assert.equal(h.elements['result-total'].textContent,'£8,698');
  assert.equal(h.elements['ai-output'].style.display,'block');
  assert.equal(h.requests.length,0); assert.equal(h.opened.length,0); assert.equal(h.storage.size,0);
});
test('registered Email retains server delivery and PDF opens print document',async()=>{
  const h=harness(false);
  await vm.runInContext('emailQuote()',h.context);
  assert.equal(h.requests[0].url,'/api/quotes/send-email');
  assert.deepEqual(JSON.parse(h.requests[0].options.body),quote);
  await vm.runInContext('printQuote()',h.context);
  assert.equal(h.opened.length,1);
  assert.deepEqual(h.events,['quote_sent','quote_downloaded']);
  assert.equal(h.storage.size,0);
});
test('dashboard inline scripts parse and guest mailto bypass is removed',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  assert.doesNotMatch(html,/buildLegacyEmailDraft|mailto:/);
});
