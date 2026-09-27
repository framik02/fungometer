"""Costruzione della griglia di celle a partire da config/aree.yaml.

Ogni area ha una griglia regolare in gradi:
- in latitudine un grado vale sempre circa 111,32 km;
- in longitudine un grado si accorcia andando verso nord (moltiplicato per il
  coseno della latitudine), quindi il passo in longitudine si calcola sulla
  latitudine centrale dell'area.

Così ogni cella è un rettangolo in gradi che sul terreno misura circa 3 x 3 km,
e sulla mappa Leaflet si disegna con quattro numeri.
"""

import math
from pathlib import Path

import yaml

KM_PER_GRADO_LAT = 111.32

# Ogni cella da 3 km si divide in 6 x 6 sottocelle da 500 m.
# Il meteo resta per cella (i modelli meteo non sono più fini di così);
# habitat, quota e terreno si calcolano per sottocella.
SOTTOCELLE_PER_LATO = 6


def carica_aree(percorso):
    """Legge il file YAML delle aree e lo restituisce come dizionario."""
    with open(percorso, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _dentro(lat, lon, zona):
    """Vero se il punto (lat, lon) cade nel rettangolo della zona."""
    return zona["sud"] <= lat <= zona["nord"] and zona["ovest"] <= lon <= zona["est"]


def celle_di_un_area(codice_area, area, lato_km):
    """Restituisce la lista delle celle di un'area.

    La griglia parte dall'angolo sud-ovest del rettangolo che contiene tutte le
    zone dell'area. Una cella viene tenuta se il suo centro cade in una zona.
    """
    zone = area["zone"]
    sud = min(z["sud"] for z in zone)
    nord = max(z["nord"] for z in zone)
    ovest = min(z["ovest"] for z in zone)
    est = max(z["est"] for z in zone)

    # Passo della griglia in gradi.
    passo_lat = lato_km / KM_PER_GRADO_LAT
    lat_centrale = (sud + nord) / 2
    passo_lon = lato_km / (KM_PER_GRADO_LAT * math.cos(math.radians(lat_centrale)))

    n_righe = math.ceil((nord - sud) / passo_lat)
    n_colonne = math.ceil((est - ovest) / passo_lon)

    celle = []
    for riga in range(n_righe):
        for colonna in range(n_colonne):
            c_sud = sud + riga * passo_lat
            c_ovest = ovest + colonna * passo_lon
            lat = c_sud + passo_lat / 2
            lon = c_ovest + passo_lon / 2

            # La prima zona che contiene il centro dà il nome alla cella.
            n_zona = next((k for k, z in enumerate(zone) if _dentro(lat, lon, z)), None)
            if n_zona is None:
                continue
            zona = zone[n_zona]

            celle.append({
                "id": f"{codice_area}_{riga:03d}_{colonna:03d}",
                "area": codice_area,
                "zona": zona["nome"],
                "zona_id": f"{codice_area}_{n_zona + 1}",
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                # Confini della cella: [sud, ovest, nord, est]
                "bbox": [
                    round(c_sud, 5),
                    round(c_ovest, 5),
                    round(c_sud + passo_lat, 5),
                    round(c_ovest + passo_lon, 5),
                ],
            })
    return celle


def bbox_sottocella(bbox, k, n=SOTTOCELLE_PER_LATO):
    """Confini [sud, ovest, nord, est] della sottocella numero k (0 = in basso a
    sinistra, poi per righe da sud a nord)."""
    sud, ovest, nord, est = bbox
    riga, colonna = divmod(k, n)
    dlat = (nord - sud) / n
    dlon = (est - ovest) / n
    return [sud + riga * dlat, ovest + colonna * dlon,
            sud + (riga + 1) * dlat, ovest + (colonna + 1) * dlon]


def costruisci_griglia(percorso_aree):
    """Restituisce tutte le celle di tutte le aree."""
    config = carica_aree(percorso_aree)
    lato_km = config["lato_cella_km"]
    celle = []
    for codice, area in config["aree"].items():
        celle.extend(celle_di_un_area(codice, area, lato_km))
    return celle


if __name__ == "__main__":
    # Prova veloce: python -m fungometer.griglia
    from collections import Counter

    radice = Path(__file__).resolve().parent.parent
    celle = costruisci_griglia(radice / "config" / "aree.yaml")
    per_zona = Counter((c["area"], c["zona"]) for c in celle)
    for (area, zona), n in per_zona.items():
        print(f"{area:8s} {n:4d}  {zona}")
    print(f"Totale: {len(celle)} celle")
