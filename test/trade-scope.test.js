const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/dashboard.html'),'utf8');
const labour=vm.runInNewContext('('+html.slice(html.indexOf('function labourNudge('),html.indexOf('function updateProfitNudges('))+')');
test('labour reviews recognise rewiring and scope without blocking or claiming minimum days',()=>{
  assert.match(labour({scale:'Whole property',roomCount:8},'New wiring / rewiring',6.5),/full rewire.*6.5 days/);
  assert.equal(labour({scale:'Single room'},'New wiring / rewiring',6.5),'');
  assert.equal(labour({scale:'Whole property',roomCount:8},'Replace sockets and switches',6.5),'');
  assert.equal(labour({scale:'Whole property',roomCount:8},'Full rewire',12),'');
  assert.equal(labour(null,'Full rewire',0),'');
  assert.match(labour(null,'Full bathroom refurbishment',2),/Worth double-checking/);
});

test('profit impact follows rounding, contingency, VAT exclusion and the materials markup floor',()=>{
  const pricing=html.slice(html.indexOf('function calculateProtectedPrice('),html.indexOf('function calcHealthScore('));
  const calculate=vm.runInNewContext('('+pricing+')');
  const base={days:6.5,dayRate:250,overheadPerDay:50,materials:2000,markup:20,skipCost:0,scaffoldCost:0,contingency:10,vatRate:20};
  const impact=(data)=>calculate({...data,profitTarget:30}).profit-calculate({...data,profitTarget:25}).profit;
  assert.equal(impact(base),414);
  assert.equal(impact({...base,vatRate:0}),414);
  assert.equal(impact({...base,contingency:0}),376);
  assert.equal(impact({...base,markup:200}),0);
});
