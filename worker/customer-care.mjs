import {DAY,PLANS,TERMS_VERSION} from './core.mjs';
import {isOwner} from './launch-progress.mjs';

const statement=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
export const safeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function monthDeadline(timestamp){
  const date=new Date(timestamp),day=date.getUTCDate();
  date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);
  const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,last));return date.getTime();
}
export function contractText(env){
 return `FungoMeter — condizioni ${TERMS_VERSION}
Gestore: ${env.SELLER_NAME||''}. ${env.SELLER_ADDRESS||''}.
Dati fiscali: ${env.SELLER_TAX_ID||'da completare prima delle vendite'}.
Assistenza: ${env.SUPPORT_EMAIL||''}.
Servizio: consultazione online di indici sperimentali delle condizioni ambientali per 11 specie o gruppi di funghi in Italia, per oggi e i successivi 7 giorni. Internet necessario. Preferiti salvati sul dispositivo, senza sincronizzazione. Il servizio non identifica funghi, non certifica commestibilità, sicurezza dei percorsi o diritto di raccolta e non garantisce ritrovamenti. Il punteggio non è una probabilità di raccolta.
Prova: 7 giorni dall'attivazione esplicita, senza carta e senza addebito alla scadenza.
Pass: 9,90 EUR per 90 giorni; 19,90 EUR per 365 giorni. Prezzi totali. Pagamento unico, nessun rinnovo automatico. Il periodo acquistato si aggiunge all'eventuale prova o pass ancora valido. Accesso attivato dopo la conferma verificata del pagamento.
Recesso: il consumatore può comunicare il recesso entro 14 giorni dalla conclusione del contratto scrivendo al gestore, con una dichiarazione inequivocabile che identifichi l'ordine. Il modulo è facoltativo. L'accesso immediato non comporta automaticamente la perdita del diritto. Nei casi previsti dalla legge, se l'esecuzione è iniziata su richiesta espressa del consumatore, può essere dovuto un importo proporzionale al servizio effettivamente fornito prima della comunicazione. L'eventuale perdita del diritto è applicabile soltanto quando ricorrono tutti i presupposti di legge. Non è offerta una garanzia aggiuntiva di rimborso volontario.
Rimborsi dovuti: con lo stesso mezzo di pagamento, senza costi aggiuntivi per il rimborso, nei termini di legge; per il recesso, entro 14 giorni dalla comunicazione, salvo i casi consentiti dalla legge.
Conformità: restano integri i diritti e i rimedi inderogabili per servizi digitali non conformi, inclusi ripristino della conformità, riduzione del prezzo o risoluzione quando ne ricorrano i presupposti. Per problemi o reclami scrivere al contatto di assistenza. Le previsioni hanno limiti scientifici, ma tali limiti non eliminano i diritti del consumatore.
Disponibilità: la data dei dati è indicata nella mappa. Nuove prove e acquisti sono sospesi quando i dati hanno oltre 36 ore. Nessuna mappa completa offline promessa.
Account: non condividere le credenziali e non usare account multipli per aggirare la durata della prova. Per accesso, rettifica, portabilità o cancellazione dei dati usare l'account o il contatto privacy. Informativa: ${env.APP_ORIGIN}/privacy.html.
Legge applicabile: italiana, senza privare il consumatore delle tutele inderogabili applicabili. Per le controversie del consumatore restano ferme le regole sul foro competente.
Modulo facoltativo di recesso: A ${env.SELLER_NAME||''}, ${env.SELLER_ADDRESS||''}, ${env.SUPPORT_EMAIL||''}. Comunico il recesso dal pass FungoMeter [piano], ordine [riferimento], acquistato il [data]. Nome e indirizzo del consumatore: [dati]. Email dell'account: [email]. Data: [data]. Firma solo se inviato su carta.
${env.PAYMENTS_MODE==='test'?'COLLAUDO: questo documento riguarda una simulazione e non un acquisto reale. I testi commerciali restano da completare con i dati fiscali e verificare prima del lancio.':''}`;
}
export async function snapshotOrder(env,order,user){
 const snapshot={version:1,termsVersion:order.terms_version,seller:{name:env.SELLER_NAME||'',address:env.SELLER_ADDRESS||'',taxId:env.SELLER_TAX_ID||'',email:env.SUPPORT_EMAIL||''},buyerEmail:user.email,plan:PLANS[order.plan]?.name||order.plan,amount:order.amount,currency:'EUR',days:order.days,mode:order.mode,acceptedAt:order.created_at,terms:contractText(env)};
 await statement(env,'INSERT OR IGNORE INTO order_documents(order_id,snapshot_json,created_at) VALUES(?,?,?)',order.id,JSON.stringify(snapshot),Date.now()).run();
}
export function confirmationHtml(order,document){
 const s=JSON.parse(document.snapshot_json),date=t=>new Date(t).toLocaleString('it-IT',{timeZone:'Europe/Rome'});
 return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FungoMeter — conferma ${safeText(order.id)}</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:40px auto;padding:0 20px;color:#243b2a}pre{white-space:pre-wrap;font:inherit}h1{line-height:1.2}</style><h1>${order.mode==='test'?'Conferma di collaudo':'Conferma di acquisto'} FungoMeter</h1><p>Ordine ${safeText(order.id)} · ${safeText(date(order.paid_at))}</p><p>${safeText(s.buyerEmail)}<br>${safeText(s.plan)} · ${(s.amount/100).toFixed(2)} EUR · pagamento unico, senza rinnovo</p><p>Accesso dal ${safeText(date(order.access_start))} al ${safeText(date(order.access_end))}.</p><h2>Condizioni accettate</h2><p>Versione ${safeText(s.termsVersion)}, accettazione del ${safeText(date(s.acceptedAt))}.</p><pre>${safeText(s.terms)}</pre><p>Questa conferma non è una fattura fiscale. Conserva il file; eventuali rimborsi o contestazioni successivi possono modificare lo stato del pass, consultabile nell'account.</p></html>`;
}
export function emailDraft(order,document){
 const s=JSON.parse(document.snapshot_json),boundary='fungometer-'+order.id.replace(/[^a-zA-Z0-9-]/g,''),encode=text=>btoa(String.fromCharCode(...new TextEncoder().encode(text))).match(/.{1,76}/g).join('\r\n');
 // Sender and recipient originate from verified, single-address fields. Never allow header injection.
 const clean=value=>String(value).replace(/[\r\n]/g,'');
 return `X-Unsent: 1\r\nTo: ${clean(s.buyerEmail)}\r\nFrom: ${clean(s.seller.email)}\r\nSubject: Conferma ordine FungoMeter ${clean(order.id)}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encode(`Ciao,\nconfermiamo il tuo ordine FungoMeter ${order.id}. In allegato trovi i dettagli dell'accesso e le condizioni accettate, da conservare.\nPer assistenza o richieste relative all'ordine rispondi a questa email.\nFungoMeter\n${s.seller.name}\n${s.seller.address}\n${order.mode==='test'?'COLLAUDO: nessun addebito reale.':''}`)}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Disposition: attachment; filename="conferma-fungometer.html"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encode(confirmationHtml(order,document))}\r\n--${boundary}--\r\n`;
}
export async function customerOrders(env,userId){
 return (await statement(env,`SELECT o.id,o.plan,o.amount,o.days,o.mode,o.created_at,o.paid_at,o.access_start,o.access_end,o.revoked,d.order_id AS document_id,d.confirmation_sent_at FROM orders o LEFT JOIN order_documents d ON d.order_id=o.id WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 100`,userId).all()).results;
}

export async function careApi(request,env,path,user,{json,fail,body,limit}){
 if(path==='/api/orders'&&request.method==='GET')return json({orders:await customerOrders(env,user.id)});
 if(path==='/api/requests'&&request.method==='GET')return json({requests:(await statement(env,'SELECT id,kind,order_id,message,created_at,due_at,resolved_at,resolution FROM service_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user.id).all()).results});
 if(path==='/api/requests'&&request.method==='POST'){
  const input=await body(request),kind=input.kind,message=String(input.message||'').trim();
  if(!['privacy','deletion','withdrawal','support'].includes(kind)||message.length>2000)fail(400,'Scegli il tipo di richiesta e usa al massimo 2.000 caratteri.');
  let order=null;if(input.orderId){order=await statement(env,'SELECT id,paid_at FROM orders WHERE id=? AND user_id=?',String(input.orderId),user.id).first();if(!order)fail(404,'Ordine non trovato.');}
  if(kind==='withdrawal'&&!order?.paid_at)fail(400,'Seleziona un acquisto confermato.');
  if(kind==='deletion'){
   if(input.confirm!==true)fail(400,'Conferma di voler richiedere la cancellazione.');
   const pending=await statement(env,"SELECT id FROM service_requests WHERE user_id=? AND kind='deletion' AND resolved_at IS NULL",user.id).first();
   if(pending)return json({id:pending.id,received:true});
  }
  await limit(env,'request:'+user.id,5,DAY);
  const now=Date.now(),id=crypto.randomUUID();
  const due=['privacy','deletion'].includes(kind)?monthDeadline(now):now+(kind==='withdrawal'?14:7)*DAY;
  await statement(env,'INSERT OR IGNORE INTO service_requests(id,user_id,kind,order_id,message,created_at,due_at) VALUES(?,?,?,?,?,?,?)',id,user.id,kind,order?.id||null,message,now,due).run();
  const saved=kind==='deletion'?await statement(env,"SELECT id FROM service_requests WHERE user_id=? AND kind='deletion' AND resolved_at IS NULL",user.id).first():{id};
  return json({id:saved.id,received:true});
 }
 const documentMatch=path.match(/^\/api\/orders\/([a-zA-Z0-9-]+)\/confirmation$/);
 if(documentMatch&&request.method==='GET'){
  const order=await statement(env,'SELECT * FROM orders WHERE id=? AND user_id=? AND paid_at IS NOT NULL',documentMatch[1],user.id).first();
  const document=order&&await statement(env,'SELECT * FROM order_documents WHERE order_id=?',order.id).first();
  if(!document)fail(404,'Conferma non disponibile per questo ordine. Contatta l’assistenza.');
  return new Response(confirmationHtml(order,document),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="conferma-fungometer.html"','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'Vary':'Cookie'}});
 }
 if(!path.startsWith('/api/owner/'))return null;
 if(!isOwner(user,env))fail(403,'Accesso riservato al gestore.');
 if(path==='/api/owner/care'&&request.method==='GET')return json({
  requests:(await statement(env,'SELECT r.*,u.email FROM service_requests r JOIN users u ON u.id=r.user_id WHERE r.resolved_at IS NULL ORDER BY r.due_at LIMIT 100').all()).results,
  confirmations:(await statement(env,'SELECT o.id,o.mode,o.paid_at,u.email FROM order_documents d JOIN orders o ON o.id=d.order_id JOIN users u ON u.id=o.user_id WHERE o.paid_at IS NOT NULL AND d.confirmation_sent_at IS NULL ORDER BY o.paid_at LIMIT 100').all()).results
 });
 const draftMatch=path.match(/^\/api\/owner\/orders\/([a-zA-Z0-9-]+)\/(email|confirmation)$/);
 if(draftMatch&&request.method==='GET'){
  const order=await statement(env,'SELECT * FROM orders WHERE id=? AND paid_at IS NOT NULL',draftMatch[1]).first();
  const document=order&&await statement(env,'SELECT * FROM order_documents WHERE order_id=?',order.id).first();
  if(!document)fail(404,'Conferma non disponibile.');
  const html=draftMatch[2]==='confirmation';
  return new Response(html?confirmationHtml(order,document):emailDraft(order,document),{headers:{'Content-Type':html?'text/html; charset=utf-8':'message/rfc822','Content-Disposition':`attachment; filename="conferma-fungometer.${html?'html':'eml'}"`,'Cache-Control':'no-store','Vary':'Cookie','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}});
 }
 if(path==='/api/owner/confirmation-sent'&&request.method==='POST'){
  const input=await body(request);if(input.sent!==true)fail(400,'Conferma solo dopo aver inviato l’email con l’allegato.');
  const row=await statement(env,'UPDATE order_documents SET confirmation_sent_at=COALESCE(confirmation_sent_at,?) WHERE order_id=? AND EXISTS(SELECT 1 FROM orders WHERE id=order_id AND paid_at IS NOT NULL) RETURNING order_id',Date.now(),String(input.orderId||'')).first();
  if(!row)fail(404,'Ordine confermato non trovato.');return json({ok:true});
 }
 if(path==='/api/owner/resolve-request'&&request.method==='POST'){
  const input=await body(request),resolution=String(input.resolution||'').trim();
  if(input.completed!==true||resolution.length<10||resolution.length>2000)fail(400,'Descrivi l’esito e conferma di aver gestito la richiesta e informato l’utente.');
  const row=await statement(env,'UPDATE service_requests SET resolved_at=?,resolution=? WHERE id=? AND resolved_at IS NULL RETURNING id',Date.now(),resolution,String(input.id||'')).first();
  if(!row)fail(404,'Richiesta aperta non trovata.');return json({ok:true});
 }
 if(path==='/api/owner/delete-unused-account'&&request.method==='POST'){
  const input=await body(request),id=String(input.id||''),token=crypto.randomUUID();
  if(input.confirm!==true||typeof input.email!=='string')fail(400,'Conferma l’indirizzo dell’account da cancellare.');
  // D1 batch is transactional. Only users with an explicit open request and
  // no orders of any kind are eligible; billing records always need review.
  const selected='SELECT id FROM users WHERE privacy_delete_token=?';
  const result=await env.DB.batch([
   statement(env,`UPDATE users SET privacy_delete_token=? WHERE email=? AND lower(email)<>lower(?) AND EXISTS(SELECT 1 FROM service_requests r WHERE r.id=? AND r.user_id=users.id AND r.kind='deletion' AND r.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.user_id=users.id) RETURNING id`,token,input.email,env.SUPPORT_EMAIL||'',id),
   statement(env,`DELETE FROM login_codes WHERE email IN (SELECT email FROM users WHERE privacy_delete_token=?)`,token),
   statement(env,`DELETE FROM sessions WHERE user_id IN (${selected})`,token),
   statement(env,`DELETE FROM funnel_events WHERE user_id IN (${selected})`,token),
   statement(env,`DELETE FROM service_requests WHERE user_id IN (${selected})`,token),
   statement(env,'DELETE FROM users WHERE privacy_delete_token=?',token),
   statement(env,'INSERT INTO privacy_deletions(id,completed_at) SELECT ?,? WHERE changes()=1',token,Date.now())
  ]);
  if(!result[0].results?.length)fail(409,'Cancellazione non eseguita. Verifica richiesta e indirizzo: gli account con ordini e l’account del gestore richiedono una gestione separata.');
  return json({deleted:true});
 }
 return null;
}
