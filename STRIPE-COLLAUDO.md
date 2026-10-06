# Stripe: collaudo del 6 ottobre 2026

## Aggiornamento: account del gestore collegato e verificato

Le note storiche sotto descrivono il primo ambiente temporaneo, ora ritirato. Fungometer usa l'account del gestore `acct_1UNagg6rXkAtOQUc` in modalità test, verificato tramite API e identificativo del commerciante nel Checkout. Registrazione completata personalmente dall'utente. Nessun pagamento reale eseguito.

Webhook test attivo `we_1UNbV46rXkAtOQUcvz9LmLUJ`, sul medesimo URL e con i cinque eventi previsti. Chiave test e segreto webhook aggiornati in Cloudflare. I file privati di trasferimento `.env.stripe-owned.json` e `.env.stripe-owned-import.json`, esclusi da Git, sono eliminati al termine del collaudo.

Collaudo del nuovo account completato:

- Sessione `cs_test_a1ASvwzRzvoYkgoHbrN4E4LfLvONTCYLUrQwJG3PLB3S3oxOQgGsQgOhn4`: pagamento simulato di 9,90 EUR riuscito; webhook ricevuto e pass attivato fino all'11 gennaio 2027 ore 16:35 Europe/Rome.
- Rimborso completo simulato `re_3UNbdi6rXkAtOQUc1XwyAd3N`, stato `succeeded`: webhook ricevuto, pass revocato e prova originaria ripristinata fino al 13 ottobre 2026 ore 17:35 Europe/Rome. Entrambi gli stati verificati nel browser.
- 48 test web superati, controllo configurazione e verifica del sito pubblicato superati. Nuovi test coprono il cambio account test e la conservazione dei pass già completati.
- Deploy `5318e908-fb3e-4c9b-a53c-c69dc4d27dde`; accesso ancora riservato al gestore, pagamenti test e vendite reali disabilitate.

Il vecchio webhook `we_1UNaW9G3kQut9xSwIxdq0JS8` è stato disabilitato e verificato tramite API. Il vecchio account non è più usato dall'app. `STRIPE_TEST_EXPIRES_AT` è vuoto: eliminato il blocco tecnico del vecchio sandbox, senza prolungare la prova utente. `STRIPE_TEST_RESET_BEFORE=2026-10-06T16:49:00.316Z` chiude i vecchi ordini test pendenti alla successiva richiesta di Checkout. Non coinvolge ordini pagati o pagamenti live; i tentativi successivi riutilizzano il nuovo Checkout pendente.

Manutenzione: `connect-stripe-owned.mjs` verifica account e webhook; `--configure` prepara l'endpoint senza duplicati. `import-stripe-sandbox.mjs --owned` verifica l'account e importa i segreti. `refund-stripe-sandbox.mjs SESSIONE --owned` applica i controlli sul pagamento test del gestore prima del rimborso. Questi comandi richiedono file privati temporanei, da eliminare dopo l'uso. `retire-stripe-temporary.mjs` ha già disabilitato il solo endpoint temporaneo verificato. Per interventi futuri recuperare le credenziali dalla dashboard, mai dalla chat.

## Note storiche del primo collaudo (superate dall'aggiornamento sopra)

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
