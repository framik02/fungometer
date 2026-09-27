"""Scarica Corine Land Cover 2018 per le nostre aree, senza login.

Il portale Copernicus chiede un account, ma l'Agenzia europea dell'ambiente
(EEA) pubblica lo stesso dato vettoriale su un servizio ArcGIS aperto:
    https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC2018_LAEA/MapServer/0

Lo script:
1. per ogni area di config/aree.yaml chiede i poligoni Corine che toccano il
   rettangolo dell'area (1000 poligoni per pagina);
2. "disegna" i poligoni su una griglia di pixel da circa 100 m, scrivendo in
   ogni pixel il codice Corine a tre cifre (311, 312, ...);
3. salva il risultato in data/raw/CLC2018_<area>.tif, che prepare_static.py
   trova da solo.

Uso:
    python scripts/scarica_corine.py
"""

import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.features import rasterize
from rasterio.transform import from_origin

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.griglia import carica_aree  # noqa: E402

URL_QUERY = (
    "https://image.discomap.eea.europa.eu/arcgis/rest/services/"
    "Corine/CLC2018_LAEA/MapServer/0/query"
)
PER_PAGINA = 1000

# Dimensione del pixel in gradi: 0,0009° sono circa 100 m in latitudine
# e circa 70 m in longitudine alle nostre latitudini. Il dato originale è
# a 100 m, quindi non perdiamo dettaglio.
PIXEL_GRADI = 0.0009

# Margine attorno all'area, in gradi, per non tagliare le celle di bordo.
MARGINE = 0.02


def chiedi_pagina(rettangolo, offset, tentativi=4):
    """Chiede una pagina di poligoni al servizio EEA, con qualche tentativo."""
    ovest, sud, est, nord = rettangolo
    parametri = {
        "geometry": f"{ovest},{sud},{est},{nord}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "Code_18",
        "returnGeometry": "true",
        "orderByFields": "OBJECTID",
        "resultOffset": offset,
        "resultRecordCount": PER_PAGINA,
        "f": "geojson",  # coordinate in lat/lon (EPSG:4326)
    }
    for tentativo in range(1, tentativi + 1):
        try:
            risposta = requests.post(URL_QUERY, data=parametri, timeout=120)
            risposta.raise_for_status()
            dati = risposta.json()
            if "error" in dati:
                raise RuntimeError(dati["error"])
            return dati["features"]
        except (requests.RequestException, RuntimeError, ValueError) as errore:
            print(f"  pagina {offset}: tentativo {tentativo} fallito ({errore})")
            time.sleep(5 * tentativo)
    raise RuntimeError("Il servizio EEA non risponde, riprova più tardi.")


def scarica_area(codice, area):
    """Scarica i poligoni di un'area e li salva come raster GeoTIFF."""
    zone = area["zone"]
    ovest = min(z["ovest"] for z in zone) - MARGINE
    sud = min(z["sud"] for z in zone) - MARGINE
    est = max(z["est"] for z in zone) + MARGINE
    nord = max(z["nord"] for z in zone) + MARGINE

    poligoni = []
    offset = 0
    while True:
        pagina = chiedi_pagina((ovest, sud, est, nord), offset)
        poligoni.extend(pagina)
        print(f"  {codice}: {len(poligoni)} poligoni")
        if len(pagina) < PER_PAGINA:
            break
        offset += PER_PAGINA

    # Griglia di pixel che copre il rettangolo dell'area.
    larghezza = int(np.ceil((est - ovest) / PIXEL_GRADI))
    altezza = int(np.ceil((nord - sud) / PIXEL_GRADI))
    trasformazione = from_origin(ovest, nord, PIXEL_GRADI, PIXEL_GRADI)

    # Ogni poligono "colora" i pixel che copre con il suo codice.
    # 0 = nessun poligono (non dovrebbe succedere dentro l'Europa).
    forme = (
        (p["geometry"], int(p["properties"]["Code_18"]))
        for p in poligoni
        if p.get("geometry")
    )
    raster = rasterize(
        forme,
        out_shape=(altezza, larghezza),
        transform=trasformazione,
        fill=0,
        dtype="uint16",  # i codici arrivano a 523, non stanno in un byte
    )

    uscita = RADICE / "data" / "raw" / f"CLC2018_{codice}.tif"
    uscita.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        uscita, "w", driver="GTiff", height=altezza, width=larghezza,
        count=1, dtype="uint16", crs="EPSG:4326", transform=trasformazione,
        nodata=0, compress="deflate",
    ) as file:
        file.write(raster, 1)

    classi = np.unique(raster[raster > 0])
    print(f"  {codice}: salvato {uscita.name}, {len(classi)} classi diverse")


def main():
    config = carica_aree(RADICE / "config" / "aree.yaml")
    for codice, area in config["aree"].items():
        print(f"Area {codice}...")
        scarica_area(codice, area)


if __name__ == "__main__":
    main()
