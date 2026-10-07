import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyPublicConfig} from './verify-public-config.mjs';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8')).vars,origin=config.APP_ORIGIN;
const get=path=>fetch(origin+path,{signal:AbortSignal.timeout(20000),redirect:'error'});
for(const path of ['/','/prezzi.html','/account.html','/info.html']){
 const r=await get(path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/text\/html/);
}
for(const path of ['/data/punteggi.json','/data/segnalati_web.json','/%64ata/punteggi_roma.json','/data/italia/meteo/i4700n1100.json']){
 const r=await get(path);assert.equal(r.status,403,path);assert.match(r.headers.get('cache-control'),/no-store/);
}
for(const path of ['/api/orders','/api/requests','/api/account/export','/api/owner/care']){
 const r=await get(path);assert.equal(r.status,401,path);assert.match(r.headers.get('cache-control'),/no-store/);
}
const r=await get('/api/me');assert.equal(r.status,200);const me=await r.json();
verifyPublicConfig(config,me);
console.log(`Published app verified: pages online, anonymous data protected, audience ${config.AUTH_ACCESS}, Stripe ${config.PAYMENTS_MODE}.`);
