import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8')).vars,origin=config.APP_ORIGIN;
for(const path of ['/','/prezzi.html','/account.html','/info.html']){
 const r=await fetch(origin+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/text\/html/);
}
for(const path of ['/data/punteggi.json','/data/segnalati_web.json','/%64ata/punteggi_roma.json','/data/italia/meteo/i4700n1100.json']){
 const r=await fetch(origin+path);assert.equal(r.status,403,path);assert.match(r.headers.get('cache-control'),/no-store/);
}
const r=await fetch(origin+'/api/me'),me=await r.json();
assert.equal(me.user,null);assert.equal(me.access.active,false);assert.equal(me.authEnabled,config.AUTH_ENABLED==='true');assert.equal(me.paymentsReady,!config.STRIPE_TEST_EXPIRES_AT||Date.parse(config.STRIPE_TEST_EXPIRES_AT)>Date.now());assert.equal(me.paymentsMode,'test');
assert.equal(me.seller.name,'Francesco Chiarolanza');assert.equal(me.seller.email,'fungometer@gmail.com');
if(me.authEnabled){assert.equal(me.authRestricted,true);assert.equal(me.googleReady,true);}
console.log('Staging verified: pages online, data gated, owner commissioning and Stripe test only.');
