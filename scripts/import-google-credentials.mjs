import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

// Read the temporary, Git-ignored export without printing credential values.
const file='.env.google-import.json';
const configPath='wrangler.jsonc';
const source=await readFile(configPath,'utf8');
const config=JSON.parse(source);
const expectedId='751296262314-2ie6p5ffcu8iodmpeek0g7csiqg2ahp8.apps.googleusercontent.com';
const target='https://fungometer.chiarolanza-francesco.workers.dev';
if(config.name!=='fungometer'||config.vars.APP_ORIGIN!==target||config.vars.AUTH_ENABLED!=='false')throw new Error('Unexpected deployment target or enabled registration; no changes made.');
let credentials;
try{credentials=JSON.parse(await readFile(file,'utf8'));}catch{throw new Error('Missing or invalid temporary credential file; no changes made.');}
if(credentials.client_id!==expectedId||!/^GOCSPX-[A-Za-z0-9_-]{20,}$/.test(credentials.client_secret||''))throw new Error('Unexpected Google credentials; no changes made.');
const cli='node_modules/wrangler/bin/wrangler.js';
const result=spawnSync(process.execPath,[cli,'secret','put','GOOGLE_CLIENT_SECRET'],{input:credentials.client_secret+'\n',encoding:'utf8',windowsHide:true});
if(result.status!==0)throw new Error('Cloudflare did not confirm the secret upload. Credential values were not printed; temporary file retained for recovery.');
const names=spawnSync(process.execPath,[cli,'secret','list'],{encoding:'utf8',windowsHide:true});
if(names.status!==0||!JSON.parse(names.stdout).some(s=>s.name==='GOOGLE_CLIENT_SECRET'))throw new Error('Cannot confirm secret presence; temporary file retained for recovery.');
await writeFile(configPath,source.replace(/"GOOGLE_CLIENT_ID":\s*"[^"]*"/,'"GOOGLE_CLIENT_ID": "'+expectedId+'"'));
await unlink(file);
console.log('Google secret stored in Cloudflare; client ID configured locally; temporary credential file removed. Registration remains disabled. Deploy the updated configuration next.');
