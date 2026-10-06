import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {validateRelease} from '../scripts/validate-release.mjs';

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'fungometer-release-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const now=Date.parse('2026-10-06T06:00:00Z'), timestamp=new Date(now).toISOString();
 const days=Array.from({length:8},(_,i)=>`2026-10-${String(6+i).padStart(2,'0')}`);
 const seq=Array(8).fill(1), local=Object.fromEntries(['p','u','k','tr','g','tn','tx'].map(k=>[k,seq]));
 local.s=[{fa:seq,ft:seq,fs:seq}];
 const national=Object.fromEntries(['p','u','k','tr','c','tn','tx'].map(k=>[k,seq]));national.gm=Array(14).fill(1);
 const files={
  'punteggi.json':{aggiornato:timestamp,giorni:days,aree:['test'],specie:[{id:'porcino'}]},
  'punteggi_test.json':{celle:{local}},
  'italia/indice.json':{tile:[42,12,43,13,1]},
  'italia/meteo/tile.json':{group:national},
  'italia/panoramica.json':{ids:['group'],gruppi:[[42,12,43,13]],nomi:['Test'],p:Buffer.alloc(8).toString('base64'),a:Buffer.alloc(8).toString('base64')}
 };
 const write=async(name,value)=>{const p=join(root,name);await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(value));};
 await write('data/celle.json',[{id:'local',area:'test'}]);await write('data/italia_gruppi.json',{group:{riquadro:'tile'}});
 const seal=async()=>{
  const hashes={};for(const [name,value] of Object.entries(files)){await write('docs/data/'+name,value);hashes[name]=createHash('sha256').update(await readFile(join(root,'docs/data',name))).digest('hex');}
  await write('docs/data/release.json',{version:1,aggiornato:timestamp,giorni:days,files:hashes});
 };
 await seal();return {root,now,files,seal,write};
}
test('complete national release passes',async t=>{const f=await fixture(t);assert.equal((await validateRelease(f.root,f.now)).groups,1);});
test('partial regeneration cannot mix old and new files',async t=>{const f=await fixture(t);await f.write('docs/data/punteggi_test.json',{celle:{}});await assert.rejects(validateRelease(f.root,f.now),/aggiornamenti diversi/);});
test('missing national tile blocks publication',async t=>{const f=await fixture(t);await rm(join(f.root,'docs/data/italia/meteo/tile.json'));await assert.rejects(validateRelease(f.root,f.now));});
test('missing group blocks even a correctly hashed release',async t=>{const f=await fixture(t);f.files['italia/meteo/tile.json']={};await f.seal();await assert.rejects(validateRelease(f.root,f.now),/Gruppo meteo mancante/);});
test('missing values block even a correctly hashed release',async t=>{const f=await fixture(t);f.files['punteggi_test.json'].celle.local.u=[null,...Array(7).fill(1)];await f.seal();await assert.rejects(validateRelease(f.root,f.now),/Serie meteo incompleta/);});
test('stale release blocks publication',async t=>{const f=await fixture(t);await assert.rejects(validateRelease(f.root,f.now+7*3600000),/Dati scaduti/);});
test('wrong calendar blocks publication',async t=>{const f=await fixture(t);f.files['punteggi.json'].giorni[1]='2026-10-08';await f.seal();await assert.rejects(validateRelease(f.root,f.now),/Calendario/);});
