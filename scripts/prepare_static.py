"""Prepara i dati che non cambiano: quota e uso del suolo di ogni cella.

Si lancia UNA volta sola (e di nuovo solo se cambi config/aree.yaml):

    python scripts/prepare_static.py

Cosa fa:
1. costruisce la griglia di celle da config/aree.yaml;
2. scarica le tile del DEM Copernicus GLO-30 che servono (bucket pubblico AWS,
   nessun login) in data/raw/dem/;
3. legge Corine Land Cover 2018 da data/raw/ (prodotto da scarica_corine.py);
4. per ogni cella campiona una griglia fitta di punti (20 x 20, uno ogni
   ~150 m) e calcola quota media/minima/massima, la percentuale della cella
   in ogni fascia di 100 m e la percentuale di ogni classe Corine;
5. scarta le celle che sono quasi tutte acqua (mare, laghi);
6. scrive data/celle.json.

Opzione per provare senza Corine:

    python scripts/prepare_static.py --senza-corine

calcola solo la quota e scrive data/celle_prova.json (ignorato da git).
"""

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.transform import rowcol

# Permette di importare il pacchetto fungometer anche lanciando lo script
# direttamente da questa cartella.
RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.griglia import costruisci_griglia  # noqa: E402

CARTELLA_RAW = RADICE / "data" / "raw"
CARTELLA_DEM = CARTELLA_RAW / "dem"
URL_DEM = (
    "https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_{nome}_DEM/Copernicus_DSM_COG_10_{nome}_DEM.tif"
)

# Punti campionati per lato di cella: 20 x 20 = 400 punti per cella.
PUNTI_PER_LATO = 20

# Sopra questa percentuale di acqua la cella viene scartata.
SOGLIA_ACQUA = 0.90

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

def punti_della_cella(cella):
    """Restituisce due array (lat, lon) con i punti interni alla cella.

    I punti stanno al centro di una griglia 20 x 20 dentro la cella, così
    nessun punto cade esattamente sul bordo.
    """
    sud, ovest, nord, est = cella["bbox"]
    frazioni = (np.arange(PUNTI_PER_LATO) + 0.5) / PUNTI_PER_LATO
    lats = sud + frazioni * (nord - sud)
    lons = ovest + frazioni * (est - ovest)
    griglia_lon, griglia_lat = np.meshgrid(lons, lats)
    return griglia_lat.ravel(), griglia_lon.ravel()


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


def quote_dei_punti(lats, lons):
    """Restituisce la quota (m) di ogni punto; NaN dove il DEM non c'è."""
    quote = np.full(lats.shape, np.nan)
    lat_intere = np.floor(lats).astype(int)
    lon_intere = np.floor(lons).astype(int)

    # Una tile alla volta, per non tenere tutte le tile in memoria insieme.
    for lat_t, lon_t in sorted(set(zip(lat_intere, lon_intere))):
        nome = nome_tile(lat_t, lon_t)
        percorso = scarica_tile(nome)
        if percorso is None:
            continue
        maschera = (lat_intere == lat_t) & (lon_intere == lon_t)
        with rasterio.open(percorso) as tile:
            dati = tile.read(1)
            righe, colonne = rowcol(tile.transform, lons[maschera], lats[maschera])
            righe = np.clip(np.array(righe), 0, dati.shape[0] - 1)
            colonne = np.clip(np.array(colonne), 0, dati.shape[1] - 1)
            valori = dati[righe, colonne].astype(float)
            if tile.nodata is not None:
                valori[valori == tile.nodata] = np.nan
            quote[maschera] = valori
    return quote


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
            "Lancia prima: python scripts/scarica_corine.py (vedi README).\n"
            "Per provare solo la quota: python scripts/prepare_static.py --senza-corine"
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

def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--senza-corine",
        action="store_true",
        help="calcola solo la quota e scrive data/celle_prova.json",
    )
    args = parser.parse_args()

    celle = costruisci_griglia(RADICE / "config" / "aree.yaml")
    print(f"Griglia: {len(celle)} celle")

    # Tutti i punti di tutte le celle in due array lunghi; `inizio` ricorda
    # dove cominciano i punti di ogni cella.
    punti = [punti_della_cella(c) for c in celle]
    lats = np.concatenate([p[0] for p in punti])
    lons = np.concatenate([p[1] for p in punti])
    per_cella = PUNTI_PER_LATO * PUNTI_PER_LATO

    print("Quota dal DEM Copernicus GLO-30...")
    quote = quote_dei_punti(lats, lons)

    codici = None
    if not args.senza_corine:
        percorsi_corine = trova_file_corine()
        nomi = ", ".join(p.name for p in percorsi_corine)
        print(f"Uso del suolo da {nomi}...")
        codici = classi_dei_punti(lats, lons, percorsi_corine)

    risultato = []
    scartate = 0
    for i, cella in enumerate(celle):
        da, a = i * per_cella, (i + 1) * per_cella
        quote_cella = quote[da:a]
        validi = ~np.isnan(quote_cella)

        if codici is not None:
            codici_cella = codici[da:a]
            # Acqua = classi 5xx (fiumi, laghi, mare) oppure nessun dato.
            acqua = np.mean((codici_cella >= 500) | (codici_cella == 0))
        else:
            codici_cella = None
            acqua = 1 - np.mean(validi)

        if acqua >= SOGLIA_ACQUA or not validi.any():
            scartate += 1
            continue

        cella["quota"] = {
            "media": int(round(np.nanmean(quote_cella))),
            "min": int(round(np.nanmin(quote_cella))),
            "max": int(round(np.nanmax(quote_cella))),
        }
        # Percentuale della cella in ogni fascia di 100 m (chiave = inizio
        # della fascia): serve a capire quanta parte della cella sta nella
        # fascia di quota ideale di una specie, non solo la media.
        fasce = Counter(int(q // 100) * 100 for q in quote_cella[validi])
        cella["fasce_quota"] = {
            str(fascia): round(100 * n / validi.sum())
            for fascia, n in sorted(fasce.items())
            if 100 * n / validi.sum() >= 1
        }

        if codici_cella is not None:
            conteggio = Counter(int(c) for c in codici_cella if c != 0)
            totale = len(codici_cella)
            # Percentuale di ogni classe, tenendo solo quelle almeno all'1%.
            cella["corine"] = {
                str(codice): round(100 * n / totale)
                for codice, n in conteggio.most_common()
                if 100 * n / totale >= 1
            }
            cella["corine_prevalente"] = conteggio.most_common(1)[0][0]

        risultato.append(cella)

    nome_file = "celle_prova.json" if args.senza_corine else "celle.json"
    uscita = RADICE / "data" / nome_file
    uscita.parent.mkdir(parents=True, exist_ok=True)
    with open(uscita, "w", encoding="utf-8") as f:
        json.dump(risultato, f, ensure_ascii=False, indent=1)

    print(f"Celle tenute: {len(risultato)}, scartate perché acqua: {scartate}")
    print(f"Scritto {uscita.relative_to(RADICE)}")


if __name__ == "__main__":
    main()
