import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const v=config.vars;
if(config.d1_databases[0].database_id.startsWith('00000000'))throw new Error('Create the Cloudflare D1 database and set database_id first.');
if(!/^https:\/\//.test(v.APP_ORIGIN)||v.APP_ORIGIN.includes('REPLACE'))throw new Error('Configure the deployed HTTPS origin first.');
if(v.APP_ENV==='local')throw new Error('Local authentication must never be deployed.');
if(v.AUTH_ENABLED==='true'){
  if(!v.SELLER_NAME||!v.SUPPORT_EMAIL)throw new Error('Complete controller identity and contact before public registration.');
  if(v.AUTH_PROVIDER==='google'){
    if(!v.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com'))throw new Error('Configure Google web client before enabling access.');
  }else if(!v.TURNSTILE_SITE_KEY||!v.MAIL_FROM)throw new Error('Configure email and Turnstile before public registration.');
  for(const file of ['privacy.html','condizioni.html'])if(/bozza|Versione preparatoria|ancora da configurare/i.test(await readFile('docs/'+file,'utf8')))throw new Error('Complete legal drafts before public registration.');
}
if(v.PAYMENTS_MODE==='live'){
  if(['LIVE_SALES_READY','LICENSES_READY','PRIVATE_DATA_READY'].some(key=>v[key]!=='true')||!v.SELLER_NAME||!v.SELLER_ADDRESS||!v.SELLER_TAX_ID||!v.SUPPORT_EMAIL)throw new Error('Live sales prerequisites are incomplete. Keep Stripe in test mode.');
  for(const file of ['privacy.html','condizioni.html'])if(/bozza|Versione preparatoria|ancora da configurare/i.test(await readFile('docs/'+file,'utf8')))throw new Error('Replace draft legal documents before live sales.');
}
console.log('Deploy configuration checked. Mode: '+v.PAYMENTS_MODE);
