# Fungometer: stato e passaggi per il lancio

Aggiornato il 6 ottobre 2026. Budget: 100 € iniziali, fino a 30 €/mese.

**Stato Stripe aggiornato:** account del gestore collegato in test; pagamento, attivazione pass e rimborso verificati nel browser. Credenziali Cloudflare aggiornate, webhook già configurato (non duplicarlo), vecchio webhook temporaneo disabilitato e relativa scadenza tecnica rimossa. I punti 1–3 dell'ordine operativo sotto sono completati e conservati come riferimento storico. Vedere [collaudo aggiornato](STRIPE-COLLAUDO.md). Verifiche attuali: 48 test web e 53 test Python superati; sito pubblicato verificato. Registrazioni pubbliche e incassi reali restano disabilitati.

**Aggiornamento successivo:** l'utente ha scelto l'indirizzo gratuito workers.dev e autorizzato «Accedi con Google». [ACCESSO-GOOGLE.md](ACCESSO-GOOGLE.md) sostituisce i passaggi dominio/Resend/Turnstile di questo piano. Il codice comprende 46 test web superati. Client Google creato, segreto salvato in Cloudflare, contatto pubblico fungometer@gmail.com: il sito verifica la presenza della configurazione. Accesso Google reale riuscito per il solo gestore, Francesco Chiarolanza, con contatto fungometer@gmail.com. Informative commerciali ancora da completare; registrazioni pubbliche e pagamenti reali disabilitati.

## Stato verificato

- Anteprima Cloudflare: https://fungometer.chiarolanza-francesco.workers.dev
- Database D1 creato, migrazioni applicate. Accessi pubblici e incassi reali disattivati; collaudo Google riservato al gestore.
- Prova completa: 7 giorni su tutta Italia, senza carta; nessuna demo geografica permanente. Alla scadenza la mappa richiede un pass.
- Pass proposti: 9,90 €/90 giorni; 19,90 €/365 giorni. Pagamento unico, senza rinnovo. L'acquisto conserva il tempo di prova residuo.
- Accesso email, limiti antispam, sessioni protette, prezzi verificati sul server, webhook firmati, gestione duplicati/rimborsi implementati. Stripe verificato anche nel browser con pagamento e rimborso fittizi in un sandbox temporaneo; [stato e registrazione da completare](STRIPE-COLLAUDO.md).
- Dal web ripristinato con estratti, piattaforma, data e link originali, secondo la richiesta dell'utente. Nessuna nuova raccolta automatica aggiunta. Diritti e condizioni di riutilizzo restano da verificare prima dell'offerta commerciale.
- Il repository originale e GitHub Pages non sono stati modificati. Le modifiche sono in questa copia, ramo `codex/cloudflare-trial-stripe`. Nessun push eseguito.

## Ordine operativo

1. Completare personalmente la registrazione Stripe nella pagina Claim sandbox già aperta, per conservare l’ambiente di prova esistente prima del 13 ottobre. Non inviare chiavi in chat.
2. `AUTH_SECRET` e `GOOGLE_CLIENT_SECRET` sono già configurati. `STRIPE_SECRET_KEY` test e `STRIPE_WEBHOOK_SECRET` sono configurati e collaudati. Verificare le credenziali e la scadenza dopo aver acquisito il sandbox. Non usare `.dev.vars` per pubblicare: contiene impostazioni esclusivamente locali.
3. In Stripe creare il webhook `https://fungometer.chiarolanza-francesco.workers.dev/api/stripe/webhook`, eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Carte e wallet supportati da Checkout; nessun abbonamento Billing. Non occorrono prodotti creati a mano: il server imposta nome e prezzo.
4. Percorso scelto: Google e indirizzo gratuito Cloudflare, già configurati. Resend, dominio proprio e Turnstile non sono necessari per questo percorso.
5. Identità del titolare e contatto confermati. Completare informativa privacy, conservazione/cancellazione account, condizioni e assistenza. I documenti in `docs` sono bozze dichiarate. Definire concretamente recesso, rimborsi e conferme su supporto durevole; la checkbox attuale NON sostituisce tutti questi obblighi.
6. Accesso Google già attivo soltanto per il gestore (`AUTH_ACCESS=owner-test`): login e logout verificati nel browser. Impostare `AUTH_ACCESS=public` solo dopo documenti completi, dati aggiornati e licenze verificate. Avvio prova, pagamento Stripe test e rimborso verificati nel browser. Completare verifica webhook ritardato e procedure operative prima delle vendite.
7. Collegare l'aggiornamento quotidiano: nel repository GitHub configurare i segreti `CLOUDFLARE_API_TOKEN` (limitato a questo account, Workers Scripts edit e D1 edit), `OPEN_METEO_API_KEY`; la variabile `CLOUDFLARE_ACCOUNT_ID`; infine `CLOUDFLARE_PIPELINE_READY=true`. Pubblicare questo ramo dopo revisione, eseguire il workflow manualmente e verificare la data sul sito. Il workflow nuovo sostituisce i commit pubblici dei punteggi con il caricamento diretto degli asset protetti. Il cron è una partenza prevista, non una garanzia d'orario.
8. Acquisire la licenza commerciale meteo appropriata e controllare licenze di cartografia/terreno e Dal web. Gli endpoint commerciali sono predisposti, ma non è stato acquistato alcun piano. Non vendere l'accesso alla mappa facendo affidamento sui soli termini gratuiti non commerciali.
9. Disattivare la vecchia pubblicazione quotidiana e trasferire GitHub Pages verso il nuovo sito. Non eliminare lo storico senza un piano di conservazione: quanto già pubblico rimane copiabile. `PRIVATE_DATA_READY` resta false finché i nuovi dati non vengono più pubblicati sul vecchio canale.
10. Definire prima degli incassi l'inquadramento fiscale con un professionista. Impostare Stripe live solo dopo questi passaggi: chiavi e webhook live distinti, `PAYMENTS_MODE=live`, `LIVE_SALES_READY`, `LICENSES_READY`, `PRIVATE_DATA_READY=true`, dati venditore completi. Non cambiare semplicemente le tre variabili per saltare i requisiti.

## Test e manutenzione

`npm test`: 46 test di accesso/pagamento, inclusi concorrenza, firme, scadenza e rimborsi. `python -m pytest -q`: 49 test del motore e del collegamento meteo. Browser locale: login, avvio prova e Dal web verificati. Dati del 6 ottobre: l'anteprima non aggiorna autonomamente il meteo finché GitHub non è collegato. Dopo 36 ore senza aggiornamenti nuove prove e acquisti vengono bloccati; gli accessi già attivi mantengono la consultazione con le date indicate.

Non modificare i file di migrazione applicati: aggiungere migrazioni successive. Prima di aggiornamenti al database, esportare un backup protetto con Wrangler D1. Non salvare esportazioni contenenti utenti nel repository. Dopo un problema controllare Stripe prima di chiedere un secondo pagamento. Rimborsi parziali e contestazioni sospendono il pass interessato; le contestazioni vinte richiedono gestione manuale. La gestione amministrativa completa di cancellazioni, richieste privacy, assistenza e ripristino è ancora da completare.

## Prezzo e differenziazione

Ricognizione di offerte pubbliche al 6 ottobre 2026; funzionalità dichiarate dai venditori, non testate sul campo.

| Prodotto | Offerta osservata | Implicazione |
|---|---|---|
| [Mappa dei Funghi](https://mappadeifunghi.it/mappe-complete/) | 14,90 €/anno per specie/zona; previsioni e avvisi | Evidenziare territorio e gruppi inclusi nel prezzo totale |
| [Mycel](https://apps.apple.com/it/app/mycel-mappa-dei-funghi/id6771742569) | App Store elenca 17,99 €/anno e 44,99 € a vita; testo descrittivo riporta prezzi diversi | Confronto da confermare al checkout; non presentare Fungometer come il più economico |
| [Mushroom Forecast](https://mushroomforecast.com/eula) | 4,99 €/mese o 19,99 €/anno nei termini | Il pass annuale proposto è allineato, non una differenza decisiva |
| [FunghiTrack](https://play.google.com/store/apps/details?hl=it&id=it.funghitrack.app) | 30 giorni di prova, 29,99 €/anno; GPS/offline e altre funzioni | Non promettere equivalenza a funzioni che Fungometer non offre |
| [Sporelia](https://sporelia.com/en/membership) | 14 specie, più paesi e formule stagionali; prezzo non verificabile nella pagina consultata | Stagionalità e assenza di rinnovo non sono esclusive |

Posizionamento proposto: «Confronta nella tua zona i giorni e le condizioni del bosco, con un punteggio spiegato, tutta Italia e 11 gruppi in un unico pass». Punti concreti: browser su telefono/computer, acqua/temperatura/habitat/quota leggibili, canaloni e preferiti locali. Nessuna promessa di precisione superiore ai concorrenti, raccolti garantiti o previsione meteorologica a 500 m. Il modello non ha ancora una validazione sistematica sul campo.

Il pass di 90 giorni a 9,90 € riduce l'impegno iniziale per la stagione; 19,90 € annuali hanno senso per chi esce in più stagioni. Sono ipotesi da misurare, non prezzi dimostrati ottimali. Evitare sconti fittizi e abbonamento mensile per ora.

## Conversione e prime vendite

Percorso implementato: promessa chiara → email → avvio esplicito della prova → zona/specie/giorno → lettura di una cella → scadenza visibile → prezzi → Checkout. Mostrare il valore prima della richiesta di pagamento. Nessuna carta nella prova e nessun addebito alla scadenza. Nessuna email promozionale automatica; richiedere un consenso distinto se sarà introdotta.

Misurare per coorte le prove avviate e, solo dopo il completamento della finestra di osservazione, gli acquisti entro 14 giorni. Metriche opzionali con consenso: apertura mappa/cella/prezzi e avvio acquisto; i dati dei soli consenzienti possono essere distorti. Non dedurre tassi dal solo numero di acquisti diviso per tutte le iscrizioni recenti.

Primo ciclo: 10–20 persone che già raccolgono funghi, in più zone; osservare se riescono a scegliere zona, specie e giorno senza aiuto. Raccogliere soprattutto le ragioni per cui non pagherebbero. Con pochi utenti usare colloqui, non A/B test dichiarati significativi. Pubblicità iniziale: dimostrazione breve della propria zona, post nei gruppi solo con permesso degli amministratori, collaborazioni con guide/associazioni. Nessun invio promozionale è stato effettuato. Budget annunci iniziale: 0 €; investire in traffico solo dopo primi pagamenti e un servizio quotidiano affidabile.

## Budget reale

Cloudflare parte nel piano gratuito con limiti; nessun piano a pagamento acquistato. Dominio e mittente: costo da verificare prima dell'acquisto. Open-Meteo commerciale può assorbire quasi tutto il tetto mensile: verificare prezzo, imposte e accesso alle API necessarie prima di impegnarsi. [Prezzi Open-Meteo](https://open-meteo.com/en/pricing). I costi fiscali e professionali non sono inclusi nei 30 € tecnici e potrebbero superare il budget iniziale.

[Stripe Italia](https://stripe.com/en-it/pricing): con tariffa 1,5% + 0,25 € per carte standard SEE, commissioni indicative di 0,40 € su 9,90 € e 0,55 € su 19,90 €. Restano circa 9,50 €/19,35 € prima di imposte, rimborsi e altri costi. Altre carte possono costare di più. Quattro pass stagionali coprirebbero circa 29 € di spesa tecnica mensile in termini di cassa, senza dimostrare redditività complessiva.

## Dal web

Il file attuale contiene estratti e link, ma non documenta sistematicamente autore, permesso e condizioni applicabili a ciascun estratto. Non basta indicare «fonte» per autorizzarne qualsiasi uso; non basta eliminarlo per renderlo lecito. Per il lancio valutare citazioni ammesse o autorizzazioni, attribuzioni necessarie, termini API, aggiornamenti/rimozioni e diritti privacy. Fonti: [YouTube](https://www.youtube.com/static?template=terms&hl=it&gl=IT), [YouTube API policies](https://developers.google.com/youtube/terms/developer-policies), [Reddit Data API terms](https://redditinc.com/policies/data-api-terms). In alternativa alla ripubblicazione dei commenti, mantenere la sezione con collegamenti ai contenuti originali, previa verifica anche del metodo di raccolta.
