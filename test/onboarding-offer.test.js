const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('commercial copy has no setup fee and the agreed three payment choices',()=>{
 for(const file of ['public/index.html','public/terms.html','utils/trial-message.js']){
  const s=fs.readFileSync(file,'utf8');assert.match(s,/£5/);assert.match(s,/£19/);assert.match(s,/£29/);assert.doesNotMatch(s,/£37|£49|£99/);
 }
});
