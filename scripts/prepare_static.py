"""Prepara i dati che non cambiano: quota, bosco e terreno di celle e sottocelle.

Si lancia UNA volta sola (e di nuovo solo se cambi config/aree.yaml).
Prima servono i dati grezzi in data/raw/:

    python scripts/scarica_corine.py     # uso del suolo Corine
    python scripts/scarica_boschi.py     # tipi di bosco di Lazio e Umbria
    python scripts/prepare_static.py

Cosa fa:
1. costruisce la griglia di celle da 3 km (config/aree.yaml) e divide ogni
   cella in 6 x 6 sottocelle da 500 m;
2. scarica le tile del DEM Copernicus GLO-30 (bucket pubblico AWS, senza login)
   e ne ricava pendenza, esposizione e forma del terreno (canaloni, creste...);
3. per ogni sottocella campiona 10 x 10 punti (uno ogni 50 m) e calcola:
   - quota (10°, 50° e 90° percentile),
   - percentuale di ogni tipo di bosco (carte regionali) o classe Corine,
   - percentuale di ogni forma del terreno e pendenza media;
4. scarta le sottocelle quasi tutte acqua e le celle senza sottocelle;
5. disegna le immagini dei canaloni per la mappa (docs/data/canaloni/);
6. scrive data/celle.json (le celle) e data/sottocelle.json (le sottocelle).
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.merge import merge
from rasterio.transform import rowcol
from scipy.ndimage import uniform_filter

# Permette di importare il pacchetto fungometer anche lanciando lo script
# direttamente da questa cartella.
RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.griglia import SOTTOCELLE_PER_LATO, carica_aree, costruisci_griglia  # noqa: E402

CARTELLA_RAW = RADICE / "data" / "raw"
CARTELLA_DEM = CARTELLA_RAW / "dem"
URL_DEM = (
    "https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_{nome}_DEM/Copernicus_DSM_COG_10_{nome}_DEM.tif"
)

# Punti campionati per lato di sottocella: 10 x 10 = 100 punti, uno ogni 50 m.
PUNTI_PER_LATO = 10

# Sopra questa percentuale di acqua la sottocella viene scartata.
SOGLIA_ACQUA = 0.90

# Forme del terreno (codici nei raster e chiavi brevi nei JSON)
FORME = {1: "ca", 2: "cr", 3: "pi", 4: "vn", 5: "vo", 6: "vs", 7: "ri"}
#  ca = canalone o impluvio   cr = cresta o dosso   pi = pianoro
#  vn = versante a nord       vo = versante a est o ovest
#  vs = versante a sud        ri = pendio molto ripido (oltre 35 gradi)

# Soglie per riconoscere le forme (vedi forme_del_terreno)
RAGGIO_TPI_M = 150         # confronto con la quota media nel raggio di 150 m
SOGLIA_TPI_M = 10          # 10 m sotto la media intorno = canalone, 10 m sopra = cresta
PENDENZA_PIANORO = 5       # gradi
PENDENZA_RIPIDO = 35       # gradi
PENDENZA_MIN_CANALONE = 8  # un fondovalle piatto non è un canalone

# Il raster Corine europeo non contiene i codici a tre cifre (311, 312, ...)
# ma un indice da 1 a 44. Questa tabella li riconverte, nell'ordine ufficiale.
INDICE_A_CODICE_CORINE = dict(enumerate([
    111, 112, 121, 122, 123, 124, 131, 132, 133, 141, 142,
    211, 212, 213, 221, 222, 223, 231, 241, 242, 243, 244,
    311, 312, 313, 321, 322, 323, 324, 331, 332, 333, 334, 335,
    411, 412, 421, 422, 423, 511, 512, 521, 522, 523,
], start=1))


# ---------------------------------------------------------------------------
# Punti di campionamento
# ---------------------------------------------------------------------------

def punti_delle_sottocelle(cella):
    """Punti di campionamento di una cella, ordinati per sottocella.

    Restituisce due array (lat, lon) di forma (36, 100): per ognuna delle 36
    sottocelle, i suoi 100 punti. I punti stanno al centro di una griglia
    regolare, così nessuno cade esattamente sul bordo.
    Le sottocelle sono numerate per righe da sud a nord, come in
    fungometer.griglia.bbox_sottocella.
    """
    sud, ovest, nord, est = cella["bbox"]
    n = SOTTOCELLE_PER_LATO * PUNTI_PER_LATO  # 60 punti per lato di cella
    frazioni = (np.arange(n) + 0.5) / n
    griglia_lon, griglia_lat = np.meshgrid(ovest + frazioni * (est - ovest),
                                           sud + frazioni * (nord - sud))

    def per_sottocella(a):
        # Da (60, 60) a (6 righe, 10, 6 colonne, 10) e poi a (36, 100)
        a = a.reshape(SOTTOCELLE_PER_LATO, PUNTI_PER_LATO, SOTTOCELLE_PER_LATO, PUNTI_PER_LATO)
        return a.transpose(0, 2, 1, 3).reshape(SOTTOCELLE_PER_LATO ** 2, PUNTI_PER_LATO ** 2)

    return per_sottocella(griglia_lat), per_sottocella(griglia_lon)


# ---------------------------------------------------------------------------
# DEM Copernicus
# ---------------------------------------------------------------------------

def nome_tile(lat_intera, lon_intera):
    """Nome della tile DEM che copre il grado (es. N42_00_E012_00)."""
    ns = "N" if lat_intera >= 0 else "S"
    eo = "E" if lon_intera >= 0 else "W"
    return f"{ns}{abs(lat_intera):02d}_00_{eo}{abs(lon_intera):03d}_00"


def scarica_tile(nome, tentativi=3):
    """Scarica una tile DEM se non c'è già. Restituisce il percorso o None.

    None significa che la tile non esiste: succede per i quadrati di solo mare.
    """
    CARTELLA_DEM.mkdir(parents=True, exist_ok=True)
    percorso = CARTELLA_DEM / f"{nome}.tif"
    if percorso.exists():
        return percorso

    url = URL_DEM.format(nome=nome)
    for tentativo in range(1, tentativi + 1):
        try:
            risposta = requests.get(url, stream=True, timeout=60)
            if risposta.status_code in (403, 404):
                print(f"  tile {nome} assente (probabilmente solo mare)")
                return None
            risposta.raise_for_status()
            # Scrive prima su un file temporaneo: se il download si interrompe
            # non resta una tile a metà che sembra buona.
            temporaneo = percorso.with_suffix(".part")
            with open(temporaneo, "wb") as f:
                for blocco in risposta.iter_content(chunk_size=1 << 20):
                    f.write(blocco)
            temporaneo.rename(percorso)
            print(f"  tile {nome} scaricata")
            return percorso
        except requests.RequestException as errore:
            print(f"  tile {nome}: tentativo {tentativo} fallito ({errore})")
            time.sleep(5 * tentativo)
    raise RuntimeError(f"Impossibile scaricare la tile DEM {nome}")


def mosaico_dem(ovest, sud, est, nord):
    """Unisce le tile DEM che coprono il rettangolo e lo ritaglia.

    Restituisce (quote, trasformazione) con le quote in metri (NaN sul mare).
    """
    percorsi = []
    for lat_t in range(int(np.floor(sud)), int(np.floor(nord)) + 1):
        for lon_t in range(int(np.floor(ovest)), int(np.floor(est)) + 1):
            percorso = scarica_tile(nome_tile(lat_t, lon_t))
            if percorso:
                percorsi.append(percorso)
    sorgenti = [rasterio.open(p) for p in percorsi]
    try:
        quote, trasformazione = merge(sorgenti, bounds=(ovest, sud, est, nord), nodata=-9999)
    finally:
        for s in sorgenti:
            s.close()
    quote = quote[0].astype("float32")
    quote[quote <= -9999] = np.nan
    return quote, trasformazione


# ---------------------------------------------------------------------------
# Terreno: pendenza, esposizione, canaloni
# ---------------------------------------------------------------------------

def forme_del_terreno(quote, trasformazione):
    """Classifica ogni pixel del DEM in una forma del terreno.

    - pendenza ed esposizione dal gradiente delle quote;
    - TPI (indice di posizione topografica) = quota del punto meno la quota
      media nel raggio di 150 m: molto negativo nei canaloni e negli impluvi,
      positivo su creste e dossi.
    Restituisce (forma, pendenza_gradi), array della stessa forma del DEM.
    """
    lat_media = trasformazione.f + trasformazione.e * quote.shape[0] / 2
    passo_y = abs(trasformazione.e) * 111320                               # metri per pixel in verticale
    passo_x = trasformazione.a * 111320 * np.cos(np.radians(lat_media))    # e in orizzontale

    riempite = np.where(np.isnan(quote), np.nanmean(quote), quote)
    dz_sud, dz_est = np.gradient(riempite, passo_y, passo_x)
    dz_nord = -dz_sud  # le righe dell'immagine crescono verso sud
    pendenza = np.degrees(np.arctan(np.hypot(dz_est, dz_nord)))
    # Esposizione: verso dove scende il versante, in gradi da nord in senso orario
    esposizione = (np.degrees(np.arctan2(-dz_est, -dz_nord)) + 360) % 360

    finestra = (2 * round(RAGGIO_TPI_M / passo_y) + 1, 2 * round(RAGGIO_TPI_M / passo_x) + 1)
    tpi = riempite - uniform_filter(riempite, size=finestra, mode="nearest")

    forma = np.full(quote.shape, 5, dtype="uint8")                          # versante est/ovest
    forma[(esposizione >= 315) | (esposizione < 45)] = 4                    # versante nord
    forma[(esposizione >= 135) & (esposizione < 225)] = 6                   # versante sud
    forma[pendenza < PENDENZA_PIANORO] = 3                                  # pianoro
    forma[tpi > SOGLIA_TPI_M] = 2                                           # cresta
    forma[(tpi < -SOGLIA_TPI_M) & (pendenza >= PENDENZA_MIN_CANALONE)] = 1  # canalone
    forma[pendenza > PENDENZA_RIPIDO] = 7                                   # ripido
    forma[np.isnan(quote)] = 0
    return forma, pendenza.astype("float32")


def leggi_nei_punti(raster, trasformazione, lats, lons, vuoto=0):
    """Valore del raster (in lat/lon) nel pixel che contiene ogni punto."""
    righe, colonne = rowcol(trasformazione, lons.ravel(), lats.ravel())
    righe, colonne = np.array(righe), np.array(colonne)
    dentro = (righe >= 0) & (righe < raster.shape[0]) & (colonne >= 0) & (colonne < raster.shape[1])
    valori = np.full(righe.shape, vuoto, dtype=raster.dtype)
    valori[dentro] = raster[righe[dentro], colonne[dentro]]
    return valori.reshape(lats.shape)


def salva_canaloni(forma, trasformazione, zone, codice_area, cartella):
    """Un'immagine PNG per zona: canaloni in blu, tutto il resto trasparente.

    Restituisce {zona_id: [[sud, ovest], [nord, est]]}, i confini delle
    immagini per posarle sulla mappa.
    """
    cartella.mkdir(parents=True, exist_ok=True)
    indice = {}
    for n, zona in enumerate(zone, start=1):
        r0, c0 = rowcol(trasformazione, zona["ovest"], zona["nord"])
        r1, c1 = rowcol(trasformazione, zona["est"], zona["sud"])
        r0, c0 = max(r0, 0), max(c0, 0)
        canalone = forma[r0:r1, c0:c1] == 1
        rgba = np.zeros((4, *canalone.shape), dtype="uint8")
        rgba[0][canalone], rgba[1][canalone], rgba[2][canalone] = 20, 90, 200
        rgba[3][canalone] = 190
        zona_id = f"{codice_area}_{n}"
        with rasterio.open(cartella / f"{zona_id}.png", "w", driver="PNG", width=canalone.shape[1],
                           height=canalone.shape[0], count=4, dtype="uint8") as f:
            f.write(rgba)
        # Confini esatti dell'immagine (i pixel non cadono proprio sui bordi della zona)
        ovest, nord = trasformazione * (c0, r0)
        est, sud = trasformazione * (c1, r1)
        indice[zona_id] = [[round(sud, 6), round(ovest, 6)], [round(nord, 6), round(est, 6)]]
    # I file accessori che GDAL scrive accanto ai PNG non servono
    for extra in cartella.glob("*.aux.xml"):
        extra.unlink()
    return indice


# ---------------------------------------------------------------------------
# Corine Land Cover
# ---------------------------------------------------------------------------

def trova_file_corine():
    """Cerca in data/raw/ i .tif con CLC2018 nel nome.

    Possono essere i file per area prodotti da scarica_corine.py
    (CLC2018_foligno.tif, CLC2018_roma.tif) oppure il raster europeo
    scaricato a mano dal portale Copernicus.
    """
    candidati = sorted(
        p for p in CARTELLA_RAW.rglob("*.tif")
        if "clc2018" in p.name.lower()
    )
    if not candidati:
        sys.exit(
            "Non trovo il raster Corine in data/raw/.\n"
            "Lancia prima: python scripts/scarica_corine.py (vedi README)."
        )
    return candidati


def in_codice_corine(valori):
    """Converte i valori letti dal raster nel codice Corine a tre cifre.

    Il raster europeo usa un indice da 1 a 44; i file di scarica_corine.py
    contengono già i codici a tre cifre, che restano come sono.
    Tutto il resto (nessun dato) diventa 0.
    """
    codici = np.zeros(valori.shape, dtype=int)
    for valore in np.unique(valori):
        valore = int(valore)
        if valore in INDICE_A_CODICE_CORINE:
            codice = INDICE_A_CODICE_CORINE[valore]
        elif 111 <= valore <= 523:
            codice = valore
        else:
            codice = 0
        codici[valori == valore] = codice
    return codici


def classi_dei_punti(lats, lons, percorsi_corine):
    """Restituisce il codice Corine (es. 311) di ogni punto; 0 se sconosciuto.

    Per ogni file legge solo i punti che cadono al suo interno.
    """
    if isinstance(percorsi_corine, (str, Path)):
        percorsi_corine = [percorsi_corine]

    codici = np.zeros(lats.shape, dtype=int)
    for percorso in percorsi_corine:
        with rasterio.open(percorso) as raster:
            # Porta i punti nelle coordinate del raster (EPSG:3035 per il
            # file europeo, lat/lon per quelli di scarica_corine.py).
            trasformatore = Transformer.from_crs("EPSG:4326", raster.crs, always_xy=True)
            xs, ys = trasformatore.transform(lons, lats)
            righe, colonne = rowcol(raster.transform, xs, ys)
            righe, colonne = np.array(righe), np.array(colonne)

            # Solo i punti dentro questo file e non ancora classificati.
            dentro = (
                (righe >= 0) & (righe < raster.height)
                & (colonne >= 0) & (colonne < raster.width)
                & (codici == 0)
            )
            if not dentro.any():
                continue

            # Legge solo il rettangolo che contiene i punti, non tutto il file.
            r0, r1 = righe[dentro].min(), righe[dentro].max()
            c0, c1 = colonne[dentro].min(), colonne[dentro].max()
            finestra = rasterio.windows.Window(c0, r0, c1 - c0 + 1, r1 - r0 + 1)
            dati = raster.read(1, window=finestra)
            valori = dati[righe[dentro] - r0, colonne[dentro] - c0]
            codici[dentro] = in_codice_corine(valori)
    return codici


# ---------------------------------------------------------------------------
# Programma principale
# ---------------------------------------------------------------------------

def percentuali(valori, minimo=5):
    """Da un array di etichette a {etichetta: percentuale}, solo quelle >= minimo%."""
    etichette, conteggi = np.unique(valori, return_counts=True)
    totale = valori.size
    return {str(e): int(round(100 * c / totale)) for e, c in zip(etichette, conteggi)
            if 100 * c / totale >= minimo}


def main():
    config = carica_aree(RADICE / "config" / "aree.yaml")
    celle = costruisci_griglia(RADICE / "config" / "aree.yaml")
    percorsi_corine = trova_file_corine()
    print(f"Griglia: {len(celle)} celle, {len(celle) * SOTTOCELLE_PER_LATO ** 2} sottocelle")

    celle_tenute, sottocelle, indice_canaloni = [], {}, {}

    for codice_area, area in config["aree"].items():
        celle_area = [c for c in celle if c["area"] == codice_area]
        print(f"Area {codice_area}: {len(celle_area)} celle")

        # Punti di tutte le celle dell'area: forma (celle, 36, 100)
        punti = [punti_delle_sottocelle(c) for c in celle_area]
        lats = np.stack([p[0] for p in punti])
        lons = np.stack([p[1] for p in punti])

        # Terreno: mosaico DEM dell'area con un margine
        margine = 0.02
        quote_dem, tr = mosaico_dem(lons.min() - margine, lats.min() - margine,
                                    lons.max() + margine, lats.max() + margine)
        print("  forme del terreno...")
        forma, pendenza = forme_del_terreno(quote_dem, tr)
        quote = leggi_nei_punti(quote_dem, tr, lats, lons, vuoto=np.nan)
        forme = leggi_nei_punti(forma, tr, lats, lons)
        pendenze = leggi_nei_punti(pendenza, tr, lats, lons, vuoto=np.nan)
        indice_canaloni.update(salva_canaloni(forma, tr, area["zone"], codice_area,
                                              RADICE / "docs" / "data" / "canaloni"))
        del quote_dem, forma, pendenza

        # Uso del suolo: tipo di bosco (carte regionali) e Corine
        print("  bosco e uso del suolo...")
        with rasterio.open(CARTELLA_RAW / f"boschi_{codice_area}.tif") as f:
            tipi = leggi_nei_punti(f.read(1), f.transform, lats, lons)
        corine = classi_dei_punti(lats.ravel(), lons.ravel(), percorsi_corine).reshape(lats.shape)
        # Etichetta di ogni punto: "t<tipo di bosco>" dove la carta regionale dice
        # qualcosa, altrimenti "c<classe Corine>"
        etichette = np.where(tipi > 0, np.char.add("t", tipi.astype(str)),
                             np.char.add("c", corine.astype(str)))
        acqua = (corine >= 500) | (corine == 0)

        for i, cella in enumerate(celle_area):
            elenco = []
            for k in range(SOTTOCELLE_PER_LATO ** 2):
                q = quote[i, k]
                if np.mean(acqua[i, k]) >= SOGLIA_ACQUA or np.all(np.isnan(q)):
                    elenco.append(None)
                    continue
                forme_valide = forme[i, k][forme[i, k] > 0]
                elenco.append({
                    "q": [int(round(v)) for v in np.nanpercentile(q, [10, 50, 90])],
                    "h": percentuali(etichette[i, k]),
                    "m": {FORME[int(c)]: v for c, v in percentuali(forme_valide).items()},
                    "p": int(round(float(np.nanmean(pendenze[i, k])))),
                })
            if all(s is None for s in elenco):
                continue
            q_cella = quote[i][~np.isnan(quote[i])]
            cella["quota"] = {"media": int(round(q_cella.mean())), "min": int(round(q_cella.min())),
                              "max": int(round(q_cella.max()))}
            cella["uso"] = percentuali(etichette[i])
            celle_tenute.append(cella)
            sottocelle[cella["id"]] = elenco

    with open(RADICE / "data" / "celle.json", "w", encoding="utf-8") as f:
        json.dump(celle_tenute, f, ensure_ascii=False, indent=1)
    with open(RADICE / "data" / "sottocelle.json", "w", encoding="utf-8") as f:
        json.dump(sottocelle, f, ensure_ascii=False, separators=(",", ":"))
    with open(RADICE / "docs" / "data" / "canaloni" / "indice.json", "w", encoding="utf-8") as f:
        json.dump(indice_canaloni, f)

    n_sotto = sum(1 for v in sottocelle.values() for s in v if s)
    print(f"Celle tenute: {len(celle_tenute)} su {len(celle)}; sottocelle valide: {n_sotto}")
    print("Scritti data/celle.json, data/sottocelle.json e docs/data/canaloni/")


if __name__ == "__main__":
    main()
