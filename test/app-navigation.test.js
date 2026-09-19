const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../public/dashboard.html'),'utf8');
const source=html.slice(html.indexOf('let replayingNavigation='),html.indexOf('function switchTab(tab){'));
function harness(){
  let tab='home', index=0, popstate;
  const entries=[{pq:true,tab:'home',depth:12}];
  const buttons=[{style:{}},{style:{}}];
  const context=vm.createContext({currentBuilderStep:1,restoringBuilderDraft:false,
    document:{querySelector:()=>({id:'sec-'+tab}),querySelectorAll:()=>buttons,getElementById:()=>({style:{display:'none'}})},
    history:{get state(){return entries[index];},replaceState:s=>entries[index]=s,
      pushState:s=>{entries.splice(++index);entries[index]=s;},back:()=>{if(index>0)popstate({state:entries[--index]});}},
    window:{addEventListener:(name,fn)=>popstate=fn},saveBuilderDraft(){},resetIssues(){},
    switchTab:value=>{tab=value;vm.runInContext('rememberAppPage()',context);},
    nextStep:value=>{context.currentBuilderStep=value;vm.runInContext('rememberAppPage()',context);}});
  vm.runInContext(source,context);
  return {context,buttons,entries,tab:()=>tab,run:s=>vm.runInContext(s,context)};
}
test('Back at the initial dashboard stays put and never opens the library',()=>{
  const h=harness();h.run('appBack();appBack();appBack()');
  assert.equal(h.tab(),'home');assert.equal(h.entries.length,1);
  assert.ok(h.buttons.every(b=>b.disabled));
});
test('Back unwinds settings, library and dashboard, then stops without adding history',()=>{
  const h=harness();h.run("switchTab('quotes');switchTab('setup');appBack()");
  assert.equal(h.tab(),'quotes');h.run('appBack()');assert.equal(h.tab(),'home');
  h.run('appBack();appBack()');assert.equal(h.tab(),'home');
  assert.equal(h.entries.length,3);assert.ok(h.buttons.every(b=>b.disabled));
});
test('Back through a quote returns to the preceding page without regenerating',()=>{
  const h=harness();h.run("switchTab('builder');nextStep(2);nextStep(3);appBack()");
  assert.equal(h.context.currentBuilderStep,2);h.run('appBack()');
  assert.equal(h.context.currentBuilderStep,1);h.run('appBack()');assert.equal(h.tab(),'home');
});

