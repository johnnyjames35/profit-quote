const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/dashboard.html'),'utf8');
const source=html.slice(html.indexOf('const BUILDER_DRAFT_KEY'),html.indexOf('function setSkip('));
function harness(){
  const elements={},storage=new Map();
  const el=id=>elements[id]??={value:'',style:{},textContent:''};
  const context=vm.createContext({currentUser:{id:7},editingQuoteId:45,currentBuilderStep:4,
    currentQuoteData:null,quotes:[{id:45,total:7661,quote_data:{costChecks:['fuel']}}],
    needsSkip:true,needsScaffold:false,clientSuppliesMaterials:true,selectedRisk:'med',
    document:{getElementById:el},localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    readCostChecks:()=>['fuel','waste'],restoreCostChecks:value=>context.checks=value,
    configureJobScope(){},restoreGuidedScope:()=>vm.runInContext('saveBuilderDraft()',context),
    setSkip:value=>context.needsSkip=value,setScaffold:value=>context.needsScaffold=value,
    setClientMaterials:value=>context.clientSuppliesMaterials=value,setRisk:value=>context.selectedRisk=value,
    nextStep:value=>context.currentBuilderStep=value});
  vm.runInContext(source,context);
  return {context,el,storage};
}
test('edited quote restores its identity, step, costs and checks after reload without creating a quote',()=>{
  const h=harness();h.el('q-days').value='5.5';h.el('q-materials').value='2850';h.el('q-customer').value='Test customer';
  vm.runInContext('saveBuilderDraft()',h.context);
  const original=h.storage.get('pq_builder_draft_v1');
  h.context.editingQuoteId=null;h.context.currentBuilderStep=1;h.el('q-materials').value='';
  assert.equal(vm.runInContext('restoreBuilderDraft()',h.context),true);
  assert.equal(h.context.editingQuoteId,45);assert.equal(h.context.currentBuilderStep,4);
  assert.equal(h.el('q-days').value,'5.5');assert.equal(h.el('q-materials').value,'2850');
  assert.equal(h.context.currentQuoteData.id,45);assert.equal(h.context.currentQuoteData.total,7661);
  assert.deepEqual(Array.from(h.context.checks),['fuel','waste']);
  assert.equal(h.storage.get('pq_builder_draft_v1'),original,'restore side effects must not overwrite the draft');
});
test('first-page customer details survive before a job type is selected',()=>{
  const h=harness();h.context.editingQuoteId=null;h.context.currentBuilderStep=1;h.el('q-customer').value='Test customer';
  vm.runInContext('saveBuilderDraft()',h.context);h.el('q-customer').value='';
  assert.equal(vm.runInContext('restoreBuilderDraft()',h.context),true);
  assert.equal(h.el('q-customer').value,'Test customer');assert.equal(h.context.editingQuoteId,null);
});
test('drafts cannot restore into a different account or a different saved quote',()=>{
  const h=harness();vm.runInContext('saveBuilderDraft()',h.context);
  h.context.currentUser.id=8;h.context.editingQuoteId=null;
  assert.equal(vm.runInContext('restoreBuilderDraft()',h.context),false);
  h.context.currentUser.id=7;h.context.editingQuoteId=46;
  assert.equal(vm.runInContext('restoreBuilderDraft()',h.context),false);
});
test('storage failure is visible rather than claiming progress was saved',()=>{
  const h=harness();h.context.localStorage.setItem=()=>{throw Error('storage full');};
  vm.runInContext('saveBuilderDraft()',h.context);
  assert.match(h.el('draft-save-status').textContent,/could not save/);
});
