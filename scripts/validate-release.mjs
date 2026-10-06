import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

export async function validateRelease(root='.', now=Date.now()) {
 const data=resolve(root,'docs/data');
 const read=async name=>JSON.parse(await readFile(resolve(data,name),'utf8'));
 const base=await read('punteggi.json'), manifest=await read('release.json');
 const age=now-Date.parse(base.aggiornato);
 if(!Number.isFinite(age)||age< -3600000||age>6*3600000)throw new Error('Dati scaduti: pubblicazione bloccata.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const days=Array.from({length:8},(_,i)=>new Date(Date.parse(today+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
 if(JSON.stringify(base.giorni)!==JSON.stringify(days))throw new Error('Calendario nazionale non aggiornato.');
 if(manifest.version!==1||manifest.aggiornato!==base.aggiornato||JSON.stringify(manifest.giorni)!==JSON.stringify(days))throw new Error('Aggiornamento nazionale non completato.');
 const index=await read('italia/indice.json');
 const groups=JSON.parse(await readFile(resolve(root,'data/italia_gruppi.json'),'utf8'));
 const cells=JSON.parse(await readFile(resolve(root,'data/celle.json'),'utf8'));
 const areas=[...new Set(cells.map(c=>c.area))].sort();
 if(!Object.keys(index).length||!Object.keys(groups).length||!cells.length||!base.specie?.length||JSON.stringify(areas)!==JSON.stringify(base.aree))throw new Error('Copertura di base incompleta.');
 const files=['punteggi.json','italia/indice.json','italia/panoramica.json',...areas.map(a=>`punteggi_${a}.json`),...Object.keys(index).map(t=>`italia/meteo/${t}.json`)];
 if(JSON.stringify(Object.keys(manifest.files||{}).sort())!==JSON.stringify(files.slice().sort()))throw new Error('Manifesto incompleto.');
 for(const name of files){
  const hash=createHash('sha256').update(await readFile(resolve(data,name))).digest('hex');
  if(manifest.files[name]!==hash)throw new Error('File di aggiornamenti diversi: '+name);
 }
 const series=(v,n,label)=>{if(!Array.isArray(v)||v.length!==n||v.some(x=>typeof x!=='number'||!Number.isFinite(x)))throw new Error('Serie meteo incompleta: '+label);};
 for(const area of areas){
  const local=(await read(`punteggi_${area}.json`)).celle;
  const expected=cells.filter(c=>c.area===area).map(c=>c.id).sort();
  if(JSON.stringify(Object.keys(local).sort())!==JSON.stringify(expected))throw new Error('Celle mancanti: '+area);
  for(const [id,v] of Object.entries(local)){
   for(const key of ['p','u','k','tr','g','tn','tx'])series(v[key],8,id+'/'+key);
   if(v.s?.length!==base.specie.length)throw new Error('Specie mancanti: '+id);
   for(const s of v.s)for(const key of ['fa','ft','fs'])series(s[key],8,id+'/'+key);
  }
 }
 for(const tile of Object.keys(index)){
  const weather=await read(`italia/meteo/${tile}.json`);
  for(const [id] of Object.entries(groups).filter(([,g])=>g.riquadro===tile)){
   const v=weather[id];if(!v)throw new Error('Gruppo meteo mancante: '+id);
   for(const key of ['p','u','k','tr','c','tn','tx'])series(v[key],8,id+'/'+key);
   series(v.gm,14,id+'/gm');
  }
 }
 for(const g of Object.values(groups))if(!index[g.riquadro])throw new Error('Gruppo fuori indice.');
 const overview=await read('italia/panoramica.json');
 if(!overview.ids?.length||overview.gruppi?.length!==overview.ids.length||overview.nomi?.length!==overview.ids.length)throw new Error('Panoramica incompleta.');
 for(const key of ['p','a'])if(Buffer.from(overview[key]||'','base64').length!==overview.ids.length*base.specie.length*8)throw new Error('Panoramica troncata.');
 for(const id of Object.keys(groups))if(!overview.ids.includes(id))throw new Error('Gruppo assente dalla panoramica: '+id);
 return {updated:base.aggiornato,tiles:Object.keys(index).length,groups:Object.keys(groups).length,cells:cells.length,files:files.length};
}
