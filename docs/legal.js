fetch('/api/me',{cache:'no-store'}).then(r=>r.json()).then(data=>{
  const s=data.seller;if(!s?.name||!s.email)return;
  document.getElementById('seller-details').textContent=[s.name,s.address,s.taxId,`Assistenza e privacy: ${s.email}`].filter(Boolean).join(' · ');
}).catch(()=>{});
