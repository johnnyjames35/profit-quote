const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/dashboard.html'),'utf8');
function harness(){
  const elements={};
  const el=id=>elements[id]??={value:'',hidden:false,textContent:'',dataset:{},style:{}};
  const context=vm.createContext({document:{getElementById:el},currentUser:{trade:'Roofer'},
    setScaffold:value=>context.scaffold=value,setSkip:value=>context.skip=value,
    updateGuidedDescription(){},updateProfitNudges(){}});
  vm.runInContext(html.slice(html.indexOf('function usesDimensions('),html.indexOf('// These are prompts')),context);
  el('q-job-type').value='roofing';
  return {el,context,run:code=>vm.runInContext(code,context)};
}
test('roofing uses scope questions, with no compulsory room dimensions',()=>{
  const h=harness();h.run('configureJobScope()');
  assert.equal(h.run('usesDimensions()'),false);
  assert.equal(h.el('dimension-fields').hidden,true);
  assert.equal(h.el('roofing-scope-fields').hidden,false);
  assert.equal(h.el('job-scope-fields').hidden,true);
  assert.equal(h.run('readJobScope().roofing.area'),null);
  h.el('q-job-type').value='bathroom';h.run('configureJobScope()');
  assert.equal(h.run('usesDimensions()'),true);
  assert.equal(h.el('roofing-scope-fields').hidden,true);
  h.el('q-job-type').value='electrical';h.run('configureJobScope()');
  assert.equal(h.el('job-scope-fields').hidden,false);
});
test('roof scope carries work, area, access, waste and optional notes into the description',()=>{
  const h=harness();
  for(const [key,value] of Object.entries({work:'Repair',type:'Pitched — slate',area:'45.5',access:'Scaffolding required',waste:'Skip required',measurements:'Front slope 7m × 6.5m'}))h.el('q-roof-'+key).value=value;
  const scope=h.run('readJobScope()');
  assert.equal(scope.roofing.area,45.5);
  assert.match(h.run('jobScopeSummary()'),/Repair.*slate.*45.5 m².*Scaffolding required.*Skip required.*Front slope/);
  h.el('q-roof-area').value='';h.el('q-roof-measurements').value='';
  assert.doesNotMatch(h.run('jobScopeSummary()'),/m²|Measurements/);
  h.el('q-job-type').value='electrical';
  assert.equal(h.run('readJobScope().roofing'),undefined,'roofing values must not leak into another trade');
});
test('access and waste choices use existing cost switches and allow changes',()=>{
  const h=harness();h.el('q-roof-access').value='Scaffolding required';h.run('updateRoofAccess()');assert.equal(h.context.scaffold,true);
  h.el('q-roof-access').value='Tower / lift / other access equipment';h.run('updateRoofAccess()');assert.equal(h.context.scaffold,false);
  h.el('q-roof-waste').value='Skip required';h.run('updateRoofWaste()');assert.equal(h.context.skip,true);
  h.el('q-roof-waste').value='Customer arranging removal';h.run('updateRoofWaste()');assert.equal(h.context.skip,false);
});
