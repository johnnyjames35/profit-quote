document.getElementById('margin-form').addEventListener('submit',event=>{
 event.preventDefault();const cost=Number(document.getElementById('job-cost').value),margin=Number(document.getElementById('target-margin').value),out=document.getElementById('margin-result');
 if(!Number.isFinite(cost)||cost<0||!Number.isFinite(margin)||margin<0||margin>=100){out.textContent='Enter a cost of £0 or more and a margin between 0% and 99%.';return;}
 const price=cost/(1-margin/100),money=n=>n.toLocaleString('en-GB',{style:'currency',currency:'GBP'});
 out.textContent=`Selling price before VAT: ${money(price)}. Profit above the costs entered: ${money(price-cost)}. Target margin: ${margin}%.`;
});
