import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPublicConfig} from '../scripts/verify-public-config.mjs';
const config={PAYMENTS_MODE:'live',AUTH_ACCESS:'public',AUTH_ENABLED:'true',AUTH_PROVIDER:'google',LIVE_SALES_READY:'true',LICENSES_READY:'true',PRIVATE_DATA_READY:'true',SELLER_NAME:'Test seller',SELLER_ADDRESS:'Test address',SELLER_TAX_ID:'TEST-ONLY',SUPPORT_EMAIL:'test@example.test'};
const state=()=>({user:null,access:{active:false},local:false,authEnabled:true,authRestricted:false,paymentsMode:'live',paymentsReady:true,googleReady:true,seller:{name:'Test seller',address:'Test address',taxId:'TEST-ONLY',email:'test@example.test'}});
test('public live release check accepts the intended deployment and rejects leftover test mode',()=>{
 assert.doesNotThrow(()=>verifyPublicConfig(config,state()));
 assert.throws(()=>verifyPublicConfig(config,{...state(),paymentsMode:'test'}),/Stripe mode/);
 assert.throws(()=>verifyPublicConfig(config,{...state(),authRestricted:true}),/Audience/);
});
test('release check catches missing live credentials and unintended public access',()=>{
 assert.throws(()=>verifyPublicConfig(config,{...state(),paymentsReady:false}),/readiness/);
 assert.throws(()=>verifyPublicConfig(config,{...state(),user:{email:'private@example.test'}}),/expose an account/);
 assert.throws(()=>verifyPublicConfig(config,{...state(),access:{active:true}}),/map access/);
 assert.throws(()=>verifyPublicConfig(config,{...state(),local:true}),/Local/);
});
test('release check supports owner commissioning without misclassifying it as live',()=>{
 const preview={...config,PAYMENTS_MODE:'test',AUTH_ACCESS:'owner-test'};
 const me={...state(),paymentsMode:'test',authRestricted:true};
 assert.doesNotThrow(()=>verifyPublicConfig(preview,me));
 const expired={...preview,STRIPE_TEST_EXPIRES_AT:'2020-01-01T00:00:00Z'};
 assert.throws(()=>verifyPublicConfig(expired,me),/readiness/);
 assert.doesNotThrow(()=>verifyPublicConfig(expired,{...me,paymentsReady:false}));
});
