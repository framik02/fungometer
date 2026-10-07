import assert from 'node:assert/strict';

export function verifyPublicConfig(config,me,now=Date.now()){
 assert.ok(['test','live'].includes(config.PAYMENTS_MODE),'Explicit payment mode required');
 assert.equal(me.user,null,'Anonymous request must not expose an account');
 assert.equal(me.access.active,false,'Anonymous request must not have map access');
 assert.equal(me.local,false,'Local authentication must never be deployed');
 assert.equal(me.authEnabled,config.AUTH_ENABLED==='true','Authentication switch differs');
 assert.equal(me.authRestricted,config.AUTH_ACCESS==='owner-test','Audience differs');
 assert.equal(me.paymentsMode,config.PAYMENTS_MODE,'Deployed Stripe mode differs');
 const ready=config.PAYMENTS_MODE==='test'
  ?!config.STRIPE_TEST_EXPIRES_AT||Date.parse(config.STRIPE_TEST_EXPIRES_AT)>now
  :['LIVE_SALES_READY','LICENSES_READY','PRIVATE_DATA_READY'].every(key=>config[key]==='true')
   &&['SELLER_NAME','SELLER_ADDRESS','SELLER_TAX_ID','SUPPORT_EMAIL'].every(key=>Boolean(config[key]));
 assert.equal(me.paymentsReady,ready,'Payment readiness differs; check matching secrets and release settings');
 for(const [property,key] of Object.entries({name:'SELLER_NAME',address:'SELLER_ADDRESS',taxId:'SELLER_TAX_ID',email:'SUPPORT_EMAIL'}))assert.equal(me.seller[property],config[key]||'','Seller '+property+' differs');
 if(me.authEnabled&&config.AUTH_PROVIDER==='google')assert.equal(me.googleReady,true,'Google access unavailable');
}
