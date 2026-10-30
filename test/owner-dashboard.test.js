const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {range,authorized,report}=require('../utils/owner-report.cjs');
const {SITES}=require('../utils/owner-dashboard');
test('owner dashboard is restricted to the approved four businesses',()=>{
  assert.deepEqual(SITES.map(s=>s.name),['ProfitQuote','CallbackApp','LatePay','Kelvori']);
  assert.ok(readFileSync(require.resolve('../routes/admin'),'utf8').includes("router.get('/portfolio-dashboard', requireAdmin"));
});
test('reporting dates and bearer tokens are strict',()=>{
  assert.equal(range('2026-10-01','2026-10-07').days,7);
  assert.throws(()=>range('2026-02-30','2026-03-01'));
  assert.throws(()=>range('2026-01-01','2026-10-01'));
  assert.equal(authorized('Bearer '+'x'.repeat(40),'x'.repeat(40)),true);
  assert.equal(authorized('Bearer invalid','x'.repeat(40)),false);
  assert.equal(authorized('Bearer undefined',undefined),false);
});
test('report exposes counts, never account records or test addresses',async()=>{
  const r=await report({kind:'profitquote',start:'2026-10-01',end:'2026-10-07',env:{OWNER_REPORT_EXCLUDE_EMAILS:'qa@example.test'},query:async(text,params)=>{
    assert.ok(text.includes('COUNT(*)'));assert.deepEqual(params[2],['qa@example.test']);
    return {rows:[{registered:1,registrations:1,activity:2,email:'not-returned@example.test'}]};
  }});
  assert.equal(r.activity,2);assert.ok(!JSON.stringify(r).includes('example.test'));
});
test('bad aggregates fail instead of manufacturing zero',async()=>{
  await assert.rejects(report({kind:'profitquote',start:'2026-10-01',end:'2026-10-07',query:async()=>({rows:[]})}));
});
