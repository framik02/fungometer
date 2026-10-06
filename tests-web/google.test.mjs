import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import worker from '../worker/index.mjs';
import {verifyGoogleToken} from '../worker/google.mjs';
const origin='https://fungometer.example',client='test.apps.googleusercontent.com';
const pair=await generateKeyPair('RS256'),otherPair=await generateKeyPair('RS256');
const jwk={...await exportJWK(pair.publicKey),kid:'test-key',alg:'RS256'};
let db,env,originalFetch,claims,exchanges;
async function signed(nonce,override={},key=pair.privateKey){
 const now=Math.floor(Date.now()/1000);
 return new SignJWT({iss:'https://accounts.google.com',aud:client,sub:'google-123',email:'tester@example.test',email_verified:true,nonce,iat:now,exp:now+300,...override}).setProtectedHeader({alg:'RS256',kid:'test-key'}).sign(key);
}
beforeEach(async()=>{
 db=new DatabaseSync(':memory:');
 for(const name of ['0001_commerce','0002_pending_checkout','0003_google_login'])db.exec(await readFile(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8'));
 env={APP_ENV:'staging',APP_ORIGIN:origin,AUTH_PROVIDER:'google',AUTH_ENABLED:'true',AUTH_SECRET:'a'.repeat(64),GOOGLE_CLIENT_ID:client,GOOGLE_CLIENT_SECRET:'test-secret',PAYMENTS_MODE:'test',DB:{prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}}}}};
 originalFetch=globalThis.fetch;claims={};exchanges=0;
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
  assert.equal(String(url),'https://oauth2.googleapis.com/token');exchanges++;
  const p=new URLSearchParams(options.body);assert.equal(p.get('redirect_uri'),origin+'/api/auth/google/callback');assert.equal(p.get('client_secret'),'test-secret');assert.equal(p.get('code_verifier')?.length,64);
  return Response.json({id_token:await signed(lastNonce,claims)});
 };
});
afterEach(()=>{globalThis.fetch=originalFetch;db.close();});
let lastNonce;
const req=(path,data,cookie,extra={})=>worker.fetch(new Request(origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
async function start(plan){
 const r=await req('/api/auth/google/start',{plan});assert.equal(r.status,200);
 const url=new URL((await r.json()).url);lastNonce=url.searchParams.get('nonce');
 return {url,state:url.searchParams.get('state'),cookie:r.headers.get('set-cookie').split(';')[0]};
}
const callback=(flow,extra='')=>req('/api/auth/google/callback?code=test-code&state='+flow.state+extra,undefined,flow.cookie);
const session=response=>response.headers.getSetCookie().find(v=>v.startsWith('__Host-fm='))?.split(';')[0];

test('Google start requires readiness and same-origin request',async()=>{
 assert.equal((await req('/api/auth/google/start',{},undefined,{Origin:'https://evil.test'})).status,403);
 env.GOOGLE_CLIENT_SECRET='';assert.equal((await req('/api/auth/google/start',{})).status,503);
});
test('Google requests only identity/email with browser-bound state, nonce and PKCE',async()=>{
 const flow=await start('season'),p=flow.url.searchParams;
 assert.equal(flow.url.origin,'https://accounts.google.com');assert.equal(p.get('scope'),'openid email');assert.equal(p.get('access_type'),null);assert.equal(p.get('code_challenge_method'),'S256');assert.equal(p.get('code_challenge').length,43);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
 assert.equal(db.prepare('SELECT next_path FROM oauth_flows').get().next_path,'/account.html?piano=season');
});
test('verified Google callback creates one session without starting a trial and cannot replay',async()=>{
 const flow=await start();const r=await callback(flow);assert.equal(r.status,303);assert.equal(r.headers.get('location'),origin+'/account.html');assert.ok(session(r));
 assert.match(r.headers.getSetCookie().find(x=>x.startsWith('__Host-fm=')),/HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure/);
 assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 const me=await(await req('/api/me',undefined,session(r))).json();assert.equal(me.user.email,'tester@example.test');assert.equal(me.user.canTrial,true);assert.equal(me.access.active,false);
 const replay=await callback(flow);assert.equal(replay.headers.get('location'),origin+'/account.html?google=failed');assert.equal(session(replay),undefined);assert.equal(exchanges,1);
});
test('copied state from a different browser cannot consume the legitimate flow',async()=>{
 const flow=await start();const bad=await callback({...flow,cookie:'__Host-fm_oauth='+'f'.repeat(64)});
 assert.equal(session(bad),undefined);assert.equal(exchanges,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM oauth_flows').get().n,1);
 assert.ok(session(await callback(flow)));
});
test('expired state and cancelled authorization never exchange codes',async()=>{
 const flow=await start();db.prepare('UPDATE oauth_flows SET expires_at=0').run();assert.equal(session(await callback(flow)),undefined);
 const next=await start();const cancelled=await callback(next,'&error=access_denied');assert.equal(cancelled.headers.get('location'),origin+'/account.html?google=cancelled');assert.equal(exchanges,0);
});
test('tampered token claims and signature fail verification',async()=>{
 const localKeys=createLocalJWKSet({keys:[jwk]});
 for(const override of [{nonce:'wrong'},{aud:'other.apps.googleusercontent.com'},{iss:'https://evil.test'},{email_verified:false},{exp:1},{iat:Math.floor(Date.now()/1000)+3600},{azp:'other-client'},{sub:''}])await assert.rejects(verifyGoogleToken(await signed('nonce',override),client,'nonce',localKeys));
 await assert.rejects(verifyGoogleToken(await signed('nonce',{},otherPair.privateKey),client,'nonce',localKeys));
});
test('bad Google identity cannot create an account through callback',async()=>{
 const flow=await start();claims={nonce:'incorrect'};const r=await callback(flow);assert.equal(session(r),undefined);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
});
test('email-only existing account is not silently linked to Google',async()=>{
 db.prepare('INSERT INTO users(id,email,created_at) VALUES(?,?,?)').run('existing','tester@example.test',Date.now());
 const r=await callback(await start());assert.equal(r.headers.get('location'),origin+'/account.html?google=account_conflict');assert.equal(session(r),undefined);assert.equal(db.prepare('SELECT google_sub FROM users').get().google_sub,null);
});
test('stable Google identity preserves trial when its email changes',async()=>{
 await callback(await start());db.prepare('UPDATE users SET trial_started_at=1,trial_ends_at=2').run();const id=db.prepare('SELECT id FROM users').get().id;
 const flow=await start();claims={email:'changed@example.test'};assert.ok(session(await callback(flow)));
 const user=db.prepare('SELECT * FROM users').get();assert.equal(user.id,id);assert.equal(user.email,'changed@example.test');assert.equal(user.trial_ends_at,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
});
test('Google mode disables email OTP and rejects arbitrary post-login destinations',async()=>{
 assert.equal((await req('/api/auth/request',{email:'tester@example.test'})).status,404);
 assert.equal((await req('/api/auth/verify',{id:'any',code:'123456'})).status,404);
 await start('https://evil.test');assert.equal(db.prepare('SELECT next_path FROM oauth_flows').get().next_path,'/account.html');
});

test('owner commissioning rejects a verified outsider before storing an account or session',async()=>{
 Object.assign(env,{AUTH_ACCESS:'owner-test',SUPPORT_EMAIL:'owner@example.test'});
 const r=await callback(await start());assert.equal(r.headers.get('location'),origin+'/account.html?google=restricted');
 assert.equal(session(r),undefined);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
});

test('owner commissioning accepts only the verified controller and does not start a trial',async()=>{
 Object.assign(env,{AUTH_ACCESS:'owner-test',SUPPORT_EMAIL:'TESTER@example.test'});
 const r=await callback(await start());assert.ok(session(r));
 const me=await(await req('/api/me',undefined,session(r))).json();assert.equal(me.authRestricted,true);assert.equal(me.user.canTrial,true);assert.equal(me.access.active,false);
});

test('restriction applies to existing sessions and disabling auth revokes access immediately',async()=>{
 const r=await callback(await start()),cookie=session(r);
 db.prepare('UPDATE users SET trial_started_at=?,trial_ends_at=?').run(Date.now(),Date.now()+3600000);
 Object.assign(env,{AUTH_ACCESS:'owner-test',SUPPORT_EMAIL:'different@example.test'});
 assert.equal((await(await req('/api/me',undefined,cookie)).json()).user,null);
 assert.equal((await req('/data/punteggi.json',undefined,cookie)).status,403);
 assert.equal((await req('/api/trial',{},cookie)).status,401);
 env.SUPPORT_EMAIL='tester@example.test';assert.equal((await(await req('/api/me',undefined,cookie)).json()).access.active,true);
 env.AUTH_ENABLED='false';assert.equal((await(await req('/api/me',undefined,cookie)).json()).user,null);
 assert.equal((await req('/data/punteggi.json',undefined,cookie)).status,403);
});

test('commissioning fails closed with absent owner, unknown mode or live payments',async()=>{
 env.AUTH_ACCESS='owner-test';assert.equal(session(await callback(await start())),undefined);
 Object.assign(env,{SUPPORT_EMAIL:'tester@example.test',AUTH_ACCESS:'typo'});assert.equal(session(await callback(await start())),undefined);
 Object.assign(env,{AUTH_ACCESS:'owner-test',PAYMENTS_MODE:'live'});assert.equal(session(await callback(await start())),undefined);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
});

test('email endpoints cannot bypass owner commissioning when provider is misconfigured',async()=>{
 Object.assign(env,{AUTH_ACCESS:'owner-test',AUTH_PROVIDER:'email',SUPPORT_EMAIL:'tester@example.test'});
 assert.equal((await req('/api/auth/request',{email:'tester@example.test'})).status,403);
 assert.equal((await req('/api/auth/verify',{id:'any',code:'123456'})).status,403);
});
