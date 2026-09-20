// Admin-only controls; every request is authenticated again by the server.
async function manageTradeBundle(id) {
  const headers={'Content-Type':'application/json'};
  const token=sessionStorage.getItem('pq_admin_token');
  if(token)headers.Authorization='Bearer '+token;
  const base='/api/admin/users/'+encodeURIComponent(id)+'/bundle';
  const request=async(path,body)=>{
    const response=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
    if(!response.ok){let error;try{error=(await response.json()).error;}catch(_){}throw new Error(error || 'Please sign in to the admin page again.');}
    return response.json();
  };
  try {
    const current=await request('');
    if(current){
      alert('Trade Toolkit subscription: '+current.subscription_id+'\nStripe status: '+current.stripe_status+'\nAccess: '+(current.enabled?'active until '+new Date(current.valid_until).toLocaleString('en-GB'):'not active')+'\n\nManage cancellation in Stripe. All three linked apps check it every minute.\n'+(current.warning || ''));
      if(!['canceled','incomplete_expired'].includes(current.stripe_status) || !confirm('The old bundle has ended. Link an agreed replacement subscription?'))return;
    }
    const customerId=prompt('Trade Toolkit: enter the Stripe customer reference (cus_…). First we check existing subscriptions. No customer will be charged.');
    if(!customerId)return;
    const check=await request('/check',{customerId:customerId.trim()});
    const summary=check.customerName+' — '+check.email+'\n'+check.existing.map(s=>s.id+': '+s.status+', ends '+(s.endsAt || 'unknown')).join('\n');
    if(check.blockers.length){alert(summary+'\n\nBefore switching:\n'+check.blockers.join('\n')+'\n\nNo changes made. Resolve these in Stripe and check again.');return;}
    alert(summary+'\n\n'+(check.earliestChargeAt?'Set the bundle trial end no earlier than '+new Date(check.earliestChargeAt).toLocaleString('en-GB')+' so existing time is honoured.':'No open standalone subscriptions found. Preserve the customer’s promised free offers when arranging the start date.')+'\n\nCreate the agreed £49/month bundle in Stripe only after customer consent. If it already exists, link it next.');
    const subscriptionId=prompt('Enter the agreed Trade Toolkit subscription reference (sub_…). Cancel to finish this pre-billing check without linking.');
    if(!subscriptionId)return;
    const body={customerId:customerId.trim(),subscriptionId:subscriptionId.trim()};
    const preview=await request('',body);
    if(!confirm('Link this app account to Trade Toolkit £49/month?\n\n'+preview.customerName+' — '+preview.email+'\n'+preview.subscriptionId+'\nAccess until: '+(preview.validUntil || 'not active')+'\n\nConfirm you have verified this is the correct customer. This grants access only; it does not create or cancel any charge. Link the same subscription in the other two apps.'))return;
    await request('',{...body,confirm:true});
    alert('Bundle linked. Stripe now controls this app’s bundle access. Complete the other two apps and verify all three dashboards.');
    location.reload();
  }catch(error){alert(error.message);}
}
