const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const slugs=require('../utils/commercial-pages');
const root=path.join(__dirname,'..');

test('commercial URLs serve crawlable HTML, canonical redirects and isolated 404s', async t=>{
 const app=express();app.use(require('../routes/commercial-pages'));app.use(express.static(path.join(root,'public')));app.use((req,res)=>res.sendStatus(404));
 const server=app.listen(0); t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 const titles=new Set(),descriptions=new Set();
 for(const slug of slugs){
  const res=await fetch(base+'/'+slug);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/html/);
  const html=await res.text();assert.equal((html.match(/<h1>/g)||[]).length,1);
  assert.ok(html.includes('href="https://profitquote.co.uk/'+slug+'"'));
  titles.add(html.match(/<title>(.*?)<\/title>/)[1]);descriptions.add(html.match(/name="description" content="(.*?)"/)[1]);
  const data=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(data['@graph'].find(x=>x['@type']==='SoftwareApplication').offers.price,'37.00');
  assert.match(html,/\/dashboard\?try=1&amp;source=/);assert.match(html,/index, follow/);
  assert.ok(fs.readFileSync(path.join(root,'public/sitemap.xml'),'utf8').includes('https://profitquote.co.uk/'+slug));
  for(const suffix of ['.html','/']){
   const redirect=await fetch(base+'/'+slug+suffix+'?utm_source=test',{redirect:'manual'});
   assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/'+slug+'?utm_source=test');
  }
  const head=await fetch(base+'/'+slug,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const match of html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)){
   const url=match[1].replaceAll('&amp;','&');if(url.startsWith('/dashboard'))continue;
   const linked=await fetch(base+url);assert.equal(linked.status,200,slug+' broken link '+url);
  }
 }
 assert.equal(titles.size,5);assert.equal(descriptions.size,5);
 for(const url of ['/not-a-page','/quoting-software-for-roofers','/api/unknown'])assert.equal((await fetch(base+url)).status,404);
});

test('existing entry pages link to the commercial pages and app remains excluded from sitemap',()=>{
 for(const file of ['index.html','knowledge-centre.html']){
  const s=fs.readFileSync(path.join(root,'public',file),'utf8');
  for(const slug of slugs)assert.ok(s.includes('href="/'+slug+'"'),file+' missing '+slug);
 }
 for(const file of ['stop-underquoting-jobs.html','how-to-price-labour-correctly.html','how-to-calculate-construction-overheads.html'])assert.match(fs.readFileSync(path.join(root,'public',file),'utf8'),/href="\/quoting-software-for-/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'public/sitemap.xml'),'utf8'),/dashboard|admin/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'public/robots.txt'),'utf8'),/Disallow: \/dashboard/);
});
