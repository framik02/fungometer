# Fungometer — stato operativo

Aggiornato il 7 ottobre 2026. Budget: 100 € iniziali, fino a 30 €/mese.

## Online adesso

https://fungometer.chiarolanza-francesco.workers.dev/

Pagina di presentazione e richiesta di avviso via email. Accesso Google riservato a fungometer@gmail.com, account del gestore con pass simulato fino all’11 gennaio 2027 dopo il collaudo. Pagamenti solo di test; webhook live disabilitato. Nessuna vendita reale attivata e nessuna spesa pubblicitaria effettuata.

- Prova prevista: 7 giorni, tutta Italia, nessuna carta; pass 9,90 €/90 giorni e 19,90 €/365 giorni, senza rinnovo.
- Preferiti sul dispositivo e correzioni delle giunzioni della mappa conservati. Nessuna demo permanente limitata a Foligno/Roma.
- Esportazione dati account, storico ordini, richieste assistenza/privacy/recesso e pannello gestore.
- Nuovi ordini: copia immutabile delle condizioni accettate, conferma HTML scaricabile e bozza EML per invio manuale. I vecchi ordini non ricevono condizioni ricostruite retroattivamente.
- Cancellazione amministrativa solo dopo richiesta esplicita, con conferma email e senza ordini; account gestore protetto. Nessun utente reale cancellato durante il collaudo.
- Nessuna garanzia aggiuntiva di rimborso volontario, come richiesto. Restano diritti inderogabili e rimedi applicabili; non è pubblicata la promessa «pagato, nessun rimborso».
- Identità pubblica confermata: Francesco Chiarolanza, Via degli Estensi 1, 00164 Roma, Italia; fungometer@gmail.com.

## Credenziali e servizi

Stripe: chiave live limitata e firma conservate nei segreti separati STRIPE_LIVE_SECRET_KEY e STRIPE_LIVE_WEBHOOK_SECRET. Il codice le seleziona insieme soltanto in modalità live; coppia incompleta blocca il pagamento. Non copiarle in chat o nei file versionati. La coppia di test resta distinta.

Webhook live già creato: we_1UNqK56rXkAtOQUcyaXPSzAe, URL /api/stripe/webhook, API 2026-08-26.dahlia. Eventi completamento e pagamento asincrono Checkout, rimborso, apertura/chiusura contestazione. Disabilitato in attesa del passaggio effettivo. Non creare duplicati.

Token Cloudflare «Fungometer GitHub daily deploy» creato con autorizzazione esplicita e salvato come segreto Actions. Scadenza mostrata da Cloudflare: 6 gennaio 2027. Workers Scripts Write sull'account; nessun permesso D1 aggiuntivo. Pubblicazione locale con questo token verificata. Chi può modificare i workflow può usare il segreto.

## Restano necessari per le vendite

1. Inquadramento dell'attività e dati fiscali: il gestore conferma di non avere partita IVA né valutazione del commercialista. Usare SCHEDA-COMMERCIALISTA.md per una valutazione e un preventivo; nessun invio già effettuato.
2. Licenze: la scelta di pagare Open-Meteo al quinto cliente non è una deroga del fornitore. Il piano Standard visto nel checkout italiano era 35,38 €/mese, superiore al budget mensile. Nessun acquisto. Altre fonti e «Dal web» richiedono le verifiche elencate in PREPARAZIONE-COMMERCIALE.md.
3. Completare conservazione dei dati, accordi fornitori e testi commerciali in base all'attività effettiva. Le bozze pubbliche dichiarano i punti mancanti.
4. Dopo questi punti: dati aggiornati, pubblicazione quotidiana verificata, vecchio canale sostituito, accesso Google pubblico verificato anche da un account diverso dal gestore; passaggio coordinato a live e attivazione del webhook esistente; ricevute Stripe e conferme inviate correttamente; prova reale del pagamento autorizzata separatamente.

Non impostare LIVE_SALES_READY, LICENSES_READY o PRIVATE_DATA_READY come veri per saltare questi controlli. L'account Stripe attivato non dimostra che l'attività sia fiscalmente avviata.

## Materiali pronti

- KIT-LANCIO.md: post utilizzabile oggi, post condizionato all'apertura, copione video, calendario 14 giorni e criteri di spesa.
- GESTIONE-CLIENTI.md: conferme, assistenza, privacy, rimborsi dovuti e incidenti.
- PRICING-E-POSIZIONAMENTO.md: confronto dei prezzi rilevati il 6 ottobre, limiti e ipotesi da misurare.
- AGGIORNAMENTO-QUOTIDIANO.md: configurazione tecnica e limiti del meteo.

## Verifiche finali del 7 ottobre

Migrazione D1 0004 applicata dopo backup riservato escluso dal repository. 68 test web e 57 test Python locali superati. CI Linux: 68 test web e 53 Python superati, un modulo opzionale saltato per dipendenze geografiche assenti sul runner; le verifiche geografiche sono state eseguite localmente.

[Revisione integrata #2](https://github.com/framik02/fungometer/pull/2). [Prima pubblicazione GitHub → Cloudflare riuscita](https://github.com/framik02/fungometer/actions/runs/37605448885), versione 561f0f28-2aa2-4e9c-811d-c557fd99f06f. Dati del 7 ottobre alle 10:48:45 CEST: 224 riquadri, 1.853 gruppi meteo, 907 celle locali, 229 file validati. Usata la fotografia completa acquisita dal vecchio job, senza ripetere le chiamate. Cinque gruppi delle giunzioni riassociati ai medesimi punti meteo registrati; panoramica ricalcolata e timestamp originale conservato.

Il workflow è ora sul ramo main, pianificato ogni giorno alle 03:17 UTC, con WEATHER_MODE=owner-preview e CLOUDFLARE_PIPELINE_READY=true. La prima pubblicazione è stata verificata; la prima rigenerazione completa eseguita dal nuovo cron resta da osservare. Non è una prova di affidabilità su più giorni. Configurazione owner-preview impedisce aggiornamenti per un’app aperta al pubblico o con incassi reali.

[Redirect GitHub Pages riuscito](https://github.com/framik02/fungometer/actions/runs/37605443734). Il vecchio sito rimanda a Cloudflare; il precedente URL data/punteggi.json restituisce 404. Lo storico già pubblico in Git resta copiabile; nessuna promessa di segretezza retroattiva. I prossimi aggiornamenti del workflow non vengono committati o caricati in artefatti pubblici.

Browser: richiesta di assistenza ricevuta e gestita; nuovo ordine simulato da 9,90 € pagato e pass attivato; conferma HTML e bozza EML scaricate e verificate. Nessuna email inviata: l’ordine di collaudo resta correttamente fra le conferme non inviate. Nessun rimborso o cancellazione reale eseguito. Il contatore resta 0 clienti reali.

Smoke finale: pagine e nuove risorse online, dati riservati, API non autenticate bloccate e Stripe test. Il sito non è ancora aperto alle vendite reali per i punti elencati sopra.
