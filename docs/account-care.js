'use strict';
(async()=>{
 const state=await window.FungoCommerce.ready;if(!state?.user)return;
 const host=document.getElementById('customer-care');if(!host)return;host.hidden=false;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const acknowledgement=text=>{const label=el('label');label.className='check';const input=el('input');input.type='checkbox';label.append(input,el('span',text));return {label,input};};
 const date=value=>new Date(value).toLocaleString('it-IT',{dateStyle:'medium',timeStyle:'short'});
 const labels={privacy:'Dati personali',deletion:'Cancellazione account',withdrawal:'Recesso o rimborso',support:'Assistenza'};
 const status=document.getElementById('care-status');
 async function api(path,data){const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});const result=await r.json();if(!r.ok)throw new Error(result.error||'Operazione non riuscita.');return result;}
 async function action(button,fn){button.disabled=true;status.textContent='';try{await fn();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}}
 async function load(){
  const [orders,requests]=await Promise.all([api('orders'),api('requests')]);
  const list=document.getElementById('order-list'),select=document.getElementById('request-order');list.replaceChildren();select.replaceChildren(new Option('Nessun ordine specifico',''));
  if(!orders.orders.length)list.append(el('p','Non hai ancora effettuato acquisti.'));
  for(const order of orders.orders){
   const row=el('article');row.className='care-item';
   const title=el('strong',`${order.days} giorni · ${(order.amount/100).toFixed(2).replace('.',',')} €${order.mode==='test'?' · simulazione':''}`);
   row.append(title,el('p',order.revoked?'Pass revocato: consulta la richiesta o contatta l’assistenza.':order.paid_at?`Pagamento confermato. Accesso fino al ${date(order.access_end)}.`:'Pagamento non confermato: nessun pass attivato per questo ordine.'));
   row.append(el('p','Riferimento: '+order.id));
   if(order.paid_at){select.append(new Option(`${order.days} giorni · ${date(order.paid_at)} · ${order.id.slice(0,8)}`,order.id));if(order.document_id){const link=el('a','Scarica conferma e condizioni');link.href='/api/orders/'+encodeURIComponent(order.id)+'/confirmation';link.setAttribute('download','');row.append(link);}else row.append(el('p','Per la conferma di questo ordine precedente contatta l’assistenza.'));}
   list.append(row);
  }
  const requestList=document.getElementById('request-list');requestList.replaceChildren();
  for(const r of requests.requests){const row=el('article');row.className='care-item';row.append(el('strong',`${labels[r.kind]} · ${r.resolved_at?'gestita':'ricevuta'}`),el('p',`Riferimento ${r.id} · ${date(r.created_at)}`));if(r.resolution)row.append(el('p',r.resolution));requestList.append(row);}
  if(state.user.isOwner)await owner();
 }
 async function owner(){
  const panel=document.getElementById('owner-care');panel.hidden=false;
  const data=await api('owner/care'),list=document.getElementById('owner-care-list');list.replaceChildren();
  list.append(el('p',`${data.requests.length} richieste aperte · ${data.confirmations.length} conferme da inviare (incluse simulazioni).`));
  for(const item of data.confirmations){const row=el('article');row.className='care-item';row.append(el('strong',`${item.mode==='test'?'Collaudo':'Acquisto reale'} · ${item.email}`),el('p','Ordine '+item.id));const link=el('a','Scarica email con conferma allegata');link.href='/api/owner/orders/'+encodeURIComponent(item.id)+'/email';link.setAttribute('download','');const sentAck=acknowledgement('Ho già inviato al cliente la conferma con le condizioni allegate.');const sent=el('button','Segna come inviata');sent.type='button';sent.className='link-button';sent.addEventListener('click',()=>action(sent,async()=>{if(!sentAck.input.checked)throw new Error('Conferma l’invio effettivo con la casella. Il pulsante non invia email.');await api('owner/confirmation-sent',{orderId:item.id,sent:true});await owner();}));const attachment=el('a','Scarica allegato per Gmail');attachment.href='/api/owner/orders/'+encodeURIComponent(item.id)+'/confirmation';attachment.setAttribute('download','');row.append(link,el('br'),attachment,sentAck.label,sent);list.append(row);}
  for(const item of data.requests){const row=el('article');row.className='care-item';row.append(el('strong',`${labels[item.kind]} · ${item.email}`),el('p',`Da gestire entro ${date(item.due_at)} · ${item.id}`),el('p',item.message||'Nessun messaggio aggiuntivo.'));const resolution=el('textarea');resolution.maxLength=2000;resolution.setAttribute('aria-label','Esito della richiesta '+item.id);resolution.placeholder='Esito da rendere visibile al richiedente. Niente note interne.';const doneAck=acknowledgement('Ho completato gli interventi e comunicato l’esito all’utente. La chiusura non esegue rimborsi o cancellazioni.');const done=el('button','Registra richiesta gestita');done.type='button';done.className='cta secondary';done.addEventListener('click',()=>action(done,async()=>{if(!doneAck.input.checked)throw new Error('Conferma con la casella di aver completato la gestione.');await api('owner/resolve-request',{id:item.id,resolution:resolution.value,completed:true});await load();}));row.append(resolution,doneAck.label,done);if(item.kind==='deletion'){const warning=el('p','Cancellazione irreversibile, solo per account senza ordini. Prima completa eventuale consegna dei dati e prepara la risposta.');const emailField=el('input');emailField.type='email';emailField.autocomplete='off';emailField.setAttribute('aria-label','Conferma email da cancellare '+item.id);emailField.placeholder='Digita '+item.email;const deleteAck=acknowledgement('Confermo la cancellazione definitiva dell’account richiesto.');const remove=el('button','Cancella account senza ordini');remove.type='button';remove.className='link-button';remove.addEventListener('click',()=>action(remove,async()=>{const email=emailField.value.trim();if(email!==item.email||!deleteAck.input.checked)throw new Error('Digita esattamente l’indirizzo e conferma la cancellazione definitiva.');await api('owner/delete-unused-account',{id:item.id,email,confirm:true});await load();status.textContent='Account cancellato. Comunica l’esito a '+item.email+'. Nessuna email è stata inviata automaticamente.';}));row.append(warning,emailField,deleteAck.label,remove);}list.append(row);}
 }
 document.getElementById('care-form').addEventListener('submit',e=>{e.preventDefault();action(e.submitter,async()=>{const form=e.currentTarget;const result=await api('requests',{kind:form.kind.value,orderId:form.orderId.value,message:form.message.value,confirm:form.confirm.checked});form.message.value='';form.confirm.checked=false;await load();status.textContent='Richiesta ricevuta. Riferimento: '+result.id+'. La gestione è manuale: questo invio non cancella l’account e non dispone un rimborso.';});});
 try{await load();}catch(error){status.textContent=error.message;}
})();
