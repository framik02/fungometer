import {normalizeEmail} from './core.mjs';

// Owner-only commissioning is enforced after Google verification and on every
// session lookup. It does not depend on Google's list of test users.
export function authAccessAllowed(env,email){
 if(!env.AUTH_ACCESS||env.AUTH_ACCESS==='public')return true;
 if(env.AUTH_ACCESS!=='owner-test'||env.AUTH_PROVIDER!=='google'||env.PAYMENTS_MODE!=='test')return false;
 try{return normalizeEmail(email)===normalizeEmail(env.SUPPORT_EMAIL);}catch{return false;}
}
