import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.name!=='fungometer'||config.vars.APP_ENV==='local')throw new Error('Unexpected deployment target.');
const cli='node_modules/wrangler/bin/wrangler.js';
const result=spawnSync(process.execPath,[cli,'secret','list'],{encoding:'utf8',windowsHide:true});
if(result.status!==0)throw new Error('Cannot inspect configured secret names; no changes made.');
const existing=JSON.parse(result.stdout);
if(existing.some(secret=>secret.name==='AUTH_SECRET')){
 console.log('AUTH_SECRET already exists; retained without reading its value.');
}else{
 const secret=randomBytes(32).toString('hex');
 const uploaded=spawnSync(process.execPath,[cli,'secret','put','AUTH_SECRET'],{input:secret+'\n',encoding:'utf8',windowsHide:true});
 if(uploaded.status!==0)throw new Error('Secret upload did not confirm success. Check names before retrying.');
 console.log('AUTH_SECRET generated and stored in Cloudflare. Value was not printed or saved locally.');
}
