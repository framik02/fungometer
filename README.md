# FungoMeter

Una mappa che ogni mattina dà un punteggio da 0 a 100 a quanto sono favorevoli
le condizioni per trovare cinque specie di funghi nei dintorni di Foligno e di
Roma, in quadrati da 3 km che diventano quadrati da 500 m quando si ingrandisce.
Funziona dal browser del telefono e si può installare come app.

**App:** https://framik02.github.io/fungometer/

Il punteggio non garantisce ritrovamenti e l'app non identifica i funghi: ogni
raccolta va fatta controllare all'Ispettorato micologico della ASL (gratuito).

Costo: zero. Niente server, database o servizi a pagamento. Il repository è
pubblico perché così GitHub Actions e GitHub Pages sono gratuiti.

## Come funziona

```
ogni mattina alle 6              una volta sola (sul tuo PC)
GitHub Actions                   scripts/scarica_corine.py   uso del suolo
  scripts/aggiorna_punteggi.py   scripts/scarica_boschi.py   tipi di bosco
    meteo da Open-Meteo          scripts/prepare_static.py   quota, terreno,
    + data/celle.json  <---------------+                     sottocelle, canaloni
    + data/sottocelle.json <-----------+
    + config/specie.yaml
    -> docs/data/punteggi.json e docs/data/sottocelle/
    -> commit automatico
            |
GitHub Pages pubblica docs/  ->  la mappa sul telefono
```

## Cartelle

| Percorso | Cosa contiene |
|---|---|
| `config/aree.yaml` | le zone coperte (rettangoli in gradi) |
| `config/specie.yaml` | soglie e parametri delle specie |
| `data/celle.json` | quota e uso del suolo di ogni cella da 3 km (prodotto da `prepare_static.py`) |
| `data/sottocelle.json` | quota, ambienti e forme del terreno di ogni sottocella da 500 m |
| `data/raw/` | DEM e Corine grezzi, **non** salvati su GitHub |
| `fungometer/` | il codice Python: griglia, meteo, punteggio |
| `scripts/` | gli script da lanciare |
| `tests/` | i test del punteggio (pytest) |
| `docs/` | il sito: `index.html`, `app.js`, `info.html`, dati del giorno |
| `.github/workflows/aggiorna.yml` | l'aggiornamento automatico delle 6 |

## Installare sul tuo PC

Serve Python 3.10 o più recente. Da PowerShell, nella cartella del progetto:

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-prepare.txt
```

Se `pip` dentro `.venv` dà errori di certificato SSL, installa usando il pip
del sistema indicando l'ambiente del progetto:

```
python -m pip --python .venv\Scripts\python.exe install -r requirements-prepare.txt
```

## Scaricare Corine Land Cover

L'uso del suolo viene da **Corine Land Cover 2018**. Ci sono due strade.

### Strada 1, automatica (consigliata)

```
.venv\Scripts\python scripts\scarica_corine.py
```

Scarica senza login i poligoni Corine delle nostre aree dal servizio pubblico
dell'Agenzia europea dell'ambiente (EEA) e li salva come
`data/raw/CLC2018_foligno.tif` e `data/raw/CLC2018_roma.tif`. Ci mette meno di
un minuto.

### Strada 2, a mano dal portale Copernicus

1. Vai su https://land.copernicus.eu, cerca **CORINE Land Cover 2018** e accedi
   con EU Login (gratuito, senza carta di credito).
2. Scegli il formato **Raster 100 m, GeoTIFF**, dataset per tutta l'Europa.
   Il portale prepara il file e te lo fa trovare fra i tuoi download.
3. Nello zip (nome simile a `u2018_clc2018_v2020_20u1_raster100m.zip`) apri la
   cartella `DATA` e prendi il file `U2018_CLC2018_V2020_20u1.tif`.
4. Mettilo in `data/raw/`. Lo script cerca qualunque `.tif` con `CLC2018` nel nome.

## Scaricare i tipi di bosco

```
.venv\Scripts\python scripts\scarica_boschi.py
```

Scarica, senza login, la carta forestale del Lazio (servizio WFS della Regione
Lazio) e la carta geobotanica dell'Umbria (servizio ArcGIS della Regione Umbria)
e le salva in `data/raw/boschi_<area>.tif`. Ci mette qualche minuto. Le due
carte distinguono faggete, castagneti, cerrete, leccete, conifere e praterie,
che Corine non separa. In Umbria castagneti e cerrete restano insieme nei
"boschi collinari".

## Preparare celle e sottocelle

```
.venv\Scripts\python scripts\prepare_static.py
```

Scarica da solo le tile del DEM Copernicus GLO-30 (circa 270 MB, dal bucket
pubblico AWS, senza login), ne ricava pendenza, esposizione e canaloni, e
scrive `data/celle.json`, `data/sottocelle.json` e le immagini dei canaloni in
`docs/data/canaloni/`. Ci mette circa un minuto. Va rilanciato solo se cambi
`config/aree.yaml`. Dopo, fai commit e push di questi file.

## Attivare GitHub Pages e Actions

Per questo repository sono già attivi. Se rifai tutto su un repository nuovo:

1. **Pages.** Su GitHub: *Settings > Pages > Build and deployment*.
   *Source*: **Deploy from a branch**; *Branch*: **main**, cartella **/docs**;
   *Save*. Dopo un paio di minuti il sito è su
   `https://<utente>.github.io/<repository>/`.
2. **Actions.** Il workflow è in `.github/workflows/aggiorna.yml` e parte da
   solo alle 6 italiane. Il permesso di fare il commit dei punteggi è già
   scritto nel file (`permissions: contents: write`): non serve cambiare
   impostazioni.
3. **Primo giro a mano.** Scheda *Actions > Aggiorna punteggi > Run workflow*.
   Ci mette circa 9 minuti.

Da sapere:

- Il cron di GitHub usa l'ora UTC e non conosce l'ora legale: il workflow parte
  alle 04:00 e alle 05:00 UTC e lo script lavora solo se in Italia sono passate
  le 6 e oggi non l'ha ancora fatto. GitHub a volte parte con qualche decina di
  minuti di ritardo.
- Se il repository resta 60 giorni senza attività, GitHub può sospendere i
  workflow programmati. In quel caso nella scheda *Actions* compare un pulsante
  per riattivarlo.
- Se una mattina l'aggiornamento non arriva, la app mostra un avviso giallo
  "i dati sono di ieri".

## Modificare le soglie delle specie

Tutto sta in `config/specie.yaml`. Per esempio, per chiedere ai porcini estivi
almeno 40 mm di pioggia invece di 30:

```yaml
  porcini_estivi:
    pioggia_mm: 40
```

Cosa puoi cambiare per ogni specie:

| Campo | Significato |
|---|---|
| `mesi_centrali` | mesi in cui la stagione vale 1 (1 = gennaio) |
| `mesi_margine` | mesi in cui vale 0,5 |
| `quota` | fascia ideale in metri, `[minimo, massimo]` |
| `pioggia_mm` | pioggia in 26 giorni per avere il fattore pioggia pieno |
| `temperatura` | intervallo ideale della temperatura media di 20 giorni, `[min, max]` |
| `temperatura_ottimale` | il centro della campana (se manca, il centro dell'intervallo) |
| `habitat.adatte` | ambienti che valgono 1 (`t` = tipo di bosco, `c` = classe Corine) |
| `habitat.parziali` | ambienti che valgono 0,3 |

Nella sezione `comune` ci sono le regole uguali per tutte le specie: giorni di
pioggia e di temperatura, peso di pioggia e umidità del suolo, giorni di caldo,
pesi delle forme del terreno, quota delle sottocelle migliori che fanno il
punteggio della cella. L'elenco dei codici degli ambienti è in cima al file.

Dopo la modifica:

```
.venv\Scripts\python -m pytest                          # i test passano ancora?
.venv\Scripts\python scripts\prova_storica.py --anni 2024   # come cambia su una stagione vera
```

Poi commit e push. La mappa cambia al prossimo aggiornamento delle 6, oppure
subito se lanci il workflow a mano. Anche la tabella della pagina Info si
aggiorna da sola.

## Aggiungere una zona

In `config/aree.yaml` copia un blocco `- nome: ...` e cambia i quattro numeri
(`sud`, `nord`, `ovest`, `est`, in gradi decimali). Poi rilancia
`scarica_corine.py` e `prepare_static.py`, e fai commit di `data/celle.json`.
Rilancia anche `scarica_boschi.py` se la zona nuova esce dal rettangolo delle
aree attuali. Occhio al peso: oggi ci sono 907 celle e `punteggi.json` pesa
circa 640 KB, con un tetto di 1 MB. Il workflow si ferma con un errore se lo
supera.

## Comandi utili

| Comando | Cosa fa |
|---|---|
| `python -m pytest` | lancia i test |
| `python scripts/aggiorna_punteggi.py` | calcola i punteggi di oggi (circa 6 minuti) |
| `python scripts/prova_storica.py` | punteggi su agosto-novembre 2023-2025 in 9 posti noti, nella loro sottocella |
| `python scripts/crea_icone.py` | ridisegna le icone (serve Pillow) |
| `python -m http.server -d docs` | prova il sito in locale su http://localhost:8000 |

## Fonti e licenze

- Meteo: [Open-Meteo.com](https://open-meteo.com/), CC BY 4.0. Il piano gratuito vale per uso non commerciale.
- Quota: Copernicus DEM GLO-30. © DLR e.V. 2010-2014 e © Airbus Defence and Space GmbH 2014-2018, fornito nell'ambito di COPERNICUS dall'Unione europea e dall'ESA.
- Uso del suolo: Corine Land Cover 2018. © Unione europea, Copernicus Land Monitoring Service 2018, Agenzia europea dell'ambiente (EEA).
- Tipi di bosco: Carta forestale su base tipologica, Regione Lazio; Carta geobotanica, Regione Umbria e Università di Camerino.
- Finestre di pioggia e temperatura: Brejon Lamartiniere e Hoffman (2025), *Predicting porcini*, bioRxiv, doi:10.64898/2025.12.12.693895.
- Mappa: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, con [Leaflet](https://leafletjs.com/).
