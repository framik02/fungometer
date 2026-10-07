# Aprire le vendite reali di FungoMeter

Stato verificato il 7 ottobre 2026. Nessun pagamento reale attivato. Il gestore conferma di non avere partita IVA né valutazione professionale. Budget invariato: 100 € iniziali e 30 €/mese.

## 1. Definire l'attività prima di spendere per il lancio

Usare SCHEDA-COMMERCIALISTA.md per richiedere una valutazione e un preventivo scritto a un commercialista che segua servizi digitali B2C. Non affidare incarichi o acquistare abbonamenti prima di conoscere i costi fissi.

La risposta deve indicare: inquadramento dell'attività, codice ATECO applicabile, regime fiscale, posizione INPS ed eventuali iscrizioni/comunicazioni; costo iniziale e annuale anche senza ricavi; documenti fiscali per i clienti, dati da raccogliere nel pagamento e gestione di clienti esteri e fornitori esteri. L'attività abituale è il criterio rilevante, non una soglia generale di ricavi che esenti dalla partita IVA. Riferimento normativo: [DPR 633/1972, art. 4](https://www.normattiva.it/atto/caricaDettaglioAtto?atto.articolo.numero=4&atto.codiceRedazionale=072U0633&atto.dataPubblicazioneGazzetta=1972-11-11).

**Risultato necessario:** attività effettivamente avviata secondo l'inquadramento scelto e dati reali del venditore, oltre alle indicazioni per fatture/corrispettivi e conservazione. Un preventivo o l'apertura tecnica dell'account Stripe da soli non completano questo passaggio.

Non serve inviare a Codex SPID, password, credenziali fiscali o documenti d'identità. I dati fiscali destinati al sito si inseriranno quando disponibili; gli adempimenti personali vanno gestiti dal titolare o dal professionista incaricato. Nessun contatto è stato effettuato per tuo conto.

## 2. Chiudere le condizioni d'uso delle fonti

- **Meteo:** la scelta di acquistare Open-Meteo al quinto cliente è registrata, ma non concede una deroga. I [termini del fornitore](https://open-meteo.com/en/terms) limitano la Free API a usi non commerciali. Il piano Standard visto nel checkout italiano costa 35,38 €/mese, oltre il budget di 30 €. Non è stato acquistato. Per un lancio conforme ai termini occorre una licenza applicabile o una fonte alternativa che copra le variabili e la storia richieste; non basta cambiare un flag.
- **Carta umbra:** il livello effettivamente usato dichiara copyright Regione Umbria SIAT ma non una licenza esplicita nei metadati consultati. Ottenere un chiarimento sul riutilizzo oppure sostituire quel contributo con una fonte di licenza verificata, ricalcolando i dati e indicando la minore specificità del nuovo habitat. Nessuna richiesta inviata.
- **Dal web:** la sezione resta presente come richiesto. Verificare la base del riutilizzo degli estratti e il metodo di raccolta; se non documentabile, mantenere collegamenti e informazioni proprie senza ripubblicare commenti. Non togliere l'attribuzione per nascondere la provenienza.
- Completare e conservare i riferimenti specifici di cartografia, terreno e servizi esterni indicati in PREPARAZIONE-COMMERCIALE.md.

**Risultato necessario:** fonte e condizioni applicabili documentate. Un servizio accessibile pubblicamente non dimostra da solo il diritto di qualsiasi uso commerciale.

## 3. Completare testi e operatività in base ai dati reali

Inserire dati fiscali del venditore nelle condizioni, nel riepilogo pubblico e nelle conferme; definire conservazione di account, assistenza e documenti contabili, oltre ai ruoli/accordi dei fornitori e trasferimenti applicabili. Adeguare i campi Checkout ai dati fiscali realmente necessari, senza raccogliere dati superflui.

Non introdurre una garanzia volontaria di rimborso, rifiutata dal gestore. Conservare i diritti inderogabili di recesso e conformità; non è valida una regola generale «se pagano è fatta». Le conferme con condizioni conservate sono implementate e collaudate; per i primi clienti l'invio è manuale e va eseguito prontamente come descritto in GESTIONE-CLIENTI.md. La conferma contrattuale non sostituisce una fattura.

## 4. Passaggio tecnico coordinato

Solo quando i punti sopra sono effettivamente completati:

1. Verificare il pubblico OAuth Google e provare accesso/prova da un account esterno al gestore. Non attribuire diritti pagati ai precedenti ordini di test.
2. Configurare la fonte meteo commerciale e la modalità corrispondente dell'aggiornamento. Verificare un aggiornamento completo e la data reale, senza ritoccare i timestamp.
3. Compilare SELLER_TAX_ID e i testi definitivi; impostare AUTH_ACCESS=public e la configurazione commerciale effettiva. LICENSES_READY e LIVE_SALES_READY non sono attestazioni da inventare.
4. Impostare PAYMENTS_MODE=live: il codice seleziona la coppia di segreti live già predisposta. Abilitare il webhook Stripe live esistente, senza crearne un duplicato. Concordare il rilascio ravvicinato per limitare consegne nella modalità errata; Stripe deve poter ritentare eventi non elaborati.
5. Verificare i controlli pubblici, che ora supportano sia test sia live. Le richieste anonime a dati mappa, ordini, richieste e pannello gestore devono restare bloccate.
6. Configurare le ricevute email Stripe e gli eventuali documenti fiscali secondo l'inquadramento. Eseguire un singolo acquisto reale autorizzato esplicitamente da chi paga e controllare importo, conferma webhook, accesso e consegna delle condizioni. Non usare carte fittizie in live.
7. Aprire la prova pubblica e usare i materiali di KIT-LANCIO.md. Pubblicità a pagamento soltanto dopo dati stabili e percorso completo verificato, con budget specifico approvato.

## Già completato

Cloudflare, Google per il gestore, Stripe test, credenziali live separate, webhook live predisposto, aggiornamento programmato, prima pubblicazione automatica, rimando da GitHub Pages, protezione dei nuovi dati, preferiti e correzioni della mappa, richieste clienti, esportazione e conferme scaricabili. La prima esecuzione completa del nuovo cron giornaliero resta da osservare; la pubblicazione è già stata provata con una fotografia completa di oggi.

Non è possibile fissare una data certa di apertura finché mancano inquadramento e soluzione per le licenze. La prima azione del titolare è ottenere la valutazione e il preventivo del punto 1, non acquistare pubblicità.
