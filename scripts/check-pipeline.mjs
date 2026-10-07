import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8')).vars;
for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'])if(!process.env[key])throw new Error('Configurazione mancante: '+key);
if(process.env.WEATHER_MODE==='owner-preview'){
  if(config.AUTH_ACCESS!=='owner-test'||config.APP_ENV!=='staging'||config.PAYMENTS_MODE!=='test')throw new Error('Il meteo di collaudo è consentito solo con accesso riservato al gestore e pagamenti simulati.');
}else if(process.env.WEATHER_MODE!=='commercial'||!process.env.OPEN_METEO_API_KEY){
  throw new Error('Per aggiornare il prodotto commerciale configurare WEATHER_MODE=commercial e OPEN_METEO_API_KEY.');
}
console.log('Aggiornamento verificato: '+process.env.WEATHER_MODE);
