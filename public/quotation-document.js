(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.QuotationDocument=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
function render(currentQuoteData,currentUser){
  const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const customerName=escapeHtml(currentQuoteData.customer_name||'Customer');
  // Prioritise business_name from settings over personal name
  const bizName=escapeHtml(currentUser?.business_name||currentUser?.name||'');
  const bizPhone=escapeHtml(currentUser?.phone||'');
  const bizEmail=escapeHtml(currentUser?.contact_email||'');
  const bizTown=escapeHtml(currentUser?.town||'');
  const total=currentQuoteData.total||0;
  const desc=currentQuoteData.job_description||'';
  const qd=currentQuoteData.quote_data||{};
  const skipDisplay=qd.skipPrice??qd.skipCost??0;
  const scaffoldDisplay=qd.scaffoldPrice??qd.scaffoldCost??0;
  const contingencyDisplay=qd.contingencyPrice??qd.contingencyAmt??0;
  const date=new Date(currentQuoteData.created_at||Date.now()).toLocaleDateString('en-GB',{timeZone:'Europe/London'});
  const ref=escapeHtml(currentQuoteData.id?'QUO-'+currentQuoteData.id:currentQuoteData.reference);

  // Preserve exclusions and short measurements; never split a sentence at an action verb.
  const scope=qd.jobScope;
  const scopeText=scope?[scope.scale,scope.propertyType,scope.roomCount?'approximately '+scope.roomCount+' rooms':'',scope.details].filter(Boolean).join(' · '):'';
  const rawItems=Array.isArray(qd.scopeTasks)&&qd.scopeTasks.length
    ? [...qd.scopeTasks,scopeText?'Job scope: '+scopeText:'',qd.extraNotes?'Additional details: '+qd.extraNotes:''].filter(Boolean)
    : [desc];
  const bulletItems=rawItems.map(s=>`<li>${escapeHtml(s)}</li>`).join('');
  const safeClientItems=String(qd.clientSuppliedItems||'Materials agreed separately')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const clientSupplyNote=qd.clientSuppliesMaterials
    ? `<div class="reassurance"><strong>Client to supply:</strong> ${safeClientItems}. These items are not included in the quotation total.</div>`
    : '';

  // Business contact
  let contactParts=[];
  if(bizTown) contactParts.push(bizTown);
  if(bizPhone) contactParts.push(bizPhone);
  if(bizEmail) contactParts.push(bizEmail);

  // Includes checklist — only show what's in this quote
  const includesRows=[];
  if(qd.labour>0) includesRows.push('<div class="check-row"><span class="check-icon">✓</span> Labour</div>');
  if(qd.mats>0) includesRows.push('<div class="check-row"><span class="check-icon">✓</span> Materials</div>');
  if(skipDisplay>0) includesRows.push('<div class="check-row"><span class="check-icon">✓</span> '+(qd.skipQuantity>1?escapeHtml(qd.skipQuantity)+' Skips & Waste Disposal':'Skip & Waste Disposal')+'</div>');
  if(scaffoldDisplay>0) includesRows.push('<div class="check-row"><span class="check-icon">✓</span> Scaffolding</div>');
  if(contingencyDisplay>0) includesRows.push('<div class="check-row"><span class="check-icon">✓</span> Contingency</div>');

  const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Quotation — ${bizName}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#fff;color:#1a1a1a;font-size:13px;line-height:1.5;}
  .page{max-width:680px;margin:0 auto;padding:28px 32px;}
.header{border-bottom:3px solid #FFC20A;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start;}
  .brand{font-size:20px;font-weight:900;color:#1a1a1a;letter-spacing:-0.03em;}
.brand span{color:#FFC20A;}
  .brand-sub{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:2px;}
  .biz-right{text-align:right;}
  .biz-name{font-size:13px;font-weight:800;color:#1a1a1a;}
  .biz-contact{font-size:11px;color:#666;margin-top:3px;line-height:1.6;}
.badge{display:inline-block;background:#FFC20A;color:#10202B;font-size:10px;font-weight:800;padding:3px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;}
  .meta{font-size:11px;color:#888;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:8px 20px;}
  .greeting{font-size:14px;color:#1a1a1a;margin-bottom:4px;font-weight:600;}
  .intro{font-size:12px;color:#555;margin-bottom:16px;}
  .section-label{font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #eee;}
  .project-box{background:#fafafa;border:1px solid #eee;border-radius:6px;padding:10px 16px;margin-bottom:14px;}
  .project-box ul{padding-left:16px;}
  .project-box li{font-size:12px;color:#1a1a1a;padding:2px 0;}
  .total-box{background:#1a1a1a;border-radius:6px;padding:14px 20px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;}
.total-label{color:#FFC20A;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;}
  .total-amount{color:#fff;font-size:24px;font-weight:900;letter-spacing:-0.03em;}
  .two-col{display:flex;gap:16px;margin-bottom:14px;}
  .breakdown{flex:1;}
  .includes{flex:0 0 160px;}
  .breakdown-row{display:flex;justify-content:space-between;font-size:12px;color:#555;padding:5px 0;border-bottom:1px solid #f0f0f0;}
  .breakdown-row:last-child{border-bottom:none;font-weight:700;color:#1a1a1a;font-size:13px;}
  .check-row{font-size:12px;color:#1a1a1a;padding:3px 0;display:flex;align-items:center;gap:6px;}
  .check-icon{color:#22c55e;font-weight:900;}
.reassurance{font-size:11px;color:#555;background:#f9fafb;border-left:3px solid #FFC20A;padding:8px 12px;border-radius:0 4px 4px 0;margin-bottom:14px;}
  .sign-section{border-top:1px solid #eee;padding-top:14px;margin-bottom:14px;display:flex;gap:24px;}
  .sign-block{flex:1;}
  .sign-title{font-size:11px;font-weight:700;color:#1a1a1a;margin-bottom:10px;}
  .sign-line{font-size:11px;color:#555;margin-bottom:10px;display:flex;align-items:center;gap:6px;}
  .sign-underline{flex:1;border-bottom:1px solid #ccc;height:16px;}
  .footer{border-top:1px solid #eee;padding-top:10px;text-align:center;font-size:10px;color:#aaa;}
.shield{color:#FFC20A;}
  .page{overflow-wrap:anywhere;}
  .total-box,.sign-section,.breakdown-row{break-inside:avoid;}
  @media screen and (max-width:480px){
    .page{padding:20px 16px;}
    .header{gap:12px;flex-wrap:wrap;}
    .two-col{flex-direction:column;}
    .includes{flex:auto;}
  }
  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .page{padding:20px 28px;}
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="brand">Profit<span>Quote</span></div>
      <div class="brand-sub">Profit Protection Software</div>
    </div>
    <div class="biz-right">
      <div class="biz-name">${bizName}</div>
      <div class="biz-contact">${contactParts.join('<br>')}</div>
    </div>
  </div>

  <div class="badge">Quotation</div>
  <div class="meta">
    <span><b>Date:</b> ${date}</span>
    <span><b>Ref:</b> ${ref}</span>
    <span><b>Prepared for:</b> ${customerName}</span>
  </div>

  <p class="greeting">Dear ${customerName},</p>
  <p class="intro">Thank you for inviting me to provide a quotation for your project. Please find a full summary below.</p>

  <div class="section-label">📋 Project Scope</div>
  <div class="project-box"><ul>${bulletItems}</ul></div>

  <div class="total-box">
    <div class="total-label">Total Quotation</div>
    <div class="total-amount">£${Math.round(total).toLocaleString('en-GB')}</div>
  </div>

  <div class="two-col">
    <div class="breakdown">
      <div class="section-label">Breakdown</div>
      ${qd.labour>0?`<div class="breakdown-row"><span>Labour</span><span>£${Math.round(qd.labour).toLocaleString('en-GB')}</span></div>`:''}
      ${qd.mats>0?`<div class="breakdown-row"><span>Materials</span><span>£${Math.round(qd.mats).toLocaleString('en-GB')}</span></div>`:''}
      ${skipDisplay>0?`<div class="breakdown-row"><span>${qd.skipQuantity>1?escapeHtml(qd.skipQuantity)+' Skips / Waste Disposal':'Skip / Waste Disposal'}</span><span>£${Math.round(skipDisplay).toLocaleString('en-GB')}</span></div>`:''}
      ${scaffoldDisplay>0?`<div class="breakdown-row"><span>Scaffolding</span><span>£${Math.round(scaffoldDisplay).toLocaleString('en-GB')}</span></div>`:''}
      ${contingencyDisplay>0?`<div class="breakdown-row"><span>Contingency</span><span>£${Math.round(contingencyDisplay).toLocaleString('en-GB')}</span></div>`:''}
      ${qd.vatAmount>0?`<div class="breakdown-row"><span>VAT (${escapeHtml(qd.vatRate||20)}%)</span><span>£${Math.round(qd.vatAmount).toLocaleString('en-GB')}</span></div>`:''}
      <div class="breakdown-row"><span>Total</span><span>£${Math.round(total).toLocaleString('en-GB')}</span></div>
    </div>
    <div class="includes">
      <div class="section-label">Included</div>
      ${includesRows.join('')}
    </div>
  </div>

  <div class="reassurance">This quotation has been carefully prepared to include the agreed scope of work and all identified materials and labour requirements.</div>
  ${clientSupplyNote}

  <div class="sign-section">
    <div class="sign-block">
      <div class="sign-title">Customer Acceptance</div>
      <div class="sign-line">Signature <div class="sign-underline"></div></div>
      <div class="sign-line">Print name <div class="sign-underline"></div></div>
      <div class="sign-line">Date <div class="sign-underline"></div></div>
    </div>
    <div class="sign-block">
      <div class="sign-title">To Accept This Quote</div>
      <div style="font-size:11px;color:#555;line-height:1.7;">Simply sign and return this document,<br>or reply to the email to confirm.<br><br>${bizPhone?'📞 '+bizPhone+'<br>':''}${bizEmail?'✉ '+bizEmail:''}</div>
    </div>
  </div>

  <div class="footer">
    <span class="shield">🛡</span> Generated with ProfitQuote — Profit Protection Software for Tradespeople — profitquote.co.uk
  </div>
</div>
</body>
</html>`;

  return html;
}
function filename(quote){
  const name=String(quote.customer_name||'Customer').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'Customer';
  const date=new Date(quote.created_at||Date.now()).toLocaleDateString('en-GB',{timeZone:'Europe/London'}).replaceAll('/','-');
  return 'Quotation-'+name+'-'+date+'.pdf';
}
return {render,filename};
});
