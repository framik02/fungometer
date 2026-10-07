import { DAY, PLANS, TERMS_VERSION, normalizeEmail, isLocal, entitlement, hmac, verifyStripeSignature, validatePaidSession } from './core.mjs';
import {googleApi,googleReady} from './google.mjs';
import {authAccessAllowed} from './auth-access.mjs';
import {isOwner,launchProgress} from './launch-progress.mjs';
import {careApi,snapshotOrder} from './customer-care.mjs';

const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
const fail = (status,message) => { throw new HttpError(status,message); };
const stmt = (env,sql,...args) => env.DB.prepare(sql).bind(...args);
const sessionCookie = (token, request, maxAge=30*86400) => `${new URL(request.url).protocol==='https:'?'__Host-fm':'fm'}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
async function body(request) {
  const text=await request.text();
  if (text.length>8192) fail(413,'Richiesta troppo grande.');
  try { const value=JSON.parse(text); if(!value || typeof value!=='object' || Array.isArray(value)) fail(400,'Richiesta non valida.'); return value; } catch { fail(400,'Richiesta non valida.'); }
}
function requireSecret(env) { if (!env.AUTH_SECRET || env.AUTH_SECRET.length<32) fail(503,'Accesso non ancora configurato.'); }
async function identity(request,env) {
  if (!env.DB || !env.AUTH_SECRET || env.AUTH_ENABLED!=='true') return null;
  const cookieName=new URL(request.url).protocol==='https:'?'__Host-fm':'fm';
  const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const user=await stmt(env,'SELECT u.*,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',await hmac(env.AUTH_SECRET,token),Date.now()).first();
  return user&&authAccessAllowed(env,user.email)?user:null;
}
async function access(user,env) {
  const paid = user ? await stmt(env,'SELECT MAX(access_end) AS until FROM orders WHERE user_id=? AND mode=? AND revoked=0 AND paid_at IS NOT NULL',user.id,env.PAYMENTS_MODE).first() : null;
  return entitlement(user,paid?.until);
}
async function limit(env,key,max,windowMs) {
  const bucket=Math.floor(Date.now()/windowMs);
  const hash=await hmac(env.AUTH_SECRET,`${key}:${bucket}`);
  const row=await stmt(env,'INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',hash,(bucket+1)*windowMs).first();
  if(row.count>max) fail(429,'Troppi tentativi. Riprova più tardi.');
}
function paymentsReady(env) {
  const mode=env.PAYMENTS_MODE;
  const key=env.STRIPE_SECRET_KEY||'';
  if(!['test','live'].includes(mode) || !new RegExp(`^(?:sk|rk${mode==='test'?'|rkcs':''})_${mode}_[A-Za-z0-9]+$`).test(key) || !env.STRIPE_WEBHOOK_SECRET) return false;
  // Temporary, claimable Stripe sandboxes are only for owner commissioning.
  if(key.startsWith('rkcs_')&&(env.AUTH_ACCESS!=='owner-test'||!(Date.parse(env.STRIPE_TEST_EXPIRES_AT)>Date.now())))return false;
  if(mode==='test'&&env.STRIPE_TEST_EXPIRES_AT&&!(Date.parse(env.STRIPE_TEST_EXPIRES_AT)>Date.now()))return false;
  return mode==='test' || (env.LIVE_SALES_READY==='true' && env.LICENSES_READY==='true' && env.PRIVATE_DATA_READY==='true'
    && env.SELLER_NAME && env.SELLER_ADDRESS && env.SELLER_TAX_ID && env.SUPPORT_EMAIL);
}
async function dataFresh(request,env) {
  const response=await env.ASSETS.fetch(new Request(new URL('/data/punteggi.json',request.url)));
  if(!response.ok) return false;
  const data=await response.json();
  const age=Date.now()-Date.parse(data.aggiornato);
  return Number.isFinite(age) && age>=-3600000 && age<36*3600000;
}
async function stripe(env,path,params,idempotencyKey) {
  const response=await fetch(`https://api.stripe.com/v1/${path}`,{
    method:params?'POST':'GET',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{}),
      ...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},
    ...(params?{body:new URLSearchParams(params)}:{})
  });
  if(!response.ok) fail(502,'Il servizio di pagamento non risponde. Riprova senza effettuare un secondo acquisto.');
  return response.json();
}
async function record(env,user,event) {
  if(!user?.analytics) return;
  await stmt(env,'INSERT OR IGNORE INTO funnel_events(user_id,event,day) VALUES(?,?,?)',user.id,event,new Date().toISOString().slice(0,10)).run();
}
async function applyPayment(session,env) {
  const order=await stmt(env,'SELECT * FROM orders WHERE session_id=?',session.id).first();
  if(!validatePaidSession(session,order)) fail(400,'Pagamento non corrispondente all’ordine.');
  // One atomic UPDATE computes both dates from the pre-update row. A repeated
  // webhook cannot extend access twice; concurrent purchases serialize in D1.
  const now=Date.now();
  await stmt(env,`UPDATE orders SET paid_at=?,payment_intent=?,
    access_start=MAX(?,COALESCE((SELECT MAX(access_end) FROM orders WHERE user_id=? AND mode=? AND revoked=0 AND paid_at IS NOT NULL),0),COALESCE((SELECT trial_ends_at FROM users WHERE id=?),0)),
    access_end=MAX(?,COALESCE((SELECT MAX(access_end) FROM orders WHERE user_id=? AND mode=? AND revoked=0 AND paid_at IS NOT NULL),0),COALESCE((SELECT trial_ends_at FROM users WHERE id=?),0))+days*?
    WHERE id=? AND paid_at IS NULL AND revoked=0`,now,session.payment_intent,now,order.user_id,order.mode,order.user_id,now,order.user_id,order.mode,order.user_id,DAY,order.id).run();
  const user=await stmt(env,'SELECT * FROM users WHERE id=?',order.user_id).first();
  await record(env,user,'purchase');
}
async function webhook(request,env) {
  const raw=await request.text();
  if(raw.length>262144) fail(413,'Evento troppo grande.');
  if(!await verifyStripeSignature(raw,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET)) fail(400,'Firma non valida.');
  let event; try { event=JSON.parse(raw); } catch { fail(400,'Evento non valido.'); }
  if(event.livemode!==(env.PAYMENTS_MODE==='live')) fail(400,'Ambiente Stripe errato.');
  if(await stmt(env,'SELECT id FROM webhook_events WHERE id=?',event.id).first()) return json({received:true});
  const object=event.data?.object;
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type) && object.payment_status==='paid') {
    // Retrieve canonical session and charge, including refunds/disputes that may
    // have arrived before checkout completion. Never trust the return URL.
    const canonical=await stripe(env,`checkout/sessions/${encodeURIComponent(object.id)}`);
    const intent=await stripe(env,`payment_intents/${encodeURIComponent(canonical.payment_intent)}`);
    const charge=intent.latest_charge ? await stripe(env,`charges/${encodeURIComponent(intent.latest_charge)}`) : null;
    if(!charge || charge.disputed || charge.refunded || charge.amount_refunded>0) {
      await stmt(env,'UPDATE orders SET revoked=1 WHERE session_id=?',canonical.id).run();
    } else await applyPayment(canonical,env);
  } else if(['charge.refunded','charge.dispute.created','charge.dispute.closed'].includes(event.type)) {
    // Conservative access suspension on any refund or dispute; seller reviews
    // partial refunds and won disputes before granting a replacement pass.
    const intent=object.payment_intent;
    if(typeof intent==='string') await stmt(env,'UPDATE orders SET revoked=1 WHERE payment_intent=?',intent).run();
  }
  await stmt(env,'INSERT OR IGNORE INTO webhook_events(id,received_at) VALUES(?,?)',event.id,Date.now()).run();
  return json({received:true});
}
async function api(request,env,path) {
  if(path==='/api/species' && request.method==='GET') {
    const response=await env.ASSETS.fetch(new Request(new URL('/data/punteggi.json',request.url)));
    if(!response.ok) fail(503,'Informazioni non disponibili.');
    const data=await response.json(); return json({specie:data.specie,regole:data.regole});
  }
  if(path==='/api/stripe/webhook' && request.method==='POST') return webhook(request,env);
  if(request.method==='POST' && request.headers.get('Origin')!==new URL(env.APP_ORIGIN).origin) fail(403,'Origine non autorizzata.');
  if(path.startsWith('/api/auth/google/'))return googleApi(request,env,path,{stmt,fail,json,body,limit,sessionCookie});
  const user=await identity(request,env);
  if(path==='/api/me' && request.method==='GET') return json({user:user?{email:user.email,analytics:Boolean(user.analytics),canTrial:!user.trial_started_at,isOwner:isOwner(user,env)}:null,
    access:await access(user,env),plans:PLANS,termsVersion:TERMS_VERSION,authEnabled:env.AUTH_ENABLED==='true',authProvider:env.AUTH_PROVIDER||'email',googleReady:googleReady(env),
    authRestricted:env.AUTH_ACCESS==='owner-test',paymentsReady:Boolean(paymentsReady(env)),paymentsMode:env.PAYMENTS_MODE,
    turnstileSiteKey:env.TURNSTILE_SITE_KEY||'',local:isLocal(request,env),
    seller:{name:env.SELLER_NAME||'',address:env.SELLER_ADDRESS||'',taxId:env.SELLER_TAX_ID||'',email:env.SUPPORT_EMAIL||''}});
  if(path==='/api/auth/request' && request.method==='POST') {
    if(env.AUTH_ACCESS&&env.AUTH_ACCESS!=='public')fail(403,'Accesso riservato al collaudo Google.');
    if(env.AUTH_PROVIDER==='google')fail(404,'Usa il pulsante Accedi con Google.');
    requireSecret(env);
    if(env.AUTH_ENABLED!=='true') fail(503,'La prova sarà disponibile a breve. Nessun dato account è stato salvato.');
    const input=await body(request);
    let email; try { email=normalizeEmail(input.email); } catch(e) { fail(400,e.message); }
    await limit(env,`email:${email}`,3,15*60000);
    await limit(env,`ip:${request.headers.get('CF-Connecting-IP')||'local'}`,10,3600000);
    if(!isLocal(request,env)) {
      if(!env.TURNSTILE_SECRET_KEY || !env.RESEND_API_KEY || !env.MAIL_FROM) fail(503,'Accesso email non ancora configurato.');
      const check=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:String(input.turnstileToken||'')})});
      const result=await check.json();
      if(!result.success || result.hostname!==new URL(env.APP_ORIGIN).hostname || result.action!=='login') fail(400,'Completa la verifica antispam.');
      // Keep room below Resend's free 100/day and 3,000/month quotas.
      // This budget is shared by all login addresses and cannot be reset by
      // changing IP or email. Count attempted sends conservatively.
      await limit(env,'mail:daily',80,DAY);
    }
    const id=crypto.randomUUID();
    const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
    await stmt(env,'INSERT INTO login_codes(id,email,code_hash,expires_at) VALUES(?,?,?,?)',id,email,await hmac(env.AUTH_SECRET,`${id}:${email}:${code}`),Date.now()+10*60000).run();
    if(isLocal(request,env)) return json({id,localCode:code});
    const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`login/${id}`},body:JSON.stringify({from:env.MAIL_FROM,to:[email],...(env.SUPPORT_EMAIL?{reply_to:env.SUPPORT_EMAIL}:{}),subject:'Il tuo codice di accesso FungoMeter',text:`Il tuo codice è ${code}. Scade fra 10 minuti. Se non hai richiesto l’accesso, ignora questa email. Non condividerlo con nessuno.`})});
    if(!sent.ok) { await stmt(env,'DELETE FROM login_codes WHERE id=?',id).run(); fail(503,'Invio email non riuscito. Riprova più tardi.'); }
    return json({id});
  }
  if(path==='/api/auth/verify' && request.method==='POST') {
    if(env.AUTH_ACCESS&&env.AUTH_ACCESS!=='public')fail(403,'Accesso riservato al collaudo Google.');
    if(env.AUTH_PROVIDER==='google')fail(404,'Usa il pulsante Accedi con Google.');
    requireSecret(env);
    if(env.AUTH_ENABLED!=='true') fail(503,'Accesso temporaneamente non disponibile.');
    const input=await body(request);
    if(typeof input.id!=='string' || !/^\d{6}$/.test(input.code||'')) fail(400,'Inserisci il codice di 6 cifre.');
    await limit(env,`verify:${request.headers.get('CF-Connecting-IP')||'local'}`,30,15*60000);
    const row=await stmt(env,'UPDATE login_codes SET attempts=attempts+1 WHERE id=? AND used=0 AND attempts<5 AND expires_at>? RETURNING *',input.id,Date.now()).first();
    if(!row) fail(400,'Codice scaduto o troppi tentativi. Richiedine uno nuovo.');
    const hash=await hmac(env.AUTH_SECRET,`${row.id}:${row.email}:${input.code}`);
    const consumed=await stmt(env,'UPDATE login_codes SET used=1 WHERE id=? AND used=0 AND code_hash=? RETURNING email',row.id,hash).first();
    if(!consumed) fail(400,'Codice non valido.');
    const id=crypto.randomUUID();
    await stmt(env,'INSERT OR IGNORE INTO users(id,email,created_at) VALUES(?,?,?)',id,row.email,Date.now()).run();
    const account=await stmt(env,'SELECT * FROM users WHERE email=?',row.email).first();
    const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
    await stmt(env,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await hmac(env.AUTH_SECRET,token),account.id,Date.now()+30*DAY).run();
    return json({ok:true},200,{'Set-Cookie':sessionCookie(token,request)});
  }
  if(!user) fail(401,'Accedi per continuare.');
  if(path==='/api/orders'||path.startsWith('/api/orders/')||path==='/api/requests'||path.startsWith('/api/owner/')){
    const response=await careApi(request,env,path,user,{json,fail,body,limit});if(response)return response;
  }
  if(path==='/api/account/export' && request.method==='GET') {
    const orders=await stmt(env,'SELECT id,plan,amount,days,mode,created_at,paid_at,access_start,access_end,revoked,terms_version FROM orders WHERE user_id=? ORDER BY created_at,id',user.id).all();
    const analytics=await stmt(env,'SELECT event,day FROM funnel_events WHERE user_id=? ORDER BY day,event',user.id).all();
    const requests=await stmt(env,'SELECT id,kind,order_id,message,created_at,due_at,resolved_at,resolution FROM service_requests WHERE user_id=? ORDER BY created_at',user.id).all();
    const confirmations=await stmt(env,'SELECT d.order_id,d.snapshot_json,d.created_at,d.confirmation_sent_at FROM order_documents d JOIN orders o ON o.id=d.order_id WHERE o.user_id=?',user.id).all();
    return json({version:1,exportedAt:new Date().toISOString(),
      account:{id:user.id,email:user.email,googleId:user.google_sub||null,createdAt:user.created_at,trialStartedAt:user.trial_started_at,trialEndsAt:user.trial_ends_at,analyticsConsent:Boolean(user.analytics)},
      orders:orders.results.map(order=>({...order,currency:'EUR'})),analytics:analytics.results,requests:requests.results,confirmations:confirmations.results.map(d=>({...d,snapshot_json:JSON.parse(d.snapshot_json)})),
      note:'Preferiti e selezioni sono salvati soltanto nel browser e non sono inclusi. Gli importi degli ordini sono espressi in centesimi. I messaggi di assistenza sono gestiti separatamente.'
    },200,{'Content-Disposition':'attachment; filename="fungometer-dati-account.json"','Vary':'Cookie'});
  }
  if(path==='/api/owner/launch' && request.method==='GET') {
    if(!isOwner(user,env)) fail(403,'Accesso riservato al gestore.');
    return json(await launchProgress(env));
  }
  if(path==='/api/logout' && request.method==='POST') {
    await stmt(env,'DELETE FROM sessions WHERE token_hash=?',user.token_hash).run();
    return json({ok:true},200,{'Set-Cookie':sessionCookie('',request,0)});
  }
  if(path==='/api/trial' && request.method==='POST') {
    const input=await body(request);
    if(input.termsVersion!==TERMS_VERSION) fail(400,'Leggi e accetta le condizioni aggiornate.');
    if(!await dataFresh(request,env)) fail(503,'Stiamo aggiornando i dati: la prova non è iniziata. Riprova più tardi.');
    const now=Date.now();
    await stmt(env,'UPDATE users SET trial_started_at=?,trial_ends_at=? WHERE id=? AND trial_started_at IS NULL',now,now+7*DAY,user.id).run();
    await record(env,user,'trial_start');
    return json({ok:true});
  }
  if(path==='/api/preferences' && request.method==='POST') {
    const input=await body(request);
    if(typeof input.analytics!=='boolean') fail(400,'Scelta non valida.');
    await stmt(env,'UPDATE users SET analytics=? WHERE id=?',Number(input.analytics),user.id).run();
    if(!input.analytics) await stmt(env,'DELETE FROM funnel_events WHERE user_id=?',user.id).run();
    return json({ok:true});
  }
  if(path==='/api/event' && request.method==='POST') {
    const input=await body(request);
    if(!['map_ready','cell_open','pricing_view','checkout_start'].includes(input.event)) fail(400,'Evento non valido.');
    await record(env,user,input.event); return json({ok:true});
  }
  if(path==='/api/checkout' && request.method==='POST') {
    if(!paymentsReady(env)) fail(503,'Gli acquisti non sono ancora disponibili. Nessun addebito effettuato.');
    const input=await body(request),plan=Object.hasOwn(PLANS,input.plan)?PLANS[input.plan]:null;
    if(!plan || input.termsVersion!==TERMS_VERSION || input.immediateAccess!==true) fail(400,'Scegli il pass e conferma le condizioni di acquisto.');
    if(!await dataFresh(request,env)) fail(503,'Aggiornamento dati in corso. Riprova più tardi: nessun addebito effettuato.');
    await limit(env,`checkout:${user.id}`,10,3600000);
    // The unique pending-order index serializes simultaneous clicks. Keep a
    // 24-hour Stripe expiry, with at least one hour left for API retries.
    // Do not replace still-payable sessions: wait until the full expiry.
    // Switching the owner's test account must not reuse Checkout links from
    // the old sandbox. This cutoff never affects live or already-paid orders.
    const testCutoff=env.PAYMENTS_MODE==='test'?Date.parse(env.STRIPE_TEST_RESET_BEFORE)||0:0;
    await stmt(env,'UPDATE orders SET checkout_closed=1 WHERE user_id=? AND plan=? AND mode=? AND paid_at IS NULL AND created_at<?',user.id,input.plan,env.PAYMENTS_MODE,Math.max(Date.now()-DAY,testCutoff)).run();
    await stmt(env,'INSERT OR IGNORE INTO orders(id,user_id,plan,amount,days,mode,created_at,terms_version) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),user.id,input.plan,plan.amount,plan.days,env.PAYMENTS_MODE,Date.now(),TERMS_VERSION).run();
    const saved=await stmt(env,'SELECT * FROM orders WHERE user_id=? AND plan=? AND mode=? AND paid_at IS NULL AND revoked=0 AND checkout_closed=0',user.id,input.plan,env.PAYMENTS_MODE).first();
    if(!saved) fail(409,'Pagamento già elaborato. Controlla il tuo account.');
    if(saved.terms_version!==TERMS_VERSION) fail(409,'Le condizioni sono state aggiornate. Il precedente tentativo di pagamento deve scadere prima di crearne uno nuovo; contatta l’assistenza se hai bisogno di aiuto.');
    const id=saved.id;
    if(saved.checkout_url) return json({url:saved.checkout_url});
    if(saved.created_at<Date.now()-23*3600000) fail(409,'Il precedente tentativo sta scadendo. Riprova fra un’ora.');
    await snapshotOrder(env,saved,user);
    const session=await stripe(env,'checkout/sessions',{
      mode:'payment','payment_method_types[0]':'card',customer_email:user.email,client_reference_id:user.id,
      'metadata[order_id]':id,'payment_intent_data[metadata][order_id]':id,
      'line_items[0][price_data][currency]':'eur','line_items[0][price_data][unit_amount]':String(plan.amount),
      'line_items[0][price_data][product_data][name]':`FungoMeter — ${plan.name}`,
      'line_items[0][price_data][product_data][description]':'Italia, 11 specie/gruppi, oggi e prossimi 7 giorni. Pagamento unico, nessun rinnovo automatico.',
      'line_items[0][quantity]':'1',locale:'it',expires_at:String(Math.floor(saved.created_at/1000)+86400),
      success_url:`${env.APP_ORIGIN}/account.html?checkout=success`,cancel_url:`${env.APP_ORIGIN}/prezzi.html?checkout=cancelled`
    },`order:${id}`);
    await stmt(env,'UPDATE orders SET session_id=?,checkout_url=? WHERE id=?',session.id,session.url,id).run();
    await record(env,user,'checkout_start'); return json({url:session.url});
  }
  fail(404,'Pagina non trovata.');
}
async function handle(request,env) {
  const url=new URL(request.url);
  if(env.APP_ENV!=='local' && url.origin!==env.APP_ORIGIN) return json({error:'Dominio non configurato.'},503);
  let path; try { path=decodeURIComponent(url.pathname); } catch { return json({error:'Percorso non valido.'},400); }
  if(path.includes('\\') || path.includes('%') || path.includes('//') || path.split('/').includes('..')) return json({error:'Percorso non valido.'},400);
  if(path.startsWith('/api/')) return api(request,env,path);
  if(path==='/') return env.ASSETS.fetch(new Request(new URL('/inizia.html',request.url),request));
  if(!['GET','HEAD'].includes(request.method)) return json({error:'Metodo non consentito.'},405);
  if(path.startsWith('/data/')) {
    const user=await identity(request,env);
    if(!(await access(user,env)).active) return json({error:'Attiva la prova o scegli un pass per tutta Italia.',code:'access_required'},403);
    const response=await env.ASSETS.fetch(request);
    const result=new Response(response.body,response);
    result.headers.set('Cache-Control','private, no-store'); result.headers.set('Vary','Cookie');
    return result;
  }
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request,env) {
    try {
      // Promote the staged live pair together. A partial pair fails closed;
      // the owner's test credentials remain untouched for commissioning.
      const stagedLive=env.PAYMENTS_MODE==='live'&&(env.STRIPE_LIVE_SECRET_KEY||env.STRIPE_LIVE_WEBHOOK_SECRET);
      const runtimeEnv=stagedLive?{...env,STRIPE_SECRET_KEY:env.STRIPE_LIVE_SECRET_KEY||'',STRIPE_WEBHOOK_SECRET:env.STRIPE_LIVE_WEBHOOK_SECRET||''}:env;
      const result=await handle(request,runtimeEnv);
      const response=new Response(result.body,result);
      response.headers.set('X-Content-Type-Options','nosniff');
      if(!response.headers.has('Referrer-Policy'))response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
      response.headers.set('X-Frame-Options','DENY');
      response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(self)');
      return response;
    } catch(e) { return json({error:e instanceof HttpError?e.message:'Servizio temporaneamente non disponibile.'},e.status||503); }
  },
  async scheduled(controller,env,ctx) {
    const now=Date.now();
    ctx.waitUntil(env.DB.batch([
      stmt(env,'DELETE FROM sessions WHERE expires_at<?',now),stmt(env,'DELETE FROM login_codes WHERE expires_at<?',now),
      stmt(env,'DELETE FROM oauth_flows WHERE expires_at<?',now),
      stmt(env,'DELETE FROM rate_limits WHERE expires_at<?',now),stmt(env,'DELETE FROM webhook_events WHERE received_at<?',now-90*DAY),
      stmt(env,'DELETE FROM funnel_events WHERE day<?',new Date(now-30*DAY).toISOString().slice(0,10))
    ]));
  }
};
