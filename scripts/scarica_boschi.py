"""Scarica le carte regionali dei tipi di bosco e le salva come raster.

Corine dice solo "latifoglie", "conifere" o "misto". Le carte regionali dicono
di più (faggeta, castagneto, cerreta...), e questo conta molto per i funghi.

- Lazio: Carta forestale su base tipologica (geoportale regionale, servizio
  WFS pubblico, senza login). Copre solo i boschi e gli arbusteti.
- Umbria: Carta geobotanica con principali classi di uso del suolo
  (Regione Umbria e Università di Camerino, scala 1:50.000, servizio ArcGIS
  pubblico). Distingue boschi montani (faggete), collinari (cerro, roverella,
  castagno insieme), leccete, conifere, arbusteti e praterie.

Le categorie delle due carte vengono unificate in un codice FungoMeter
(vedi TIPI qui sotto) e salvate in data/raw/boschi_<area>.tif, con un
pixel di circa 30 m. Dove la carta non dice nulla il valore è 0 e
prepare_static.py userà Corine.

Uso:
    python scripts/scarica_boschi.py
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import LinearRing, Polygon, mapping, shape
from shapely.ops import transform as trasforma_geometria

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.griglia import carica_aree  # noqa: E402

# Codici FungoMeter dei tipi di bosco (gli stessi usati in config/specie.yaml)
TIPI = {
    1: "Faggeta",
    2: "Castagneto",
    3: "Cerreta",
    4: "Querceto (roverella, farnia)",
    5: "Lecceta o sughereta",
    6: "Pineta o rimboschimento di conifere",
    7: "Ostrieto o bosco di forra",
    8: "Bosco collinare misto (cerro, roverella, castagno)",
    9: "Altro bosco (ripariale, robinia, arboricoltura)",
    10: "Arbusteto o macchia",
    11: "Prateria o pascolo naturale",
}

LAZIO = {
    "Faggeta": 1,
    "Castagneto": 2,
    "Cerreta": 3,
    "Querceto a roverella": 4,
    "Querceto a farnia": 4,
    "Lecceta": 5,
    "Sughereta": 5,
    "Rimboschimenti di pini e/o altre conifere montane": 6,
    "Pineta termofila": 6,
    "Ostrieto": 7,
    "Bosco di forra": 7,
    "Bosco alveale e ripariale": 9,
    "Robinieto/ailanteto": 9,
    "Piantagione di arboricoltura da legno": 9,
    "Arbusteto e macchia alta": 10,
    "Pseudo-macchia": 10,
}

# Codici della carta geobotanica umbra (campo FIRST_CODA)
UMBRIA = {
    "1": 5,   # Boschi di sclerofille sempreverdi (leccete)
    "2": 9,   # Boschi di caducifoglie planiziali
    "3": 8,   # Boschi di caducifoglie collinari e submontane
    "4": 1,   # Boschi di caducifoglie montane (faggete)
    "5": 9,   # Boschi e boscaglie ripariali
    "6": 10,  # Brughiere planiziali e collinari
    "7": 10,  # Arbusteti collinari e montani
    "8": 10,  # Brughiere alto-montane
    "9": 11,  # Praterie secondarie
    "10": 11,  # Praterie primarie appenniniche
    "14": 6,  # Rimboschimenti a conifere
    # Gli altri (colture, oliveti, vigneti, aree urbane, rupi, acque) restano
    # 0: per quei posti prepare_static.py usa Corine.
}

URL_LAZIO = "https://geoportale.regione.lazio.it/geoserver/ows"
URL_UMBRIA = ("https://siat.regione.umbria.it/arcgis/rest/services/public/"
              "WEBGIS4_WGS84_UTM33/MapServer/0/query")

PIXEL_GRADI = 1 / 3600  # 1 secondo d'arco, circa 30 m: come il DEM
MARGINE = 0.02


def _richiesta(metodo, url, tentativi=4, **kwargs):
    """Richiesta HTTP con qualche tentativo in caso di errore."""
    for tentativo in range(1, tentativi + 1):
        try:
            risposta = requests.request(metodo, url, timeout=180, **kwargs)
            risposta.raise_for_status()
            dati = risposta.json()
            # ArcGIS risponde "200 OK" anche quando fallisce: l'errore sta nel JSON
            if "error" in dati:
                raise ValueError(f"errore del servizio: {dati['error']}")
            return dati
        except (requests.RequestException, ValueError) as errore:
            print(f"  tentativo {tentativo} fallito ({errore})")
            time.sleep(10 * tentativo)
    raise RuntimeError(f"Il servizio {url} non risponde")


def poligoni_lazio(ovest, sud, est, nord):
    """Scarica i poligoni forestali del Lazio nel rettangolo (in lat/lon)."""
    # Il servizio lavora in EPSG:25833 (metri): convertiamo il rettangolo.
    verso_utm = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
    x0, y0 = verso_utm.transform(ovest, sud)
    x1, y1 = verso_utm.transform(est, nord)
    verso_gradi = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True).transform

    forme, inizio, pagina = [], 0, 5000
    while True:
        dati = _richiesta("GET", URL_LAZIO, params={
            "service": "WFS", "version": "2.0.0", "request": "GetFeature",
            "typeNames": "geonode:tipi_forestali2", "outputFormat": "application/json",
            "propertyName": "categoria,the_geom",
            "bbox": f"{x0},{y0},{x1},{y1},urn:ogc:def:crs:EPSG::25833",
            "count": pagina, "startIndex": inizio, "sortBy": "fid",
        })
        elementi = dati.get("features", [])
        for el in elementi:
            codice = LAZIO.get(el["properties"].get("categoria"))
            if codice and el.get("geometry"):
                geometria = trasforma_geometria(verso_gradi, shape(el["geometry"]))
                forme.append((mapping(geometria), codice))
        print(f"  Lazio: {inizio + len(elementi)} poligoni letti")
        if len(elementi) < pagina:
            return forme
        inizio += pagina


def _anelli_esri_in_poligoni(anelli):
    """Il formato ArcGIS elenca anelli esterni (orari) e buchi (antiorari)
    tutti insieme: qui li ricomponiamo in poligoni con i loro buchi."""
    esterni, buchi = [], []
    for anello in anelli:
        (buchi if LinearRing(anello).is_ccw else esterni).append(anello)
    poligoni = [Polygon(e) for e in esterni]
    con_buchi = [[] for _ in poligoni]
    for buco in buchi:
        punto = Polygon(buco).representative_point()
        for k, p in enumerate(poligoni):
            if p.contains(punto):
                con_buchi[k].append(buco)
                break
    return [Polygon(e, b) for e, b in zip(esterni, con_buchi)]


def poligoni_umbria():
    """Scarica tutta la carta geobotanica umbra (circa 1.050 poligoni)."""
    forme = []
    ids = _richiesta("POST", URL_UMBRIA, data={"where": "1=1", "returnIdsOnly": "true", "f": "json"})["objectIds"]
    # Poligoni grandi e dettagliati: 100 per richiesta, altrimenti il server rifiuta
    for primo in range(min(ids), max(ids) + 1, 100):
        dati = _richiesta("POST", URL_UMBRIA, data={
            "where": f"OBJECTID >= {primo} AND OBJECTID < {primo + 100}",
            "outFields": "FIRST_CODA", "outSR": 4326,
            "returnGeometry": "true", "f": "json",
        })
        for el in dati.get("features", []):
            codice = UMBRIA.get(str(el["attributes"]["FIRST_CODA"]).strip())
            if not codice:
                continue
            for poligono in _anelli_esri_in_poligoni(el["geometry"]["rings"]):
                forme.append((mapping(poligono), codice))
        print(f"  Umbria: {len(forme)} poligoni utili")
    return forme


def salva_raster(forme, ovest, sud, est, nord, percorso):
    larghezza = int(np.ceil((est - ovest) / PIXEL_GRADI))
    altezza = int(np.ceil((nord - sud) / PIXEL_GRADI))
    trasformazione = from_origin(ovest, nord, PIXEL_GRADI, PIXEL_GRADI)
    raster = rasterize(forme, out_shape=(altezza, larghezza), transform=trasformazione,
                       fill=0, dtype="uint8")
    percorso.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(percorso, "w", driver="GTiff", height=altezza, width=larghezza,
                       count=1, dtype="uint8", crs="EPSG:4326", transform=trasformazione,
                       nodata=0, compress="deflate") as f:
        f.write(raster, 1)
    presenti = {TIPI[int(c)]: f"{100 * np.mean(raster == c):.1f}%" for c in np.unique(raster) if c}
    print(f"  salvato {percorso.name}: {presenti}")


def main():
    config = carica_aree(RADICE / "config" / "aree.yaml")
    umbria = None
    for codice, area in config["aree"].items():
        zone = area["zone"]
        ovest = min(z["ovest"] for z in zone) - MARGINE
        sud = min(z["sud"] for z in zone) - MARGINE
        est = max(z["est"] for z in zone) + MARGINE
        nord = max(z["nord"] for z in zone) + MARGINE
        print(f"Area {codice}...")
        # Le aree possono toccare entrambe le regioni: usiamo tutte e due le carte.
        if umbria is None:
            umbria = poligoni_umbria()
        forme = umbria + poligoni_lazio(ovest, sud, est, nord)
        salva_raster(forme, ovest, sud, est, nord, RADICE / "data" / "raw" / f"boschi_{codice}.tif")

    with open(RADICE / "data" / "tipi_bosco.json", "w", encoding="utf-8") as f:
        json.dump({str(k): v for k, v in TIPI.items()}, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
