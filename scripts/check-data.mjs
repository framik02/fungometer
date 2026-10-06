import {readFile,readdir} from 'node:fs/promises';
const base=JSON.parse(await readFile('docs/data/punteggi.json','utf8'));
const age=Date.now()-Date.parse(base.aggiornato);
if(!Number.isFinite(age)||age< -3600000||age>6*3600000||base.giorni?.length!==8)throw new Error('Forecast is stale or incomplete: deployment stopped.');
const files=await readdir('docs/data/italia/meteo');
if(!files.some(f=>f.endsWith('.json')))throw new Error('National weather data missing.');
console.log('Forecast timestamp and national data presence checked.');
