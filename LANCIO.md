# Fungometer — stato operativo

Aggiornato il 7 ottobre 2026. Budget: 100 € iniziali, fino a 30 €/mese.

## Online adesso

https://fungometer.chiarolanza-francesco.workers.dev/

Pagina di presentazione e richiesta di avviso via email. Accesso Google riservato a fungometer@gmail.com, prova del gestore attiva fino al 13 ottobre. Pagamenti solo di test; webhook live disabilitato. Nessuna vendita reale attivata e nessuna spesa pubblicitaria effettuata.

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

## Verifiche del rilascio

Migrazione D1 0004_customer_care applicata dopo backup riservato escluso dal repository. Versione 86b1ecbb-20ad-4a44-8018-5ffd6a4bf571 pubblicata e smoke riuscito: dati riservati, Google del gestore e Stripe test. 67 test web più un test aggiuntivo dell'automazione e 57 test Python superati. Richiesta di assistenza reale di collaudo ricevuta nel browser; completamento e nuovo ordine da verificare dopo l'ultimo aggiornamento dell'interfaccia.

L'automazione e il trasferimento dell'ultimo meteo sono in completamento; non considerarli riusciti soltanto perché esistono cron o credenziali. Aggiungere qui gli esiti effettivi a fine rilascio.
