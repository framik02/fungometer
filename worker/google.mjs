import {createRemoteJWKSet,customFetch,jwtVerify} from 'jose';
import {DAY,hmac,normalizeEmail,equal} from './core.mjs';
import {authAccessAllowed} from './auth-access.mjs';

const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{
  [customFetch]:(...args)=>fetch(...args),timeoutDuration:10000
});
export const googleReady=env=>Boolean(env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com')&&env.GOOGLE_CLIENT_SECRET&&env.AUTH_SECRET?.length>=32);
const random=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const cookieName=request=>new URL(request.url).protocol==='https:'?'__Host-fm_oauth':'fm_oauth';
function flowCookie(value,request,maxAge=600){return `${cookieName(request)}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
async function challenge(verifier){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}

export async function verifyGoogleToken(token,clientId,nonce,keySet=keys){
 const {payload}=await jwtVerify(token,keySet,{issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat','email','email_verified','nonce'],maxTokenAge:'10 minutes',clockTolerance:5});
 if(!equal(payload.nonce,nonce)||payload.email_verified!==true||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||(payload.azp&&payload.azp!==clientId))throw new Error('Invalid Google identity');
 return {sub:payload.sub,email:normalizeEmail(payload.email)};
}

export async function googleApi(request,env,path,{stmt,fail,json,body,limit,sessionCookie}){
 if(env.AUTH_ENABLED!=='true'||env.AUTH_PROVIDER!=='google'||!googleReady(env))fail(503,'Accesso Google in preparazione. Riprova più tardi.');
 const redirectUri=env.APP_ORIGIN+'/api/auth/google/callback';
 if(path==='/api/auth/google/start'&&request.method==='POST'){
  await limit(env,`google:${request.headers.get('CF-Connecting-IP')||'local'}`,20,15*60000);
  const input=await body(request),state=random(),browser=random(),verifier=random(),nonce=random();
  const next=['season','year'].includes(input.plan)?'/account.html?piano='+input.plan:'/account.html';
  await stmt(env,'INSERT INTO oauth_flows(state_hash,browser_hash,verifier,nonce,next_path,expires_at) VALUES(?,?,?,?,?,?)',await hmac(env.AUTH_SECRET,state),await hmac(env.AUTH_SECRET,browser),verifier,nonce,next,Date.now()+10*60000).run();
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:'openid email',state,nonce,code_challenge:await challenge(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
  return json({url:url.href},200,{'Set-Cookie':flowCookie(browser,request)});
 }
 if(path==='/api/auth/google/callback'&&request.method==='GET'){
  const url=new URL(request.url),state=url.searchParams.get('state');
  const browser=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(request)+'='))?.split('=')[1];
  const finish=(path,session)=>{
   const headers=new Headers({'Location':env.APP_ORIGIN+path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
   headers.append('Set-Cookie',flowCookie('',request,0));if(session)headers.append('Set-Cookie',sessionCookie(session,request));
   return new Response(null,{status:303,headers});
  };
  if(!/^[a-f0-9]{64}$/.test(state||'')||!/^[a-f0-9]{64}$/.test(browser||''))return finish('/account.html?google=failed');
  // Consume only a state bound to this browser. A copied callback cannot sign
  // another browser in, and an authorization code is exchanged at most once.
  const flow=await stmt(env,'DELETE FROM oauth_flows WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *',await hmac(env.AUTH_SECRET,state),await hmac(env.AUTH_SECRET,browser),Date.now()).first();
  if(!flow)return finish('/account.html?google=failed');
  if(url.searchParams.has('error'))return finish('/account.html?google=cancelled');
  const code=url.searchParams.get('code');if(!code||code.length>4096)return finish('/account.html?google=failed');
  let identity;
  try{
   const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:flow.verifier,redirect_uri:redirectUri,grant_type:'authorization_code'})});
   if(!response.ok)throw new Error('Exchange rejected');
   const tokens=await response.json();identity=await verifyGoogleToken(tokens.id_token,env.GOOGLE_CLIENT_ID,flow.nonce);
   // Tokens are intentionally not stored. No Gmail/Drive or refresh access.
  }catch{return finish('/account.html?google=failed');}
  if(!authAccessAllowed(env,identity.email))return finish('/account.html?google=restricted');
  let account=await stmt(env,'SELECT * FROM users WHERE google_sub=?',identity.sub).first();
  if(!account){
   await stmt(env,'INSERT OR IGNORE INTO users(id,email,created_at,google_sub) VALUES(?,?,?,?)',crypto.randomUUID(),identity.email,Date.now(),identity.sub).run();
   account=await stmt(env,'SELECT * FROM users WHERE google_sub=?',identity.sub).first();
   // Never merge an existing email-only or different Google account by email.
   if(!account)return finish('/account.html?google=account_conflict');
  }else if(account.email!==identity.email){
   await stmt(env,'UPDATE OR IGNORE users SET email=? WHERE id=?',identity.email,account.id).run();
   const updated=await stmt(env,'SELECT email FROM users WHERE id=?',account.id).first();
   if(updated.email!==identity.email)return finish('/account.html?google=account_conflict');
  }
  const token=random();
  await stmt(env,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await hmac(env.AUTH_SECRET,token),account.id,Date.now()+30*DAY).run();
  return finish(flow.next_path,token);
 }
 fail(405,'Metodo non consentito.');
}
