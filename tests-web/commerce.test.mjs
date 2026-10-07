import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index.mjs';
import {DAY,TERMS_VERSION,hmac,verifyStripeSignature,entitlement,validatePaidSession} from '../worker/core.mjs';
import {monthDeadline} from '../worker/customer-care.mjs';
let db,env,originalFetch,checkout,charge;
const origin='http://127.0.0.1:8787';
beforeEach(async()=>{
 db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../migrations/0001_commerce.sql',import.meta.url),'utf8'));
 db.exec(await readFile(new URL('../migrations/0002_pending_checkout.sql',import.meta.url),'utf8'));
 db.exec(await readFile(new URL('../migrations/0004_customer_care.sql',import.meta.url),'utf8'));
 env={APP_ENV:'local',APP_ORIGIN:origin,AUTH_ENABLED:'true',AUTH_SECRET:'a'.repeat(64),PAYMENTS_MODE:'test',STRIPE_SECRET_KEY:'sk_test_fake',STRIPE_WEBHOOK_SECRET:'whsec_fake',
  DB:{async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.all());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);},async all(){return {results:db.prepare(sql).all(...args)};}}}},
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

test('launch progress is private to the authenticated owner',async()=>{
 env.SUPPORT_EMAIL='owner@example.test';
 assert.equal((await req('/api/owner/launch')).status,401);
 const customer=await login();
 assert.equal((await req('/api/owner/launch',undefined,customer)).status,403);
 assert.equal((await(await req('/api/me',undefined,customer)).json()).user.isOwner,false);
 const owner=await login('owner@example.test');
 const response=await req('/api/owner/launch',undefined,owner);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{payingCustomers:0,target:5,remaining:5,targetReached:false});
 assert.equal((await(await req('/api/me',undefined,owner)).json()).user.isOwner,true);
});

test('five-customer target excludes tests, revoked and pending payments, and counts repeat buyers once',async()=>{
 env.SUPPORT_EMAIL='owner@example.test';const owner=await login('owner@example.test');
 const addUser=db.prepare('INSERT INTO users(id,email,created_at) VALUES(?,?,?)');
 const addOrder=db.prepare('INSERT INTO orders(id,user_id,plan,amount,days,mode,created_at,paid_at,revoked,terms_version,checkout_closed) VALUES(?,?,?,?,?,?,?,?,?,?,1)');
 for(let i=0;i<8;i++)addUser.run('u'+i,`u${i}@example.test`,Date.now());
 const add=(id,user,mode='live',paid=Date.now(),revoked=0)=>addOrder.run(id,user,'season',990,90,mode,Date.now(),paid,revoked,TERMS_VERSION);
 for(let i=0;i<4;i++)add('o'+i,'u'+i);
 add('repeat','u0');add('test','u4','test');add('refunded','u5','live',Date.now(),1);add('pending','u6','live',null);
 const progress=async()=>await(await req('/api/owner/launch',undefined,owner)).json();
 assert.deepEqual(await progress(),{payingCustomers:4,target:5,remaining:1,targetReached:false});
 add('fifth','u7');assert.deepEqual(await progress(),{payingCustomers:5,target:5,remaining:0,targetReached:true});
 db.prepare('UPDATE orders SET revoked=1 WHERE id=?').run('fifth');assert.equal((await progress()).payingCustomers,4);
});
test('account export isolates users and excludes session and checkout credentials',async()=>{
 const first=await login('first@example.test');await pay(first);await hook();
 await req('/api/preferences',{analytics:true},first);await req('/api/event',{event:'map_ready'},first);
 const firstOrder=db.prepare('SELECT id FROM orders').get().id;
 db.prepare("UPDATE orders SET session_id='cs_first',payment_intent='pi_first'").run();
 const second=await login('second@example.test');await pay(second);
 const response=await req('/api/account/export',undefined,first);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(response.headers.get('vary'),'Cookie');
 const data=await response.json();assert.equal(data.account.email,'first@example.test');
 assert.equal(data.orders.length,1);assert.equal(data.orders[0].id,firstOrder);assert.equal(data.orders[0].amount,990);
 assert.deepEqual(data.analytics.map(e=>e.event),['map_ready']);
 const serialized=JSON.stringify(data);
 for(const forbidden of ['second@example.test','token_hash','checkout_url','payment_intent','session_id','sk_test_fake','whsec_fake'])assert.ok(!serialized.includes(forbidden),forbidden);
});

test('account export requires an active authorized session and ignores requested user IDs',async()=>{
 assert.equal((await req('/api/account/export')).status,401);
 const first=await login('first@example.test');const other=await login('other@example.test');
 const firstId=db.prepare('SELECT id FROM users WHERE email=?').get('first@example.test').id;
 const data=await(await req('/api/account/export?user_id='+firstId,undefined,other)).json();
 assert.equal(data.account.email,'other@example.test');
 db.prepare('UPDATE sessions SET expires_at=?').run(Date.now()-1);
 assert.equal((await req('/api/account/export',undefined,first)).status,401);
});

test('login creates HttpOnly session, not automatic trial',async()=>{
 const cookie=await login();const me=await(await req('/api/me',undefined,cookie)).json();assert.equal(me.access.active,false);assert.equal(me.user.canTrial,true);
});

test('paid confirmation contains the original contract, is escaped and cannot be read by another user',async()=>{
 env.SELLER_NAME='<script>alert(1)</script>';env.SELLER_ADDRESS='Indirizzo originale';
 const customer=await login();await pay(customer);const id=db.prepare('SELECT id FROM orders').get().id;
 const path='/api/orders/'+id+'/confirmation';assert.equal((await req(path,undefined,customer)).status,404);
 await hook();env.SELLER_ADDRESS='Indirizzo successivo';
 const response=await req(path,undefined,customer),html=await response.text();
 assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(html,/Indirizzo originale/);assert.doesNotMatch(html,/Indirizzo successivo|<script>/);assert.match(html,/&lt;script&gt;/);
 const other=await login('other@example.test');assert.equal((await req(path,undefined,other)).status,404);assert.equal((await req(path)).status,401);
 assert.equal((await(await req('/api/orders',undefined,other)).json()).orders.length,0);
});

test('requests validate ownership, require explicit deletion confirmation and deduplicate deletion',async()=>{
 const first=await login();await pay(first);const id=db.prepare('SELECT id FROM orders').get().id;
 assert.equal((await req('/api/requests',{kind:'withdrawal',orderId:id},first)).status,400);
 await hook();const other=await login('other@example.test');
 assert.equal((await req('/api/requests',{kind:'withdrawal',orderId:id},other)).status,404);
 assert.equal((await req('/api/requests',{kind:'deletion'},first)).status,400);
 const one=await(await req('/api/requests',{kind:'deletion',confirm:true},first)).json();
 const two=await(await req('/api/requests',{kind:'deletion',confirm:true},first)).json();assert.equal(one.id,two.id);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM service_requests').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
 assert.equal((await(await req('/api/requests',undefined,other)).json()).requests.length,0);
 assert.equal((await req('/api/requests',{kind:'support',message:'test'},first,{Origin:'https://evil.test'})).status,403);
});

test('checkout never reuses a pending order accepted under older terms',async()=>{
 const cookie=await login();await pay(cookie);
 db.prepare("UPDATE orders SET terms_version='2026-10-01'").run();
 const response=await req('/api/checkout',{plan:'season',termsVersion:TERMS_VERSION,immediateAccess:true},cookie);
 assert.equal(response.status,409);
 assert.match((await response.json()).error,/condizioni sono state aggiornate/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
});

test('owner care inbox is private and records resolution without deleting accounts or refunding orders',async()=>{
 env.SUPPORT_EMAIL='owner@example.test';const customer=await login();
 const ticket=await(await req('/api/requests',{kind:'privacy',message:'Vorrei correggere un dato.'},customer)).json();
 assert.equal((await req('/api/owner/care',undefined,customer)).status,403);
 const owner=await login('owner@example.test');const inbox=await(await req('/api/owner/care',undefined,owner)).json();
 assert.equal(inbox.requests[0].id,ticket.id);assert.equal(inbox.requests[0].email,'tester@example.test');
 assert.equal((await req('/api/owner/resolve-request',{id:ticket.id,resolution:'Richiesta gestita'},owner)).status,400);
 assert.equal((await req('/api/owner/resolve-request',{id:ticket.id,resolution:'Dato corretto e risposta inviata.',completed:true},owner)).status,200);
 assert.equal((await(await req('/api/requests',undefined,customer)).json()).requests[0].resolution,'Dato corretto e risposta inviata.');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
});

test('confirmation outbox requires a verified payment and explicit recording of manual sending',async()=>{
 env.SUPPORT_EMAIL='owner@example.test';const customer=await login();await pay(customer);const id=db.prepare('SELECT id FROM orders').get().id;
 const owner=await login('owner@example.test');
 assert.equal((await(await req('/api/owner/care',undefined,owner)).json()).confirmations.length,0);
 assert.equal((await req('/api/owner/confirmation-sent',{orderId:id,sent:true},owner)).status,404);
 await hook();assert.equal((await(await req('/api/owner/care',undefined,owner)).json()).confirmations.length,1);
 const draft=await req('/api/owner/orders/'+id+'/email',undefined,owner);assert.equal(draft.status,200);
 const content=await draft.text();assert.match(content,/X-Unsent: 1/);assert.match(content,/To: tester@example.test/);assert.match(content,/Content-Disposition: attachment/);
 assert.equal((await req('/api/owner/orders/'+id+'/email',undefined,customer)).status,403);
 assert.equal((await req('/api/owner/confirmation-sent',{orderId:id,sent:false},owner)).status,400);
 assert.equal((await req('/api/owner/confirmation-sent',{orderId:id,sent:true},owner)).status,200);
 assert.equal((await(await req('/api/owner/care',undefined,owner)).json()).confirmations.length,0);
});

test('privacy deadline uses one calendar month including month ends and leap years',()=>{
 assert.equal(new Date(monthDeadline(Date.parse('2026-01-31T10:20:30Z'))).toISOString(),'2026-02-28T10:20:30.000Z');
 assert.equal(new Date(monthDeadline(Date.parse('2028-01-31T10:20:30Z'))).toISOString(),'2028-02-29T10:20:30.000Z');
});

test('requested deletion is atomic, revokes sessions, removes linked data and protects owner and orders',async()=>{
 env.SUPPORT_EMAIL='owner@example.test';const owner=await login('owner@example.test');
 const customer=await login('unused@example.test');await req('/api/preferences',{analytics:true},customer);await req('/api/event',{event:'map_ready'},customer);
 const ticket=await(await req('/api/requests',{kind:'deletion',confirm:true},customer)).json();
 assert.equal((await req('/api/owner/delete-unused-account',{id:ticket.id,email:'unused@example.test',confirm:true},customer)).status,403);
 assert.equal((await req('/api/owner/delete-unused-account',{id:ticket.id,email:'wrong@example.test',confirm:true},owner)).status,409);
 assert.equal((await req('/api/owner/delete-unused-account',{id:ticket.id,email:'unused@example.test',confirm:true},owner)).status,200);
 assert.equal((await req('/api/account/export',undefined,customer)).status,401);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE email=?').get('unused@example.test').n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM service_requests').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM funnel_events').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM privacy_deletions').get().n,1);
 const ownerTicket=await(await req('/api/requests',{kind:'deletion',confirm:true},owner)).json();
 assert.equal((await req('/api/owner/delete-unused-account',{id:ownerTicket.id,email:'owner@example.test',confirm:true},owner)).status,409);
 const buyer=await login('buyer@example.test');await pay(buyer);const buyerTicket=await(await req('/api/requests',{kind:'deletion',confirm:true},buyer)).json();
 assert.equal((await req('/api/owner/delete-unused-account',{id:buyerTicket.id,email:'buyer@example.test',confirm:true},owner)).status,409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
});

test('live promotion uses the staged pair only in live mode and incomplete pairs disable checkout',async()=>{
 env.STRIPE_LIVE_SECRET_KEY='rk_live_staged';env.STRIPE_LIVE_WEBHOOK_SECRET='whsec_live_staged';
 assert.equal((await(await req('/api/me')).json()).paymentsReady,true);
 env.PAYMENTS_MODE='live';env.LIVE_SALES_READY='true';env.LICENSES_READY='true';env.PRIVATE_DATA_READY='true';
 Object.assign(env,{SELLER_NAME:'Gestore',SELLER_ADDRESS:'Indirizzo',SELLER_TAX_ID:'Dato fiscale',SUPPORT_EMAIL:'owner@example.test'});
 assert.equal((await(await req('/api/me')).json()).paymentsReady,true);
 delete env.STRIPE_LIVE_WEBHOOK_SECRET;
 assert.equal((await(await req('/api/me')).json()).paymentsReady,false);
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
