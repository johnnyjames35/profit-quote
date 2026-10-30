'use strict';
const {range,report}=require('./owner-report.cjs');
const {getOwnerDashboardGoogle}=require('./google-reporting');
const SITES=Object.freeze([
  {id:'profitquote',name:'ProfitQuote',host:'profitquote.co.uk',siteUrl:'https://profitquote.co.uk/',admin:'https://profitquote.co.uk/admin'},
  {id:'callback',name:'CallbackApp',host:'callbackapp.co.uk',siteUrl:'sc-domain:callbackapp.co.uk',admin:'https://callbackapp.co.uk/admin'},
  {id:'latepay',name:'LatePay',host:'latepay.co.uk',siteUrl:'sc-domain:latepay.co.uk',admin:'https://www.latepay.co.uk/admin'},
  {id:'kelvori',name:'Kelvori',host:'kelvori.co.uk',siteUrl:'https://kelvori.co.uk/',admin:'https://kelvori.co.uk/admin'}
]);
const shift=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
const cache=new Map(),pending=new Map();
const unavailable=()=>({status:'unavailable',error:'App records unavailable. Check the source connection.'});
async function getDashboard({pool,start,end,env=process.env,fetchImpl=fetch,google=getOwnerDashboardGoogle}) {
  const window=range(start,end);
  const previous={start:shift(start,-window.days),end:shift(start,-1)};
  const key=start+':'+end;
  if(cache.get(key)?.expires>Date.now()) return {...cache.get(key).value,cached:true};
  if(pending.has(key)) return pending.get(key);
  const work=(async()=>{
    const businesses=await Promise.all(SITES.map(async site=>{
      const appRequest=async()=>{
        try {
          if(site.id==='profitquote') return await report({query:(t,p)=>pool.query(t,p),kind:'profitquote',start,end,env});
          const token=env['DASHBOARD_'+site.id.toUpperCase()+'_TOKEN'];
          if(!token) return unavailable();
          const response=await fetchImpl('https://'+(site.id==='latepay'?'www.':'')+site.host+'/api/owner-report?'+new URLSearchParams({start,end}),{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
          if(!response.ok) return unavailable();
          const body=await response.json();
          if(body.kind!==site.id || body.status!=='connected' || body.window?.start!==start || body.window?.end!==end || ['registered','registrations','activity'].some(k=>!Number.isSafeInteger(body[k])||body[k]<0)) return unavailable();
          // Explicit field allowlist: no upstream personal details ever forwarded.
          return {status:body.status,kind:body.kind,window:body.window,timezone:body.timezone,fetchedAt:body.fetchedAt,registered:body.registered,registrations:body.registrations,activity:body.activity,unit:body.unit,activityLabel:body.activityLabel,exclusions:body.exclusions,note:body.note};
        }catch{return unavailable();}
      };
      const [googleResult,app]=await Promise.all([google({hostname:site.host,siteUrl:site.siteUrl,start,end,previousStart:previous.start,previousEnd:previous.end,env,fetchImpl}).catch(()=>({ga4:{status:'unavailable'},search:{status:'unavailable'}})),appRequest()]);
      return {id:site.id,name:site.name,host:site.host,admin:site.admin,...googleResult,app};
    }));
    const value={window,previous,generatedAt:new Date().toISOString(),cached:false,cacheSeconds:60,businesses};
    cache.set(key,{expires:Date.now()+60000,value});
    if(cache.size>24)cache.delete(cache.keys().next().value);
    return value;
  })();
  pending.set(key,work);
  try{return await work;}finally{pending.delete(key);}
}
module.exports={getDashboard,SITES};
