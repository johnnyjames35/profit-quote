'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>Number.isFinite(value)?value.toLocaleString('en-GB'):'Unavailable';
const ok=source=>source?.status==='connected';
let data=null,selected='profitquote',busy=false;
const ukToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
function token(){return sessionStorage.getItem('pq_admin_token')||'';}
function clearFigures(){
  data=null;$('rows').innerHTML='';$('health').innerHTML='';$('connectionCards').innerHTML='';
  ['sessions','clicks','signups','registered'].forEach(id=>$(id).textContent='—');
  $('detailMetrics').innerHTML='';$('productNote').textContent='Load figures to inspect sources.';$('comparison').textContent='';$('sourceNotes').textContent='';$('export').disabled=true;
}
function showLogin(message='') {clearFigures();$('loginPanel').hidden=false;$('dashboard').hidden=true;$('state').textContent='Sign in required';$('loginError').textContent=message;}
function showDashboard() {$('loginPanel').hidden=true;$('dashboard').hidden=false;}
function setPeriod(){
  const v=$('preset').value,today=ukToday();$('start').max=today;$('end').max=today;
  if(v==='custom')return;
  const end=v==='today'?today:shift(today,v==='settled'?-3:-1);
  $('end').value=end;$('start').value=shift(end,-((v==='settled'?7:v==='today'?1:Number(v))-1));
}
function sumCard(source,key,id,note){
  const good=data.businesses.filter(b=>ok(b[source]));
  $(id).textContent=good.length?fmt(good.reduce((n,b)=>n+(source==='app'?b[source][key]:b[source].current[key]),0)):'Unavailable';
  $(id+'Note').textContent=(good.length===4?'4/4 sources. ':good.length+'/4 sources only — partial sum. ')+note;
}
const delta=(source,key)=>ok(source)?'Previous: '+fmt(source.previous[key])+' · change '+(source.current[key]-source.previous[key]>0?'+':'')+fmt(source.current[key]-source.previous[key]):'No comparison available';
function pill(source){return '<span class="pill '+(ok(source)?'good':'warn')+'">'+(ok(source)?'Connected':'Unavailable')+'</span>';}
function render(){
  if(!data)return;
  sumCard('ga4','sessions','sessions','Cross-site sessions, not unique people.');
  sumCard('search','clicks','clicks','Finalized search reports; recent days can lag.');
  sumCard('app','registrations','signups','Accounts + workspaces, not verified customers.');
  sumCard('app','registered','registered','Currently existing records, not a period total.');
  const list=data.businesses.filter(b=>b.name.toLowerCase().includes($('filter').value.toLowerCase()));
  if(list.length&&!list.some(b=>b.id===selected))selected=list[0].id;
  $('rows').innerHTML=list.length?list.map(b=>'<tr class="'+(b.id===selected?'selected':'')+'"><td><button class="detail-link appname" data-product="'+b.id+'">'+esc(b.name)+'</button><div class="fine">'+esc(b.host)+'</div></td><td class="num">'+fmt(ok(b.ga4)?b.ga4.current.users:null)+'</td><td class="num">'+fmt(ok(b.ga4)?b.ga4.current.sessions:null)+'<div class="change">'+esc(delta(b.ga4,'sessions'))+'</div></td><td class="num">'+fmt(ok(b.search)?b.search.current.clicks:null)+'<div class="change">'+esc(delta(b.search,'clicks'))+'</div></td><td class="num">'+fmt(ok(b.app)?b.app.registrations:null)+'</td><td class="num">'+fmt(ok(b.app)?b.app.registered:null)+'</td><td class="num">'+fmt(ok(b.app)?b.app.activity:null)+'<div class="change">'+esc(b.app.activityLabel||'App records unavailable')+'</div></td></tr>').join(''):'<tr><td colspan="7" class="empty">No matching business.</td></tr>';
  document.querySelectorAll('[data-product]').forEach(el=>el.onclick=()=>{selected=el.dataset.product;render();});
  const b=data.businesses.find(b=>b.id===selected)||data.businesses[0];
  $('detailName').textContent=b.name;$('adminLink').href=b.admin;
  const metrics=[['GA4 page views',ok(b.ga4)?b.ga4.current.views:null],['Engaged sessions',ok(b.ga4)?b.ga4.current.engaged:null],['Search impressions',ok(b.search)?b.search.current.impressions:null],['Search average position',ok(b.search)&&b.search.current.position!==null?Number(b.search.current.position.toFixed(1)):null]];
  $('detailMetrics').innerHTML=metrics.map(([label,value])=>'<div><span class="label">'+label+'</span><strong>'+fmt(value)+'</strong></div>').join('');
  $('productNote').textContent=ok(b.app)?b.app.note:'App records are unavailable. Traffic alone cannot establish whether anyone signed up.';
  $('comparison').textContent='Selected: '+data.window.start+' to '+data.window.end+'. Comparison: '+data.previous.start+' to '+data.previous.end+'. '+(ok(b.ga4)?delta(b.ga4,'sessions')+'. ':'')+(ok(b.search)?delta(b.search,'clicks')+'.':'');
  $('health').innerHTML=[['GA4 traffic',b.ga4],['Google search',b.search],['App database',b.app]].map(([label,s])=>'<div><span>'+label+'</span>'+pill(s)+'</div>').join('');
  $('sourceNotes').textContent='Timezones: GA4 '+(b.ga4.timezone||'unavailable')+'; Search Console Pacific; app records London. '+(ok(b.app)?'Excluded known test addresses: '+b.app.exclusions.knownTestAddresses+'. '+(b.app.exclusions.adminAccounts?'Admin accounts excluded. ':''):'')+'Traffic may include owner activity.';
  $('connectionCards').innerHTML=data.businesses.map(b=>'<article class="card"><h3>'+esc(b.name)+'</h3>'+[['GA4',b.ga4],['Search Console',b.search],['App records',b.app]].map(([label,s])=>'<div class="status-grid"><div><span>'+label+'</span>'+pill(s)+'</div><p class="fine">'+esc(ok(s)?'Retrieved '+new Date(s.fetchedAt).toLocaleString('en-GB'):s.error||'Source unavailable')+'</p></div>').join('')+'<p class="fine">'+esc(b.app.note||'No app counts are inferred from traffic.')+'</p><p><a href="'+esc(b.admin)+'" target="_blank" rel="noopener noreferrer">Open '+esc(b.name)+' admin ↗</a></p></article>').join('');
}
async function load(){
  if(busy)return;
  if(!token()){showLogin();return;}
  if(!$('dates').reportValidity())return;
  busy=true;$('refresh').disabled=true;$('state').textContent='Loading sources…';$('updated').textContent='Retrieving traffic, search and app counts…';
  // Clear the previous range immediately so a failed refresh cannot look fresh.
  clearFigures();showDashboard();
  try{
    const response=await fetch('/api/admin/portfolio-dashboard?'+new URLSearchParams({start:$('start').value,end:$('end').value}),{headers:{Authorization:'Bearer '+token()},cache:'no-store',signal:AbortSignal.timeout(65000)});
    if(response.status===401){sessionStorage.removeItem('pq_admin_token');showLogin('Please sign in again.');return;}
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||'Unable to load dashboard.');
    if(!Array.isArray(body.businesses)||body.businesses.length!==4)throw new Error('Unexpected dashboard response.');
    data=body;render();$('export').disabled=false;
    const connected=data.businesses.reduce((n,b)=>n+[b.ga4,b.search,b.app].filter(ok).length,0);
    $('state').textContent=connected===12?'Connected · read-only':connected+'/12 sources · partial';
    $('updated').textContent='Retrieved '+new Date(data.generatedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})+' UK · '+data.window.start+' to '+data.window.end+' · '+(data.cached?'Server cache (up to 60 seconds).':'Fresh source queries.')+' Recent Google days may be incomplete.';
  }catch(e){$('state').textContent='Refresh failed';$('updated').textContent=e.name==='TimeoutError'?'The request took too long. Please refresh again.':e.message;}
  finally{busy=false;$('refresh').disabled=false;}
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();$('loginButton').disabled=true;$('loginError').textContent='';
  try{
    const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value}),signal:AbortSignal.timeout(20000)});
    const body=await r.json();$('password').value='';
    if(!r.ok||!body.token)throw new Error('Incorrect password or login unavailable.');
    sessionStorage.setItem('pq_admin_token',body.token);showDashboard();await load();
  }catch(e){$('loginError').textContent=e.message;}
  finally{$('loginButton').disabled=false;}
};
$('signout').onclick=()=>{sessionStorage.removeItem('pq_admin_token');showLogin();};
$('dates').onsubmit=e=>{e.preventDefault();load();};
$('preset').onchange=()=>{setPeriod();if($('preset').value!=='custom')load();};
['start','end'].forEach(id=>$(id).onchange=()=>$('preset').value='custom');
$('filter').oninput=render;
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==button.dataset.view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));});
$('export').onclick=()=>{
  if(!data)return;
  const rows=[['Business','Start','End','GA4 status','GA4 users','GA4 sessions','Search status','Search clicks','Search impressions','App status','New registrations','Registered now','Activity','Activity definition','Retrieved at']];
  data.businesses.forEach(b=>rows.push([b.name,data.window.start,data.window.end,b.ga4.status,ok(b.ga4)?b.ga4.current.users:'unavailable',ok(b.ga4)?b.ga4.current.sessions:'unavailable',b.search.status,ok(b.search)?b.search.current.clicks:'unavailable',ok(b.search)?b.search.current.impressions:'unavailable',b.app.status,ok(b.app)?b.app.registrations:'unavailable',ok(b.app)?b.app.registered:'unavailable',ok(b.app)?b.app.activity:'unavailable',b.app.activityLabel||'unavailable',data.generatedAt]));
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='cambrian-dashboard-'+data.window.end+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
setPeriod();if(token()){showDashboard();load();}else showLogin();
