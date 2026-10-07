# Stato corrente

Per stato operativo e attività completate consultare LANCIO.md e GESTIONE-CLIENTI.md. Le sezioni datate seguenti documentano la preparazione e non sostituiscono lo stato corrente.

# Fungometer — documenti e decisioni per aprire al pubblico

Aggiornato il 6 ottobre 2026. Documento operativo preparatorio, non attestazione di conformità. Il sito rimane in collaudo del solo gestore, Stripe test. Le verifiche professionali non sono sostituite da questo documento.

## Decisioni già definite

Gestore: Francesco Chiarolanza; assistenza e privacy: fungometer@gmail.com. Indirizzo gratuito Cloudflare. Prova di sette giorni senza carta, avviata esplicitamente; pass senza rinnovo a 9,90 EUR/90 giorni e 19,90 EUR/365 giorni, conservando il periodo residuo. Nessuna promessa di raccolta, commestibilità o sicurezza dei percorsi. Nessun messaggio promozionale automatico.

## Verifica delle fonti

| Fonte | Riscontro | Azione prima della vendita |
|---|---|---|
| Open-Meteo | Dati CC BY 4.0; accesso API gratuito limitato all'uso non commerciale; Standard 35,38 EUR/mese nel checkout Italia (29 + imposte), oltre budget | Attendere la scelta sul costo prima di acquistare. Separare licenza dei dati e condizioni del servizio API. Vedere AGGIORNAMENTO-QUOTIDIANO.md |
| Corine 2018 | La policy Copernicus Land consente il riutilizzo con attribuzione; i punteggi sono elaborazioni di Fungometer | Conservare metadati e versione, indicare fonte ed elaborazioni |
| Copernicus GLO-30 | Accesso con licenza gratuita, attribuzione specifica anche per elaborazioni | Conservare licenza applicabile al prodotto scaricato; verificare la formula di attribuzione dei derivati |
| Carta forestale Lazio | FAQ ufficiale del Geoportale indica CC BY 4.0 per i livelli pubblici | Conservare metadati specifici di tipi_forestali2; fonte già indicata nel sito |
| Carta geobotanica Umbria | Fonte individuata; licenza specifica non confermata nelle pagine consultate | Recuperare metadati/licenza o chiedere conferma all'ente. Non equiparare un servizio pubblicamente accessibile a un'autorizzazione commerciale |
| OpenStreetMap | Dati riutilizzabili con condizioni ODbL; servizio tessere soggetto a policy distinta, senza SLA | Attribuzione visibile, cache del browser, Referer e nessun download offline. Prevedere alternativa se aumenta il traffico |
| OpenTopoMap / Waymarked Trails | Attribuzioni già presenti; termini del servizio da archiviare e verificare | Confermare uso e limiti del servizio prima di prometterne disponibilità a pagamento |
| Photon | Server dimostrativo pubblico con limiti d'uso, senza garanzia di disponibilità | Mantenere ricerca moderata e prevedere sostituzione. Non inviare dati riservati |
| Aree protette EEA e confini ISTAT | Fonti e attribuzioni già presenti nel sito | Archiviare metadati/licenze delle versioni effettive e conservare l'avvertenza sui confini semplificati |
| Dal web | Estratti da fonti esterne con link; nessun registro dei permessi per estratto | Preparare registro URL/autore/data/base del riutilizzo; chiedere permessi ove necessari o usare collegamenti ai contenuti. Sezione mantenuta come richiesto, nessuna nuova raccolta |

Fonti consultate: [Open-Meteo](https://open-meteo.com/en/terms), [Copernicus Land](https://land.copernicus.eu/en/data-policy), [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM), [FAQ Geoportale Lazio](https://geoportale.regione.lazio.it/faq/servizi-wms-wfs-wcs-come-accedere-da-remoto-ai-livelli-del-geoportale/), [catalogo Umbria](https://umbriageo.regione.umbria.it/catalogostazioni/catalogo.aspx), [policy tessere OSM](https://operations.osmfoundation.org/policies/tiles/), [Photon](https://github.com/komoot/photon).

## Registro essenziale dei trattamenti

| Trattamento | Dati e finalità | Base proposta / conservazione effettiva |
|---|---|---|
| Account Google | Email verificata, identificativo Google, ID interno, date creazione/prova | Contratto/misure precontrattuali; nessun accesso Gmail o Drive. Cancellazione attualmente manuale; fissare e implementare il termine degli account inattivi prima del pubblico |
| Sessioni e accesso | Hash del token di sessione, stato OAuth temporaneo, dati per la verifica | Erogazione e sicurezza; sessioni 30 giorni, flusso OAuth 10 minuti, pulizia giornaliera |
| Protezione abusi | Identificativi derivati dall'IP e contatori temporanei | Legittimo interesse da documentare; eliminazione alla scadenza della finestra con pulizia quotidiana |
| Acquisti | Piano, importo, date, ID Stripe, termini accettati, stato di pagamento | Contratto e futuri obblighi legali; nessun numero completo di carta. Termine fiscale da definire col professionista; eventi webhook 90 giorni |
| Analisi facoltative | ID utente, tipo evento, giorno; nessuna posizione o ricerca | Consenso separato revocabile; 30 giorni; revoca elimina gli eventi |
| Preferiti e posizione | Preferiti nel browser; GPS per centrare la mappa | Funzioni richieste; preferiti fino a rimozione/cancellazione dati del browser. IP/area visibile ai fornitori delle tessere; ricerca e centro approssimato a Photon |
| Assistenza | Messaggi a fungometer@gmail.com | Gestione richieste; definire termine e accessi alla casella, evitando allegati identificativi non necessari |

Cloudflare ospita sito/database; controllare accordo applicabile e trasferimenti nel [DPA](https://www.cloudflare.com/cloudflare-customer-dpa/). Google gestisce l'accesso secondo la propria [informativa](https://policies.google.com/privacy). Stripe ha ruoli che dipendono dal trattamento: verificare [DPA](https://stripe.com/it/legal/dpa) e accordo, senza classificarlo automaticamente come solo responsabile. La consultazione dei documenti non dimostra che siano stati accettati nell'account né che tutti i trasferimenti siano verificati.

## Procedura privacy da usare subito

Ricevere la richiesta via email, registrare data/tipo/scadenza e verificare l'identità in misura proporzionata, preferibilmente con l'account già autenticato. Rispondere entro un mese; eventuale estensione motivata entro il primo mese nei casi ammessi. Fonte: [Garante, diritti](https://www.garanteprivacy.it/Regolamentoue/diritti-degli-interessati).

Per accesso/portabilità raccogliere account, prove, ordini ed eventi del solo richiedente, escludendo segreti e dati di altre persone. Per cancellazione verificare prima obblighi contabili, contestazioni e pass residui; invalidare sessioni e flussi, eliminare gli eventi facoltativi e i dati non più necessari. Conservare separatamente solo quanto giustificato e comunicarlo. Il codice non offre ancora una cancellazione amministrativa completa: implementarla e provarla su account fittizio prima dell'apertura. Nessun comando distruttivo su utenti reali è stato eseguito.

## Condizioni e rimborsi: proposta pronta per la revisione

Confermare indirizzo professionale e dati fiscali del venditore; non inventarli e non ricavarli dalla verifica bancaria Stripe. Prezzi totali al consumatore, durata, avvio dopo eventuale accesso residuo, assenza di rinnovo, requisiti internet, assistenza e limiti del modello devono comparire prima del pagamento.

Il 7 ottobre il gestore ha rifiutato la garanzia commerciale aggiuntiva di rimborso. I testi prevedono i diritti inderogabili di recesso e conformità, senza promessa di rimborso volontario per qualsiasi motivo. Non usare il pagamento o una checkbox generica come rinuncia automatica. Fonte: [MIMIT, recesso](https://www.mimit.gov.it/it/assistenza/domande-frequenti/diritto-di-recesso-domande-frequenti-faq).

Modulo da completare con l'indirizzo del venditore prima della pubblicazione: «A Francesco Chiarolanza, [indirizzo del venditore], fungometer@gmail.com. Comunico il recesso dall'acquisto del pass Fungometer [tipo], ordinato il [data], riferimento [ordine]. Nome [nome], email dell'account [email], indirizzo del consumatore [indirizzo], data [data]. Firma solo se inviato su carta». Una dichiarazione inequivocabile resta valida senza obbligo di questo modello.

Flusso operativo: verificare ordine e identità; effettuare il rimborso nella dashboard Stripe corretta; controllare stato succeeded e revoca del pass nel sito; inviare conferma. Non richiedere numeri di carta via email. Conservare copia durevole dei termini e della conferma d'ordine: la sola pagina web modificabile non basta. Invio e conservazione di tale conferma sono ancora da implementare/verificare.

## Scheda da portare al commercialista prima degli incassi

Attività prevista: servizio web automatizzato di previsione ambientale, vendita continuativa B2C di accessi temporanei senza rinnovo, tramite Stripe, inizialmente Italia. Nessuna attività o partita IVA attualmente comunicata. Budget 100 EUR iniziali e 30 EUR/mese tecnici, prezzi 9,90/19,90 EUR, fornitori esteri (Cloudflare, Open-Meteo, Stripe).

Richiedere un preventivo scritto separando avvio, costi annui fissi, contributi minimi eventuali, contabilità e costi per operazione. Chiarire classificazione e codice ATECO vigente, apertura partita IVA, regime applicabile, eventuali Registro imprese/SCIA, gestione INPS, trattamento dei servizi acquistati dall'estero, IVA B2C Italia/UE/extra-UE e OSS se pertinente, fatturazione/corrispettivi, conservazione e riconciliazione Stripe, rimborsi e commissioni. Non assegnare un codice ATECO o una gestione previdenziale solo dal nome dell'app.

I 5.000 EUR indicati dall'INPS sono una franchigia contributiva per il lavoro autonomo realmente occasionale, non un'esenzione generale dalla partita IVA per un sito che vende stabilmente. Fonte: [INPS](https://www.inps.it/it/it/dettaglio-approfondimento.schede-informative.49893.i-contributi-dei-lavoratori-autonomi-occasionali.html). L'attivazione tecnica di Stripe non sostituisce questi adempimenti. Nessun invio al commercialista o agli enti è stato effettuato.

## Conferme del gestore — 7 ottobre 2026

Indirizzo pubblico confermato: Via degli Estensi 1, 00164 Roma, Italia. Inserito nelle informative e nella configurazione Cloudflare. Il gestore conferma di non aver ancora aperto partita IVA né definito l'inquadramento con un commercialista. Nessun dato fiscale inventato; SELLER_TAX_ID resta vuoto.

La scelta precedente del gestore è attivare il piano Open-Meteo al quinto cliente pagante. È una scelta di spesa comunicata, non una deroga concessa dal fornitore: non sono stati acquistati piani né impostata LICENSES_READY=true. Il contatore proprietario dei clienti distinti è già presente. Il workflow quotidiano commerciale richiede ancora OPEN_METEO_API_KEY, CLOUDFLARE_API_TOKEN e il passaggio sul ramo predefinito; non è operativo.

Prossimi elementi da chiudere: inquadramento e dati fiscali; aggiornamento giornaliero effettivo e licenze delle fonti; conservazione/cancellazione account, termini di recesso e rimborso, conferma durevole degli ordini. Non basta attivare il webhook: i segreti live sono predisposti separatamente e le registrazioni restano riservate al gestore.

## Ultima verifica del 7 ottobre 2026

Indirizzo pubblico confermato e pubblicato: Via degli Estensi 1, 00164 Roma, Italia. Dati fiscali ancora da definire: il gestore conferma di non avere ancora aperto partita IVA o consultato un commercialista. Scheda operativa pronta in SCHEDA-COMMERCIALISTA.md, non inviata.

Pubblicata funzione GET /api/account/export, accessibile solo con sessione autorizzata, con account, ordini e statistiche del solo richiedente; esclusi credenziali di sessione, link Checkout e segreti. Download disponibile nell’account, informative aggiornate; cancellazione ancora manuale. Non sono inclusi preferiti locali o corrispondenza di assistenza.

59 test web superati, controllo del sito pubblicato riuscito. Download provato nel browser e file JSON verificato localmente: account del gestore, 3 ordini di collaudo, nessuna credenziale. Versione Cloudflare bfe67ea1-20be-4a89-a619-b84d201157ca. Restano owner-test, pagamenti test e webhook live sospeso. Aggiornamento meteo quotidiano non attivato: dati del 6 ottobre, nessuna data alterata artificialmente.
