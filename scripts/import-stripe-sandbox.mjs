import {readFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const owned=process.argv.includes('--owned');
const path=owned?'.env.stripe-owned-import.json':'.env.stripe-import.json';
const data=JSON.parse(await readFile(path,'utf8'));
if(config.name!=='fungometer'||config.vars.AUTH_ACCESS!=='owner-test'||config.vars.PAYMENTS_MODE!=='test'||data.url!==config.vars.APP_ORIGIN+'/api/stripe/webhook')throw new Error('Unexpected target.');
if(owned){
 if(data.account!=='acct_1UNagg6rXkAtOQUc'||data.livemode!==false||data.expires!==null||!/^sk_test_[A-Za-z0-9]+$/.test(data.key||''))throw new Error('Expected the permanent owner test account.');
 const response=await fetch('https://api.stripe.com/v1/account',{headers:{Authorization:'Bearer '+data.key},signal:AbortSignal.timeout(20000)});
 if(!response.ok||(await response.json()).id!==data.account)throw new Error('Stripe account verification failed before import.');
}else if(!(Date.parse(data.expires)>Date.now()))throw new Error('Expired sandbox.');
if(!/^(?:sk|rk|rkcs)_test_[A-Za-z0-9]+$/.test(data.key)||!/^whsec_[A-Za-z0-9]+$/.test(data.webhookSecret))throw new Error('Only sandbox credentials are accepted.');
for(const [name,value] of [['STRIPE_WEBHOOK_SECRET',data.webhookSecret],['STRIPE_SECRET_KEY',data.key]]){
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put',name],{input:value+'\n',encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw new Error('Secret upload not confirmed for '+name+'. Private recovery file retained.');
}
const check=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','list'],{encoding:'utf8',windowsHide:true});
if(check.status!==0)throw new Error('Could not verify secret names.');
const names=JSON.parse(check.stdout).map(x=>x.name);
if(!['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'].every(n=>names.includes(n)))throw new Error('Missing Stripe configuration.');
if(!owned)await unlink(path);
console.log('Both Stripe test secrets stored in Cloudflare. Live payments remain disabled.');
