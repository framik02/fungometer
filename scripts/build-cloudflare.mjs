import {cp,mkdir,readdir,stat,writeFile,rm} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
const root=resolve('.'),out=resolve('dist');
if(!out.startsWith(root+sep)||relative(root,out)!=='dist')throw new Error('Unsafe output directory');
await mkdir(out,{recursive:true});
for(const name of await readdir(out)) {
  const target=resolve(out,name);
  if(!target.startsWith(out+sep))throw new Error('Unsafe build entry');
  await rm(target,{recursive:true,force:true});
}
await cp('docs',out,{recursive:true});
let count=0,total=0;
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())await scan(path);else{const file=await stat(path);if(file.size>25*1024*1024)throw new Error('File exceeds Cloudflare limit: '+relative(root,path));count++;total+=file.size;}}}
await scan(out);if(count>20000)throw new Error('Too many assets for free tier');
await writeFile(resolve(out,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/data/*\n  Cache-Control: private, no-store\n');
console.log(`Cloudflare build: ${count} files, ${(total/1024/1024).toFixed(1)} MiB.`);
