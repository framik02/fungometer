import {readFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const data=JSON.parse(await readFile('.env.stripe-import.json','utf8'));
if(config.name!=='fungometer'||config.vars.AUTH_ACCESS!=='owner-test'||config.vars.PAYMENTS_MODE!=='test'||data.url!==config.vars.APP_ORIGIN+'/api/stripe/webhook'||!(Date.parse(data.expires)>Date.now()))throw new Error('Unexpected target or expired sandbox.');
if(!/^(?:sk|rk|rkcs)_test_[A-Za-z0-9]+$/.test(data.key)||!/^whsec_[A-Za-z0-9]+$/.test(data.webhookSecret))throw new Error('Only sandbox credentials are accepted.');
for(const [name,value] of [['STRIPE_WEBHOOK_SECRET',data.webhookSecret],['STRIPE_SECRET_KEY',data.key]]){
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put',name],{input:value+'\n',encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw new Error('Secret upload not confirmed for '+name+'. Private recovery file retained.');
}
const check=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','list'],{encoding:'utf8',windowsHide:true});
if(check.status!==0)throw new Error('Could not verify secret names.');
const names=JSON.parse(check.stdout).map(x=>x.name);
if(!['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'].every(n=>names.includes(n)))throw new Error('Missing Stripe configuration.');
await unlink('.env.stripe-import.json');
console.log('Both Stripe sandbox secrets stored in Cloudflare. Local transfer file removed. Live payments remain disabled.');
