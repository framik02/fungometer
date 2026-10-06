import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index.mjs';
import {DAY,TERMS_VERSION,hmac,verifyStripeSignature,entitlement,validatePaidSession} from '../worker/core.mjs';
let db,env,originalFetch,checkout,charge;
const origin='http://127.0.0.1:8787';
beforeEach(async()=>{
 db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../migrations/0001_commerce.sql',import.meta.url),'utf8'));
 db.exec(await readFile(new URL('../migrations/0002_pending_checkout.sql',import.meta.url),'utf8'));
 env={APP_ENV:'local',APP_ORIGIN:origin,AUTH_ENABLED:'true',AUTH_SECRET:'a'.repeat(64),PAYMENTS_MODE:'test',STRIPE_SECRET_KEY:'sk_test_fake',STRIPE_WEBHOOK_SECRET:'whsec_fake',
  DB:{prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}}}},
  ASSETS:{async fetch(request){const path=new URL(request.url).pathname;return Response.json(path==='/data/punteggi.json'?{aggiornato:new Date().toISOString(),specie:[],regole:{},celle:{secret:true}}:{asset:path});}}
 };
 originalFetch=globalThis.fetch;charge={id:'ch_test',amount_refunded:0,refunded:false,disputed:false};checkout=null;
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/checkout/sessions')){
   const p=new URLSearchParams(options.body);checkout={id:'cs_test',url:'https://checkout.stripe.com/c/pay/test',mode:'payment',payment_status:'paid',livemode:false,payment_intent:'pi_test',currency:'eur',amount_total:Number(p.get('line_items[0][price_data][unit_amount]')),client_reference_id:p.get('client_reference_id'),metadata:{order_id:p.get('metadata[order_id]')}};
   return Response.json(checkout);
  }
  if(String(url).includes('/checkout/sessions/'))return Response.json(checkout);
  if(String(url).includes('/payment_intents/'))return Response.json({latest_charge:'ch_test'});
  if(String(url).includes('/charges/'))return Response.json(charge);
  throw new Error('Unexpected outbound request '+url);
 };
});
afterEach(()=>{globalThis.fetch=originalFetch;db.close();});
const req=(path,data,cookie,extra={})=>worker.fetch(new Request(origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
async function login(email='tester@example.test'){
 const sent=await (await req('/api/auth/request',{email})).json();assert.ok(sent.localCode);
 const result=await req('/api/auth/verify',{id:sent.id,code:sent.localCode});assert.equal(result.status,200);
 return result.headers.get('set-cookie').split(';')[0];
}
async function start(cookie){return req('/api/trial',{termsVersion:TERMS_VERSION},cookie);}
async function pay(cookie){const response=await req('/api/checkout',{plan:'season',termsVersion:TERMS_VERSION,immediateAccess:true},cookie);assert.equal(response.status,200);return response;}
async function hook(type='checkout.session.completed',object=checkout,id=crypto.randomUUID()){
 const raw=JSON.stringify({id,type,livemode:false,data:{object}}),t=Math.floor(Date.now()/1000);
 const signature=await hmac(env.STRIPE_WEBHOOK_SECRET,`${t}.${raw}`);
 return worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',body:raw,headers:{'stripe-signature':`t=${t},v1=${signature}`}}),env);
}
test('all map data, including Foligno/Roma and encoded paths, require access',async()=>{
 for(const path of ['/data/celle.json','/data/punteggi_foligno.json','/data/punteggi_roma.json','/data/italia/indice.json','/data/sottocelle/roma_1.json','/%64ata/celle.json'])assert.equal((await req(path)).status,403,path);
 assert.equal((await req('/data%252fcelle.json')).status,400);
 assert.equal((await req('/data/segnalati_web.json')).status,403);
});
test('public species metadata never contains raw scores',async()=>{
 const data=await(await req('/api/species')).json();assert.deepEqual(Object.keys(data).sort(),['regole','specie']);
});
test('login creates HttpOnly session, not automatic trial',async()=>{
 const cookie=await login();const me=await(await req('/api/me',undefined,cookie)).json();assert.equal(me.access.active,false);assert.equal(me.user.canTrial,true);
});
test('cross-origin trial requests are rejected',async()=>{
 const cookie=await login();assert.equal((await req('/api/trial',{termsVersion:TERMS_VERSION},cookie,{Origin:'https://evil.test'})).status,403);
});
test('trial is seven days, idempotent, and protects data after expiry',async()=>{
 const cookie=await login();assert.equal((await start(cookie)).status,200);const first=db.prepare('SELECT * FROM users').get();
 assert.equal(first.trial_ends_at-first.trial_started_at,7*DAY);await start(cookie);assert.equal(db.prepare('SELECT trial_ends_at FROM users').get().trial_ends_at,first.trial_ends_at);
 const data=await req('/data/celle.json',undefined,cookie);assert.equal(data.status,200);assert.equal(data.headers.get('cache-control'),'private, no-store');
 assert.equal((await req('/data/segnalati_web.json',undefined,cookie)).status,200);
 db.prepare('UPDATE users SET trial_ends_at=?').run(Date.now()-1);assert.equal((await req('/data/celle.json',undefined,cookie)).status,403);await start(cookie);assert.equal((await req('/data/celle.json',undefined,cookie)).status,403);
});
test('stale data does not consume trial or charge',async()=>{
 const cookie=await login();env.ASSETS.fetch=async()=>Response.json({aggiornato:new Date(Date.now()-3*DAY).toISOString()});
 assert.equal((await start(cookie)).status,503);assert.equal(db.prepare('SELECT trial_started_at FROM users').get().trial_started_at,null);
 assert.equal((await req('/api/checkout',{plan:'season',termsVersion:TERMS_VERSION,immediateAccess:true},cookie)).status,503);
});
test('OTP is single use with bounded guesses',async()=>{
 const code=await(await req('/api/auth/request',{email:'a@example.test'})).json();
 for(let i=0;i<5;i++)assert.equal((await req('/api/auth/verify',{id:code.id,code:code.localCode==='000000'?'111111':'000000'})).status,400);
 assert.equal((await req('/api/auth/verify',{id:code.id,code:code.localCode})).status,400);
 const next=await(await req('/api/auth/request',{email:'b@example.test'})).json();
 assert.equal((await req('/api/auth/verify',{id:next.id,code:next.localCode})).status,200);
 assert.equal((await req('/api/auth/verify',{id:next.id,code:next.localCode})).status,400);
});
test('public deployment never returns local login codes',async()=>{
 env.APP_ENV='staging';env.APP_ORIGIN='https://fungometer.example';
 const result=await worker.fetch(new Request(env.APP_ORIGIN+'/api/auth/request',{method:'POST',headers:{Origin:env.APP_ORIGIN},body:JSON.stringify({email:'a@example.test'})}),env);
 assert.equal(result.status,503);assert.equal((await result.json()).localCode,undefined);
});
test('logout revokes server session and map access',async()=>{
 const cookie=await login();await start(cookie);const response=await req('/api/logout',{},cookie);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await req('/data/celle.json',undefined,cookie)).status,403);
});
test('checkout amount comes from server and retries reuse session',async()=>{
 const cookie=await login();await pay(cookie);assert.equal(checkout.amount_total,990);await pay(cookie);assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
 assert.equal((await req('/api/checkout',{plan:'custom',amount:1,termsVersion:TERMS_VERSION,immediateAccess:true},cookie)).status,400);
});
test('owner test-account cutover replaces old pending Checkout links',async()=>{
 const cookie=await login();await pay(cookie);const old=checkout.metadata.order_id;
 db.prepare('UPDATE orders SET created_at=?,session_id=? WHERE id=?').run(Date.now()-10000,'cs_test_old_account',old);
 env.STRIPE_TEST_RESET_BEFORE=new Date(Date.now()-5000).toISOString();
 assert.equal((await pay(cookie)).status,200);
 assert.equal(db.prepare('SELECT checkout_closed FROM orders WHERE id=?').get(old).checkout_closed,1);
 assert.notEqual(checkout.metadata.order_id,old);
 await pay(cookie);assert.equal(db.prepare('SELECT COUNT(*) n FROM orders WHERE checkout_closed=0').get().n,1);
});
test('test-account cutover leaves completed passes intact',async()=>{
 const cookie=await login();await pay(cookie);await hook();const old=checkout.metadata.order_id;
 db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(Date.now()-10000,old);
 env.STRIPE_TEST_RESET_BEFORE=new Date(Date.now()-5000).toISOString();
 globalThis.fetch=async()=>Response.json({id:'cs_second',url:'https://checkout.stripe.com/c/pay/second'});
 assert.equal((await pay(cookie)).status,200);
 const paid=db.prepare('SELECT paid_at,revoked,checkout_closed FROM orders WHERE id=?').get(old);
 assert.ok(paid.paid_at);assert.equal(paid.revoked,0);assert.equal(paid.checkout_closed,0);
});
test('return URL cannot activate paid access',async()=>{
 const cookie=await login();await pay(cookie);await req('/account.html?checkout=success',undefined,cookie);assert.equal((await(await req('/api/me',undefined,cookie)).json()).access.active,false);
});
test('simultaneous checkout requests reserve one pending order',async()=>{
 const cookie=await login();const responses=await Promise.all([pay(cookie),pay(cookie),pay(cookie)]);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
 assert.equal(new Set(await Promise.all(responses.map(async r=>(await r.json()).url))).size,1);
});
test('a new purchase after fulfillment creates a distinct order',async()=>{
 const cookie=await login();await pay(cookie);await hook();const original=checkout.metadata.order_id;
 globalThis.fetch=async()=>Response.json({id:'cs_second',url:'https://checkout.stripe.com/c/pay/second'});
 await pay(cookie);assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,2);
 assert.notEqual(db.prepare('SELECT id FROM orders WHERE paid_at IS NULL').get().id,original);
});
test('closed checkout still accepts a delayed paid webhook',async()=>{
 const cookie=await login();await pay(cookie);db.prepare('UPDATE orders SET checkout_closed=1').run();
 assert.equal((await hook()).status,200);assert.equal((await req('/data/celle.json',undefined,cookie)).status,200);
});
test('disabled authentication cannot consume previously issued codes',async()=>{
 const sent=await(await req('/api/auth/request',{email:'a@example.test'})).json();env.AUTH_ENABLED='false';
 assert.equal((await req('/api/auth/verify',{id:sent.id,code:sent.localCode})).status,503);
});
test('verified webhook grants once and preserves remaining trial',async()=>{
 const cookie=await login();await start(cookie);const trialEnd=db.prepare('SELECT trial_ends_at FROM users').get().trial_ends_at;await pay(cookie);
 assert.equal((await hook(undefined,undefined,'evt_once')).status,200);const order=db.prepare('SELECT * FROM orders').get();assert.equal(order.access_end,trialEnd+90*DAY);
 assert.equal((await hook(undefined,undefined,'evt_once')).status,200);assert.equal((await hook()).status,200);assert.equal(db.prepare('SELECT access_end FROM orders').get().access_end,order.access_end);
});
test('wrong amount and wrong account cannot fulfill an order',async()=>{
 const cookie=await login();await pay(cookie);checkout.amount_total=1;assert.equal((await hook()).status,400);assert.equal(db.prepare('SELECT paid_at FROM orders').get().paid_at,null);
 checkout.amount_total=990;checkout.client_reference_id='another-user';assert.equal((await hook()).status,400);
});
test('refund suspends paid entitlement and duplicate success cannot restore it',async()=>{
 const cookie=await login();await pay(cookie);await hook();assert.equal((await req('/data/celle.json',undefined,cookie)).status,200);
 await hook('charge.refunded',{payment_intent:'pi_test'});assert.equal((await req('/data/celle.json',undefined,cookie)).status,403);
 await hook();assert.equal((await req('/data/celle.json',undefined,cookie)).status,403);
});
test('refund arriving before completion prevents grant',async()=>{
 const cookie=await login();await pay(cookie);charge.refunded=true;charge.amount_refunded=990;await hook();assert.equal(db.prepare('SELECT revoked FROM orders').get().revoked,1);assert.equal((await req('/data/celle.json',undefined,cookie)).status,403);
});
test('live key cannot be used accidentally in test mode',async()=>{
 const cookie=await login();env.STRIPE_SECRET_KEY='sk_live_wrong';assert.equal((await req('/api/checkout',{plan:'season',termsVersion:TERMS_VERSION,immediateAccess:true},cookie)).status,503);
});

test('restricted Stripe test keys work while live and publishable keys remain rejected',async()=>{
 for(const key of ['sk_test_fake','rk_test_fake']){
  env.STRIPE_SECRET_KEY=key;assert.equal((await(await req('/api/me')).json()).paymentsReady,true);
 }
 for(const key of ['sk_live_fake','rk_live_fake','pk_test_fake']){
  env.STRIPE_SECRET_KEY=key;assert.equal((await(await req('/api/me')).json()).paymentsReady,false);
 }
});

test('temporary sandbox key requires owner-only access and a future sandbox expiry',async()=>{
 env.STRIPE_SECRET_KEY='rkcs_test_fake';assert.equal((await(await req('/api/me')).json()).paymentsReady,false);
 env.AUTH_ACCESS='owner-test';assert.equal((await(await req('/api/me')).json()).paymentsReady,false);
 env.STRIPE_TEST_EXPIRES_AT=new Date(Date.now()+DAY).toISOString();assert.equal((await(await req('/api/me')).json()).paymentsReady,true);
 env.STRIPE_TEST_EXPIRES_AT=new Date(Date.now()-DAY).toISOString();assert.equal((await(await req('/api/me')).json()).paymentsReady,false);
 env.STRIPE_TEST_EXPIRES_AT='invalid';assert.equal((await(await req('/api/me')).json()).paymentsReady,false);
 env.STRIPE_TEST_EXPIRES_AT=new Date(Date.now()+DAY).toISOString();env.AUTH_ACCESS='public';assert.equal((await(await req('/api/me')).json()).paymentsReady,false);
 env.AUTH_ACCESS='owner-test';env.PAYMENTS_MODE='live';assert.equal((await(await req('/api/me')).json()).paymentsReady,false);
});

test('a simulated pass never grants access after switching to live payments',async()=>{
 const cookie=await login();await pay(cookie);await hook();
 assert.equal((await(await req('/api/me',undefined,cookie)).json()).access.kind,'paid');
 env.PAYMENTS_MODE='live';assert.equal((await(await req('/api/me',undefined,cookie)).json()).access.active,false);
 assert.equal((await req('/data/celle.json',undefined,cookie)).status,403);
});

test('pass duration never stacks on orders from the other payment environment',async()=>{
 const cookie=await login();await pay(cookie);await hook();
 const distant=Date.now()+365*DAY;
 db.prepare("UPDATE orders SET mode='live',access_end=?,session_id='cs_other',payment_intent='pi_other'").run(distant);
 await pay(cookie);const before=Date.now();await hook();
 const order=db.prepare("SELECT * FROM orders WHERE mode='test'").get();
 assert.ok(order.access_start>=before&&order.access_start<distant);assert.equal(order.access_end-order.access_start,90*DAY);
});
test('invalid or old webhook signature is rejected',async()=>{
 const raw='{}',t=Math.floor(Date.now()/1000)-600;assert.equal(await verifyStripeSignature(raw,`t=${t},v1=${await hmac('secret',`${t}.${raw}`)}`,'secret'),false);
 const result=await worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',body:raw,headers:{'stripe-signature':'bad'}}),env);assert.equal(result.status,400);
});
test('optional analytics starts off and revocation removes events',async()=>{
 const cookie=await login();await req('/api/event',{event:'map_ready'},cookie);assert.equal(db.prepare('SELECT COUNT(*) n FROM funnel_events').get().n,0);
 await req('/api/preferences',{analytics:true},cookie);await req('/api/event',{event:'map_ready'},cookie);await req('/api/event',{event:'map_ready'},cookie);assert.equal(db.prepare('SELECT COUNT(*) n FROM funnel_events').get().n,1);
 await req('/api/preferences',{analytics:false},cookie);assert.equal(db.prepare('SELECT COUNT(*) n FROM funnel_events').get().n,0);
});
test('expired session cannot access map even with a valid pass',async()=>{
 const cookie=await login();await pay(cookie);await hook();db.prepare('UPDATE sessions SET expires_at=?').run(Date.now()-1);assert.equal((await req('/data/celle.json',undefined,cookie)).status,403);
});
function configurePublicEmail(){
 Object.assign(env,{APP_ENV:'staging',TURNSTILE_SECRET_KEY:'test-turnstile',RESEND_API_KEY:'test-resend',MAIL_FROM:'FungoMeter <accesso@mail.example.test>',SUPPORT_EMAIL:'support@example.test'});
}
test('public email login sends via provider and never returns the code',async()=>{
 configurePublicEmail();let mail,headers;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('turnstile'))return Response.json({success:true,hostname:'127.0.0.1',action:'login'});
  mail=JSON.parse(options.body);headers=options.headers;return Response.json({id:'email_test'});
 };
 const response=await req('/api/auth/request',{email:'tester@example.test',turnstileToken:'test-token'});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.localCode,undefined);
 assert.deepEqual(mail.to,['tester@example.test']);assert.equal(mail.reply_to,'support@example.test');
 assert.equal(headers['Idempotency-Key'],`login/${result.id}`);
 const code=mail.text.match(/\b\d{6}\b/)[0];assert.equal((await req('/api/auth/verify',{id:result.id,code})).status,200);
});
test('wrong Turnstile hostname or action prevents email sending',async()=>{
 configurePublicEmail();let sends=0;
 for(const mismatch of [{hostname:'evil.test',action:'login'},{hostname:'127.0.0.1',action:'other'}]){
  globalThis.fetch=async url=>{if(String(url).includes('turnstile'))return Response.json({success:true,...mismatch});sends++;return Response.json({id:'unexpected'});};
  assert.equal((await req('/api/auth/request',{email:'tester@example.test',turnstileToken:'test-token'})).status,400);
 }
 assert.equal(sends,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM login_codes').get().n,0);
});
test('shared email budget stops the 81st send even across different addresses and IPs',async()=>{
 configurePublicEmail();let sends=0;
 globalThis.fetch=async url=>{if(String(url).includes('turnstile'))return Response.json({success:true,hostname:'127.0.0.1',action:'login'});sends++;return Response.json({id:'email_test'});};
 for(let i=0;i<81;i++){
  const response=await req('/api/auth/request',{email:`tester${i}@example.test`,turnstileToken:'test-token'},undefined,{'CF-Connecting-IP':`192.0.2.${i+1}`});
  assert.equal(response.status,i<80?200:429);
 }
 assert.equal(sends,80);
});
test('provider rejection removes the unusable login challenge',async()=>{
 configurePublicEmail();globalThis.fetch=async url=>String(url).includes('turnstile')?Response.json({success:true,hostname:'127.0.0.1',action:'login'}):Response.json({error:'rejected'},{status:422});
 const response=await req('/api/auth/request',{email:'tester@example.test',turnstileToken:'test-token'});
 assert.equal(response.status,503);assert.equal(db.prepare('SELECT COUNT(*) n FROM login_codes').get().n,0);
});
