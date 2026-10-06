# Stripe: collaudo del 6 ottobre 2026

Ambiente temporaneo Stripe creato con la CLI ufficiale `@stripe/cli` 1.53.0, seguendo [Sandboxes](https://docs.stripe.com/sandboxes). Nessun conto bancario collegato, nessun pagamento reale. Account sandbox `acct_1UNZNcG3kQut9xSw`, scadenza comunicata da Stripe: **13 ottobre 2026**. L'app interrompe preventivamente i nuovi checkout di questo ambiente alle 00:00 UTC del 13 ottobre (`STRIPE_TEST_EXPIRES_AT`).

Webhook test `we_1UNaW9G3kQut9xSwIxdq0JS8` sul solo URL `https://fungometer.chiarolanza-francesco.workers.dev/api/stripe/webhook`, con i cinque eventi previsti. `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` importati nei segreti Cloudflare. Nessuna chiave nei file versionati. La configurazione CLI privata è in `.env.stripe-cli.toml`, esclusa da Git: contiene anche il collegamento per conservare il sandbox. Non stamparla, non allegarla e non commetterla.

## Risultati verificati

- L'utente ha attivato personalmente la prova: termine 13 ottobre 2026 ore 17:35 Europe/Rome. Google, ricerca località e dettaglio dei punteggi funzionano nel sito pubblicato.
- Checkout aperto dal browser come gestore con pulsante **Simula 90 giorni**, importo 9,90 EUR. Stripe mostra esplicitamente sandbox e assenza di pagamenti reali.
- Pagamento completato con la carta fittizia della [documentazione Stripe](https://docs.stripe.com/testing), senza salvataggio in Link. Webhook ricevuto: pass di 90 giorni attivato dopo la prova, scadenza 11 gennaio 2027 ore 16:35 Europe/Rome.
- Rimborso completo simulato di 990 centesimi, stato Stripe `succeeded`. Webhook ricevuto e pass revocato: l'account torna alla prova originaria, senza perdere giorni.
- 46 test automatici superati. Comprendono chiavi restricted e temporanee, blocco alla scadenza, rifiuto di chiavi live in test e separazione tra i pass di test e quelli reali, anche nel calcolo della durata.
- Deploy finale: `4df5788e-4ee5-468f-88c0-5257fbb1788f`. Restano `AUTH_ACCESS=owner-test`, `PAYMENTS_MODE=test`, `LIVE_SALES_READY=false`.

## Passaggio personale in corso

Aperta la registrazione Stripe tramite il collegamento **Claim sandbox**, con fungometer@gmail.com e Francesco Chiarolanza. L'utente deve scegliere la password, confermare personalmente la creazione dell'account e l'eventuale verifica email. Italia selezionata, marketing non selezionato. Non è ancora confermata la conclusione della registrazione o l'acquisizione del sandbox.

Dopo la registrazione, verificare che il sandbox sia quello esistente e che Stripe ne confermi la conservazione. Verificare/ruotare le credenziali temporanee nell'account di proprietà dell'utente, aggiornare i segreti Cloudflare se cambiano e solo allora adeguare la scadenza locale. Non creare altri sandbox duplicati. Non attivare incassi, fatturazione, IBAN o chiavi live per il collaudo.

I comandi di preparazione sono specifici per il gestore e per i test. `setup-stripe-sandbox.mjs` è già stato eseguito: non ripeterlo per creare altri endpoint. `import-stripe-sandbox.mjs` elimina il file di trasferimento dopo il salvataggio verificato. `refund-stripe-sandbox.mjs` accetta soltanto una sessione `cs_test_` del gestore, pagata in EUR per 9,90 €, con ritorno al sito corretto.

Il collaudo non conclude la preparazione commerciale: informative, condizioni, inquadramento fiscale, licenze dei dati e aggiornamento quotidiano restano da completare prima dell'apertura pubblica e degli incassi.
