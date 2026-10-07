// Disable only the obsolete, temporary test webhook after a verified cutover.
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.vars.PAYMENTS_MODE!=='test'||config.vars.AUTH_ACCESS!=='owner-test'||config.vars.STRIPE_TEST_EXPIRES_AT)throw new Error('Permanent owner test cutover required.');
const toml=await readFile('.env.stripe-cli.toml','utf8');
const key=toml.match(/^\s*test_mode_api_key\s*=\s*["']([^"'\r\n]+)["']/m)?.[1];
if(!/^rkcs_test_[A-Za-z0-9]+$/.test(key||''))throw new Error('Expected temporary test credential.');
async function api(path,params){
 const r=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers:{Authorization:'Bearer '+key,...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(params?{body:new URLSearchParams(params)}:{}),signal:AbortSignal.timeout(20000)});
 const d=await r.json();if(!r.ok)throw new Error('Temporary account HTTP '+r.status);return d;
}
// Claimable keys cannot read /account; bind to the original CLI account and
// the exact webhook ID created by that key, then verify its test flag and URL.
const account=toml.match(/^\s*account_id\s*=\s*["']([^"'\r\n]+)["']/m)?.[1];
if(account!=='acct_1UNZNcG3kQut9xSw')throw new Error('Wrong temporary account.');
const id='we_1UNaW9G3kQut9xSwIxdq0JS8';
const endpoint=await api('webhook_endpoints/'+id);
if(endpoint.livemode!==false||endpoint.url!==config.vars.APP_ORIGIN+'/api/stripe/webhook')throw new Error('Unexpected old endpoint.');
const result=endpoint.status==='disabled'?endpoint:await api('webhook_endpoints/'+id,{disabled:'true'});
if(result.status!=='disabled')throw new Error('Disable not confirmed.');
console.log(JSON.stringify({account:'acct_1UNZNcG3kQut9xSw',webhook:id,status:result.status,testOnly:true}));
