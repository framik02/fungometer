# Stato corrente — 7 ottobre 2026

Automazione integrata e prima pubblicazione riuscita: [run 37605448885](https://github.com/framik02/fungometer/actions/runs/37605448885). Configurata con WEATHER_MODE=owner-preview, consentita esclusivamente per collaudo del gestore e Stripe test. Token Cloudflare salvato in GitHub, Workers Scripts Write account-wide, scadenza indicata 6 gennaio 2027. Nessun permesso D1 aggiunto. Cron 03:17 UTC sul ramo main; modalità commerciale richiede WEATHER_MODE=commercial e OPEN_METEO_API_KEY.

Il collaudo ha pubblicato la fotografia completa di oggi con publish_existing=true, evitando una seconda acquisizione meteo. Il cron normale rigenera i dati. Va ancora osservata la prima esecuzione pianificata completa. GitHub Pages sostituito con un rimando e vecchio endpoint dati verificato HTTP404. Stato aggiornato in LANCIO.md; le note datate sotto sono il dossier preparatorio.

# Aggiornamento quotidiano — 6 ottobre 2026

## Stato effettivo

Verifica remota completata con successo: [GitHub Actions, esecuzione 37503204900](https://github.com/framik02/fungometer/actions/runs/37503204900). Eseguiti 55 test web, 57 test Python, controllo configurazione e build; il lavoro di aggiornamento/pubblicazione è rimasto escluso. Verificata inoltre la struttura della fotografia dei dati del 6 ottobre (224 riquadri, 1.853 gruppi, 907 celle locali, 229 file) usando la sua data originale: non è una nuova acquisizione meteo. Informativa e attribuzioni pubblicate nella versione Cloudflare `d3b8cddf-78b5-4534-a09d-14c697ca6a4e`, con verifica del sito e delle restrizioni riuscita.

Codice preparato e caricato sul ramo `codex/cloudflare-trial-stripe`; automazione Cloudflare non ancora attiva. GitHub è accessibile come framik02. Il ramo predefinito del repository pubblico framik02/fungometer conserva ancora il vecchio aggiornamento e GitHub Pages, senza segreti o variabili per Cloudflare. Non confondere il cron di pulizia degli accessi nel Worker con l'aggiornamento meteo.

Il nuovo workflow ha una verifica manuale senza segreti e una pubblicazione condizionata a `CLOUDFLARE_PIPELINE_READY=true`. La pianificazione parte alle 03:17 UTC (05:17 ora legale italiana, 04:17 ora solare), con possibili ritardi di GitHub. Usa la licenza commerciale, genera tutte le zone e pubblica solo dopo controlli completi. Nessun commit dei nuovi punteggi e nessun caricamento di dati meteo come artefatti pubblici. Le migrazioni D1 sono escluse dal lavoro quotidiano.

## Piano meteo e costo

907 celle locali + 1.853 gruppi nazionali, cinque variabili, 26 giorni passati e otto giorni di previsione: circa 6.703 chiamate conteggiate al giorno, 207.789 in 31 giorni, prima di tentativi ripetuti. Il calcolo tiene conto del moltiplicatore per intervalli superiori a 14 giorni. Il numero di utenti non moltiplica questo consumo: consultano gli stessi file elaborati.

Il 6 ottobre il listino mostra API Standard a 29 EUR/mese, un milione di chiamate e licenza commerciale. Dopo il caricamento del checkout con paese Italia e valuta EUR, il totale mostrato è **35,38 EUR/mese: 29 EUR + 6,38 EUR di imposte**. Rinnovo mensile automatico. Screenshot locale `../open-meteo-preventivo.png`. Nessun acquisto effettuato: supera il limite di 30 EUR/mese comunicato dall'utente. È stata richiesta una scelta tra modifica del budget, ricerca di un'alternativa commerciale o prosecuzione del solo collaudo personale. Cloudflare resta sul piano gratuito nei suoi limiti; i costi fiscali/professionali non sono inclusi.

Il lavoro quotidiano chiama `/v1/forecast` con `past_days=26`, parametro ammesso dalla documentazione fino a 92 giorni: dalle specifiche pubblicate è compatibile con Standard. Il separato script di prove storiche chiama Historical Forecast API, che richiede Professional (99 EUR/mese nel listino verificato). Non viene eseguito dal workflow quotidiano. Fare una richiesta campione con la nuova chiave prima di avviare l'intero calcolo.

Fonti: [prezzi e conteggio chiamate](https://open-meteo.com/en/pricing), [parametri forecast](https://open-meteo.com/en/docs), [termini](https://open-meteo.com/en/terms).

## Attivazione dopo acquisto e credenziali

1. Completare personalmente l'eventuale abbonamento mensile Open-Meteo, verificando il totale e il rinnovo. Non inviare carta o chiavi in chat.
2. Creare un token Cloudflare per la pubblicazione automatica, limitato all'account Fungometer e ai permessi strettamente richiesti dal deploy Workers. Verificare i limiti effettivi di Cloudflare: il permesso Workers Scripts è normalmente a livello di account, non promettere isolamento al singolo Worker. Non copiare in GitHub il token OAuth personale di Wrangler. Nessun permesso di modifica D1 per il processo quotidiano.
3. Salvare `OPEN_METEO_API_KEY` e `CLOUDFLARE_API_TOKEN` nei segreti Actions del repository; `CLOUDFLARE_ACCOUNT_ID=a674a0f074b8c389ad40bf022c6bbd74` nelle variabili. Limitare chi può modificare i workflow, perché può usare i segreti. Niente chiavi nel codice, nei log o nei parametri della riga di comando.
4. Eseguire prima la verifica manuale con `verify_only=true`. Portare il workflow verificato sul ramo predefinito per rendere effettivo il cron.
5. Disattivare il vecchio lavoro che pubblica punteggi in GitHub. Il nuovo workflow sostituisce quello vecchio sul ramo predefinito. Configurare un reindirizzamento da GitHub Pages, senza cancellare lo storico; valutare separatamente la riservatezza dei dati già pubblicati.
6. Impostare `CLOUDFLARE_PIPELINE_READY=true`, eseguire manualmente con `verify_only=false`, controllare esito, data nell'app e accesso riservato. Solo un'esecuzione completa riuscita conferma l'attivazione, non la presenza del cron.

## Protezioni e recupero

Il download rifiuta variabili mancanti/non finite e calendari incompatibili. Con chiave commerciale evita le pause di un'ora del piano gratuito, mantenendo lotti piccoli e retry. Solo a fine generazione nazionale viene scritto `docs/data/release.json` con hash dei file; il controllo verifica anche date, celle, gruppi e panoramica. Se fallisce, non si pubblica e l'ultima versione del sito rimane disponibile. Dopo 36 ore senza dati nuovi il Worker blocca nuove prove e acquisti.

Controllare l'esito del workflow dopo ogni modifica e abilitare personalmente le notifiche GitHub desiderate. Nessun monitor esterno o avviso automatico aggiuntivo configurato. Non eseguire ripetutamente il calcolo per aggirare errori di licenza/quota. Prima diagnosticare; poi rilanciare una volta. Non modificare i timestamp per far apparire freschi dati vecchi.
