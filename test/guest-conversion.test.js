const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/dashboard.html'),'utf8');
const functions=html.slice(html.indexOf('function showGuestSignup(){'),html.indexOf('let quotes = [];'));
const email=html.slice(html.indexOf('async function emailQuote(){'),html.indexOf('async function printQuote(){'));
const save=html.slice(html.indexOf('async function saveQuote(){'),html.indexOf('async function emailQuote(){'));
const print=html.slice(html.indexOf('async function printQuote(){'),html.indexOf('// VARIATIONS'));
const render=html.slice(html.indexOf('function renderCompletedQuote(){'),html.indexOf('function flashProfitHero('));
const quote={output_token:'signed-test-output',id:42,customer_name:'Test customer',customer_email:'customer@example.invalid',job_description:'Complete rewire',days:6.5,total:8698,quote_data:{customer_email:'customer@example.invalid',labour:1300,mats:3600,contingencyPrice:791,total:8698,profit:2610,profitPct:30,protectedCost:6089,subtotalExVat:8698,vatAmount:0,vatRate:0,builderDetails:'Saved scope',roomSummary:'Whole house',skipCost:0,skipPrice:0,skipQuantity:1,scaffoldCost:0,scaffoldPrice:0,contingency:10}};
function harness(guest=true){
  const elements={},storage=new Map(),requests=[],opened=[],events=[];
  const element=id=>elements[id]??={style:{},classList:{add(){},remove(){}},textContent:'',value:'',disabled:false};
  const context=vm.createContext({API:'',token:'test',currentUser:{guest,name:'Electrician'},currentQuoteData:structuredClone(quote),editingQuoteId:42,quotes:[structuredClone(quote)],currentBuilderStep:6,selectedRisk:'low',needsSkip:false,needsScaffold:false,
    document:{getElementById:element,querySelector:element},sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)},
    fetch:async(url,options)=>{requests.push({url,options});return Response.json(url.endsWith('send-email')?{from:'hello@profitquote.co.uk'}:url.endsWith('/export')?structuredClone(quote):{ok:true,id:42});},
    window:{open:(...args)=>{opened.push(args);return {document:{write(value){context.printHtml=value;},close(){}},focus(){},print(){}};}},
    saveBuilderDraft(){},clearBuilderDraft(){},loadQuotes:async()=>{},trackFunnelEvent:e=>events.push(e),showToast:message=>context.toast=message,editQuote:id=>context.edited=id,switchTab:tab=>context.tab=tab,calcHealthScore:()=>80,setTimeout:fn=>fn(),Date,console});
  const nudge=html.slice(html.indexOf('function labourNudge('),html.indexOf('function updateProfitNudges('));
  const checklist=html.slice(html.indexOf('const COST_CHECK_KEYS='),html.indexOf('function renderCompletedQuote(){'));
  vm.runInContext(functions+save+email+print+nudge+checklist+render,context);
  return {context,elements,storage,requests,opened,events};
}
test('guest Save keeps exact quote locally and prompts for an account without storing it',async()=>{
 const h=harness();await vm.runInContext('saveQuote()',h.context);
 assert.equal(h.requests.length,0);
 assert.deepEqual(JSON.parse(h.storage.get('pq_quote_return_v1')).quote,quote);
 assert.equal(h.elements['register-screen'].style.display,'flex');
 assert.deepEqual(h.events,['save_prompt_shown','signup_screen_viewed']);
});
test('guest Email sends signed output without a signup prompt',async()=>{
 const h=harness();await vm.runInContext('emailQuote()',h.context);
 assert.equal(h.requests[0].url,'/api/quotes/send-email');
 assert.deepEqual(JSON.parse(h.requests[0].options.body),{output_token:quote.output_token});
 assert.equal(h.elements['register-screen'],undefined);assert.equal(h.storage.size,0);
});
test('guest PDF verifies output without a signup prompt',async()=>{
 const h=harness();await vm.runInContext('printQuote()',h.context);
 assert.equal(h.requests[0].url,'/api/quotes/preview/export');assert.equal(h.opened.length,1);
 assert.equal(h.elements['register-screen'],undefined);
});
test('registration return saves exact pending quote and restores completed result',async()=>{
 const h=harness(false);h.context.currentQuoteData=null;
 h.storage.set('pq_quote_return_v1',JSON.stringify({quote}));
 await vm.runInContext('returnToCompletedQuote()',h.context);
 assert.equal(h.context.currentBuilderStep,6);assert.equal(h.context.currentQuoteData.total,8698);
 assert.deepEqual(JSON.parse(h.requests[0].options.body),quote);
 assert.equal(h.elements['result-total'].textContent,'£8,698');assert.equal(h.storage.size,0);
});
test('failed post-registration save preserves the quote for retry',async()=>{
 const h=harness(false);h.storage.set('pq_quote_return_v1',JSON.stringify({quote}));
 h.context.fetch=async()=>Response.json({error:'Try again'},{status:500});
 await vm.runInContext('returnToCompletedQuote()',h.context);
 assert.equal(h.context.currentQuoteData.total,8698);assert.equal(h.storage.size,1);
});
test('registration transfers custom editable rates with the pending browser draft',async()=>{
 const h=harness(false),draftStore=new Map();h.context.currentUser.id=7;
 h.context.BUILDER_DRAFT_KEY='draft';
 h.context.localStorage={getItem:k=>draftStore.get(k)||null,setItem:(k,v)=>draftStore.set(k,v)};
 draftStore.set('draft',JSON.stringify({owner:'guest-42',fields:{'q-day-rate':'357','q-profit-target':'27'}}));
 h.storage.set('pq_quote_return_v1',JSON.stringify({owner:'guest-42',quote}));
 await vm.runInContext('returnToCompletedQuote()',h.context);
 const draft=JSON.parse(draftStore.get('draft'));assert.equal(draft.owner,'7');
 assert.equal(draft.fields['q-day-rate'],'357');assert.equal(draft.fields['q-profit-target'],'27');
});
test('registered Email retains server delivery and PDF opens print document',async()=>{
  const h=harness(false);
  await vm.runInContext('emailQuote()',h.context);
  assert.equal(h.requests[0].url,'/api/quotes/send-email');
  assert.deepEqual(JSON.parse(h.requests[0].options.body),{quote_id:42});
  await vm.runInContext('printQuote()',h.context);
  assert.equal(h.opened.length,1);
  assert.deepEqual(h.events,['quote_downloaded']);
  assert.equal(h.storage.size,0);
});
test('PDF keeps exclusions, escapes customer data and uses the saved reference and date',async()=>{
  const h=harness(false);
  const saved={...structuredClone(quote),created_at:'2026-09-17T12:00:00Z',customer_name:'A <B> & C',
    job_description:'Do not replace light fittings; 3 m',quote_data:{...quote.quote_data,scopeTasks:['Safe isolation'],
      jobScope:{scale:'Whole property',roomCount:8},extraNotes:'Do not replace light fittings; 3 m'}};
  h.context.fetch=async()=>Response.json(saved);
  await vm.runInContext('printQuote()',h.context);
  assert.match(h.context.printHtml,/QUO-42/);
  assert.match(h.context.printHtml,/17\/09\/2026/);
  assert.match(h.context.printHtml,/A &lt;B&gt; &amp; C/);
  assert.match(h.context.printHtml,/<li>Additional details: Do not replace light fittings; 3 m<\/li>/);
  assert.match(h.context.printHtml,/approximately 8 rooms/);
  assert.doesNotMatch(h.context.printHtml,/expected profit|profit \(25%\)|Worth double-checking/);
  const first=h.context.printHtml;
  await vm.runInContext('printQuote()',h.context);
  assert.equal(h.context.printHtml,first);
});
test('dashboard inline scripts parse and guest mailto bypass is removed',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  assert.doesNotMatch(html,/buildLegacyEmailDraft|mailto:/);
});
