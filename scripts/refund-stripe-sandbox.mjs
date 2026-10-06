import {readFile,writeFile} from 'node:fs/promises';

const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.vars.PAYMENTS_MODE!=='test'||config.vars.AUTH_ACCESS!=='owner-test')throw new Error('Refund helper is for owner sandbox tests only.');
const sessionId=process.argv[2];
if(!/^cs_test_[A-Za-z0-9]+$/.test(sessionId||''))throw new Error('Supply a test Checkout session ID.');
const toml=await readFile('.env.stripe-cli.toml','utf8');
const key=toml.match(/^\s*test_mode_api_key\s*=\s*["']([^"'\r\n]+)["']/m)?.[1];
if(!/^(?:sk|rk|rkcs)_test_[A-Za-z0-9]+$/.test(key||''))throw new Error('Missing sandbox key.');
async function api(path,params){
 const r=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers:{Authorization:'Bearer '+key,...(params?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'fungometer-test-refund-'+sessionId}:{})},...(params?{body:new URLSearchParams(params)}:{}),signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw new Error('Sandbox API failed: HTTP '+r.status+'; '+(data.error?.code||data.error?.type||'unknown'));return data;
}
const session=await api('checkout/sessions/'+sessionId);
if(session.livemode!==false||session.payment_status!=='paid'||session.currency!=='eur'||session.amount_total!==990||session.customer_details?.email!==config.vars.SUPPORT_EMAIL||typeof session.payment_intent!=='string'||!session.success_url?.startsWith(config.vars.APP_ORIGIN+'/account.html?'))throw new Error('Session is not the expected owner test purchase.');
const refund=await api('refunds',{payment_intent:session.payment_intent});
const result={sessionId,refundId:refund.id,status:refund.status,amount:refund.amount,currency:refund.currency,testOnly:true};
await writeFile('.env.stripe-e2e-result.json',JSON.stringify(result));
console.log(JSON.stringify(result));
