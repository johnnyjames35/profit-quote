const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/dashboard.html'),'utf8');
function harness(type,category=''){
  const elements={};const el=id=>elements[id]??={value:'',hidden:false,open:false,dataset:{},textContent:'',style:{}};
  const context=vm.createContext({document:{getElementById:el},currentUser:{trade:''},setScaffold(){},setSkip(){},updateGuidedDescription(){},updateProfitNudges(){}});
  vm.runInContext(html.slice(html.indexOf('function usesDimensions('),html.indexOf('// These are prompts')),context);
  el('q-job-type').value=type;el('q-other-category').value=category;
  return {el,context,run:code=>vm.runInContext(code,context)};
}
for(const [type,category,question,dimensions] of [
  ['bathroom','','Layout / services',true],['kitchen','','Layout / services',true],
  ['decorating','','Surface condition',true],['extension','','Current stage',true],
  ['electrical','','Property access',false],['plumbing','','Existing services / access',false],
  ['other','Carpentry / joinery','Fit / existing condition',false],
  ['other','Windows / doors','Openings / access',false],['other','Tiling','Substrate / preparation',true],
  ['other','Plastering','Existing surface',true],['other','Flooring','Subfloor condition',true],
  ['other','Landscaping','Ground / access',true],['other','General building / repairs','Site condition / access',false],
  ['other','Other','Condition / access',false]
])test(type+' '+category+' has relevant questions and no required measurements',()=>{
  const h=harness(type,category);h.run('configureJobScope()');
  assert.equal(h.el('trade-condition-label').textContent,question);
  assert.equal(h.el('job-scope-fields').hidden,false);
  assert.equal(h.el('dimension-fields').hidden,!dimensions);
  assert.equal(h.el('dimension-fields').open,false);
  assert.ok(h.run('tradeScopeQuestions().work.length')>=4);
  assert.equal(h.run('readJobScope().tradeDetails.quantity'),'');
  assert.equal(h.run('readJobScope().tradeDetails.measurements'),'');
});
test('fencing uses optional run/item measurements rather than rectangular floor area',()=>{
  const h=harness('other','Landscaping');h.el('q-trade-work').value='Fencing / decking';h.run('configureJobScope()');
  assert.equal(h.el('dimension-fields').hidden,true);
  assert.equal(h.el('trade-measurement-notes').hidden,false);
  h.el('q-trade-measurements').value='Fence run 12m';
  assert.match(h.run('jobScopeSummary()'),/Fence run 12m/);
  h.el('q-job-type').value='electrical';h.run('configureJobScope()');
  assert.equal(h.run('readJobScope().tradeDetails.measurements'),'');
  assert.equal(h.run('readJobScope().tradeDetails.category'),'');
});
test('measurements are explicit optional disclosures and native inputs are not required',()=>{
  assert.match(html,/<details id="dimension-fields">/);
  for(const id of ['q-length-m','q-width-m','q-height-m','q-trade-measurements']){
    const tag=html.match(new RegExp('<(?:input|textarea)[^>]*id="'+id+'"[^>]*>'))[0];
    assert.doesNotMatch(tag,/\brequired\b/);
  }
});
