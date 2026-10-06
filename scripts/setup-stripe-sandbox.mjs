import {readFile,writeFile} from 'node:fs/promises';

// Local CLI credentials and webhook responses stay in Git-ignored files.
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.name!=='fungometer'||config.vars.AUTH_ACCESS!=='owner-test'||config.vars.PAYMENTS_MODE!=='test')throw new Error('Only owner commissioning in test mode is supported.');
const toml=await readFile('.env.stripe-cli.toml','utf8');
const value=key=>toml.match(new RegExp('^\\s*'+key+'\\s*=\\s*[\x22\x27]([^\x22\x27\\r\\n]+)[\x22\x27]','m'))?.[1];
const key=value('test_mode_api_key'),account=value('account_id'),expires=value('sandbox_expires_at');
if(!/^(?:sk|rk|rkcs)_test_[A-Za-z0-9]+$/.test(key||'')||!/^acct_[A-Za-z0-9]+$/.test(account||'')||!(Date.parse(expires)>Date.now()))throw new Error('Missing or expired sandbox credentials.');
const url=config.vars.APP_ORIGIN+'/api/stripe/webhook';
const events=['checkout.session.completed','checkout.session.async_payment_succeeded','charge.refunded','charge.dispute.created','charge.dispute.closed'];
const params=new URLSearchParams({url,description:'FungoMeter — collaudo riservato, solo test'});
events.forEach(e=>params.append('enabled_events[]',e));
const response=await fetch('https://api.stripe.com/v1/webhook_endpoints',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'fungometer-owner-sandbox-webhook-'+account},body:params,signal:AbortSignal.timeout(20000)});
const result=await response.json();
if(!response.ok)throw new Error('Stripe webhook setup failed: HTTP '+response.status+'; '+(result.error?.code||result.error?.type||'unknown'));
if(result.livemode!==false||result.url!==url||!/^whsec_[A-Za-z0-9]+$/.test(result.secret||''))throw new Error('Unexpected webhook response.');
await writeFile('.env.stripe-import.json',JSON.stringify({account,expires,webhookId:result.id,key,webhookSecret:result.secret,url}));
console.log(JSON.stringify({account,expires,webhookId:result.id,livemode:result.livemode,status:result.status,url:result.url}));
