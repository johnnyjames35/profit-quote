const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stageFor(days,activated){
  if(days>=10&&days<14)return 'follow_up';
  if(days>=7&&days<10)return 'expired';
  if(days>=6&&days<7)return 'expiry_reminder';
  if(days>=3&&days<6)return 'mid_trial';
  if(days>=0&&days<3&&activated)return 'first_quote';
  return null;
}
function message(stage,name){
  const content={
    welcome:['Your 7-day ProfitQuote trial starts here','Your 7-day unlimited trial is ready. No card is required and nothing is charged automatically. Start with a real job: include measurements, access, labour time, waste and materials. Review the figures before sending your quote.'],
    first_quote:['Your first quote: check the costs that are easy to miss','Before you send your quote, check collection time, waste disposal and repeat visits. A small allowance for each can protect your profit. Your saved quotes remain available after the trial.'],
    mid_trial:['A useful margin check for your next quote','Markup and margin are different. Adding 20% to a £1,000 cost gives a £1,200 selling price and a 16.7% margin. For a 20% margin, the selling price is £1,250. Check labour, overheads and contingency before reviewing the final margin.'],
    expiry_reminder:['Your ProfitQuote trial ends tomorrow','Your unlimited trial ends within the next 24 hours. No payment will be taken automatically. Finish a real quote today and decide which option suits you.'],
    expired:['Your trial has ended — choose how you keep quoting','Your free trial has ended. Your saved quotes remain available. Choose an option when you need to create another quote.'],
    follow_up:['Still have a job to price?','If you only need an occasional quote, you can pay £5 when you need one. Check labour, materials, overheads, access and waste before pricing the next job. Reply if you got stuck — I’m happy to help.']
  }[stage];
  return {subject:content[0],html:`<p>Hi ${escape(name)},</p><p>${content[1]}</p><p>After the trial, choose <strong>£5 for one quote</strong>, <strong>£19/month Starter for 6 quotes per billing month</strong>, or <strong>£29/month Pro for unlimited quotes</strong>. No setup fee. Subscriptions renew monthly until cancelled.</p><p><a href="https://profitquote.co.uk/dashboard?subscribe=1">Open ProfitQuote</a> · <a href="https://profitquote.co.uk/pricing-profit-checklist">Free pricing checklist</a></p><p>John James<br>ProfitQuote</p>`};
}
module.exports={stageFor,message};
