import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=resolve('scripts/check-pipeline.mjs');
test('daily publishing isolates owner preview and requires a key for commercial use',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fm-pipeline-'));
 try{
  const vars={AUTH_ACCESS:'owner-test',APP_ENV:'staging',PAYMENTS_MODE:'test'};
  const run=async(v,extra={})=>{await writeFile(join(dir,'wrangler.jsonc'),JSON.stringify({vars:v}));return spawnSync(process.execPath,[script],{cwd:dir,env:{...process.env,CLOUDFLARE_API_TOKEN:'test-placeholder',CLOUDFLARE_ACCOUNT_ID:'test-account',OPEN_METEO_API_KEY:'',WEATHER_MODE:'owner-preview',...extra},encoding:'utf8',windowsHide:true});};
  assert.equal((await run(vars)).status,0);
  assert.notEqual((await run({...vars,AUTH_ACCESS:'public'})).status,0);
  assert.notEqual((await run({...vars,PAYMENTS_MODE:'live'})).status,0);
  assert.notEqual((await run(vars,{WEATHER_MODE:'commercial'})).status,0);
  assert.equal((await run({...vars,AUTH_ACCESS:'public'},{WEATHER_MODE:'commercial',OPEN_METEO_API_KEY:'test-placeholder'})).status,0);
  assert.notEqual((await run(vars,{CLOUDFLARE_API_TOKEN:''})).status,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
