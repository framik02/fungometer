// Connect the owner's existing test account. Never print credential values.
import {readFile,writeFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const input=JSON.parse(await readFile('.env.stripe-owned.json','utf8'));
const expected='acct_1UNagg6rXkAtOQUc';
if(config.name!=='fungometer'||config.vars.PAYMENTS_MODE!=='test'||config.vars.AUTH_ACCESS!=='owner-test'||input.account!==expected||!/^sk_test_[A-Za-z0-9]+$/.test(input.key||''))throw new Error('Owner test configuration required.');
async function api(path,params){
 const r=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers:{Authorization:'Bearer '+input.key,...(params?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'fungometer-owned-test-webhook-v1-'+expected}:{})},...(params?{body:params}:{}),signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw new Error('Stripe HTTP '+r.status+'; '+(data.error?.code||data.error?.type||'unknown'));return data;
}
const account=await api('account');
if(account.id!==expected)throw new Error('Credential belongs to a different account.');
const url=config.vars.APP_ORIGIN+'/api/stripe/webhook';
const endpoints=await api('webhook_endpoints?limit=100');
const matching=endpoints.data.filter(e=>e.url===url&&e.livemode===false);
console.log(JSON.stringify({account:account.id,testKey:true,matchingEndpoints:matching.map(e=>({id:e.id,status:e.status}))}));
if(process.argv.includes('--configure')){
 let saved=null;try{saved=JSON.parse(await readFile('.env.stripe-owned-import.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(matching.length){
  if(matching.length!==1||saved?.webhookId!==matching[0].id||saved?.account!==expected||saved?.key!==input.key||!saved?.webhookSecret)throw new Error('Existing endpoint requires its saved signing secret; no duplicate will be created.');
  console.log('Existing verified endpoint reused; private transfer file retained.');
 }else{
  const events=['checkout.session.completed','checkout.session.async_payment_succeeded','charge.refunded','charge.dispute.created','charge.dispute.closed'];
  const params=new URLSearchParams({url,description:'FungoMeter — account del gestore, solo pagamenti di prova'});events.forEach(e=>params.append('enabled_events[]',e));
  const endpoint=await api('webhook_endpoints',params);
  if(endpoint.livemode!==false||endpoint.url!==url||!/^whsec_[A-Za-z0-9]+$/.test(endpoint.secret||''))throw new Error('Unexpected endpoint response.');
  await writeFile('.env.stripe-owned-import.json',JSON.stringify({account:expected,expires:null,webhookId:endpoint.id,key:input.key,webhookSecret:endpoint.secret,url,livemode:false}));
  console.log(JSON.stringify({webhookId:endpoint.id,status:endpoint.status,livemode:endpoint.livemode,url}));
 }
}
