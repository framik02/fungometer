"""Scarica i confini delle aree protette delle nostre aree, per la mappa.

Due fonti pubbliche dell'Agenzia europea dell'ambiente (EEA), senza login:
- aree protette nazionali e regionali (parchi, riserve; dataset NatDA v24,
  con il codice ufficiale italiano EUAP);
- siti della rete Natura 2000 (ZSC, SIC, ZPS).

I confini vengono semplificati (precisione di circa 50 m, basta per la mappa)
e salvati in docs/data/aree_protette.json (GeoJSON). L'app li mostra come
strato e dice, nella scheda di ogni quadrato, se cade in un'area protetta.

Nelle aree protette la raccolta dei funghi ha spesso regole proprie (divieti,
giorni, quantità): l'app mostra i confini e rimanda alle regole, che vanno
sempre verificate sul sito dell'ente.

Uso:
    python scripts/scarica_aree_protette.py            # Foligno e Roma: docs/data/aree_protette.json
    python scripts/scarica_aree_protette.py --italia   # un file per riquadro d'Italia:
                                                       # docs/data/aree_protette/<riquadro>.json
Con --italia lavora sui riquadri di docs/data/italia/indice.json (scritto da
prepara_italia.py) e salta quelli già scaricati.
"""

import json
import sys
import time
from pathlib import Path

import requests
from shapely.geometry import box, mapping, shape

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.griglia import carica_aree  # noqa: E402

BASE = "https://bio.discomap.eea.europa.eu/arcgis/rest/services/ProtectedSites"
FONTI = [
    # (servizio e livello, tipo mostrato nell'app, campo nome, campo codice)
    ("NatDAv24_Dyna_WM/MapServer/4", "parco", "siteName", "nationalId"),
    ("Natura2000Sites/MapServer/2", "natura2000", "SITENAME", "SITECODE"),
]
SEMPLIFICA_GRADI = 0.0005   # circa 50 m
MARGINE = 0.03


def richiesta(url, dati, tentativi=4):
    for tentativo in range(1, tentativi + 1):
        try:
            risposta = requests.post(url, data=dati, timeout=180)
            risposta.raise_for_status()
            contenuto = risposta.json()
            if "error" in contenuto:
                raise ValueError(contenuto["error"])
            return contenuto
        except (requests.RequestException, ValueError) as errore:
            print(f"  tentativo {tentativo} fallito ({errore})")
            time.sleep(10 * tentativo)
    raise RuntimeError(f"Il servizio {url} non risponde")


def scarica(livello, rettangolo):
    """Tutti i poligoni del livello che toccano il rettangolo, in GeoJSON (lat/lon)."""
    ovest, sud, est, nord = rettangolo
    elementi, inizio = [], 0
    while True:
        pagina = richiesta(f"{BASE}/{livello}/query", {
            "geometry": f"{ovest},{sud},{est},{nord}", "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects",
            "where": "1=1", "outFields": "*", "returnGeometry": "true",
            "resultOffset": inizio, "resultRecordCount": 200, "f": "geojson",
        })
        nuovi = pagina.get("features", [])
        elementi.extend(nuovi)
        if len(nuovi) < 200:
            return elementi
        inizio += 200


def nome_pulito(nome):
    """Sistema i nomi scritti in maiuscolo o abbreviati (es. "P N DEI MONTI SIBILLINI")."""
    # Nei dati originali alcune lettere accentate arrivano rovinate: in italiano
    # sono quasi sempre "à" (es. "sommit�" -> "sommità")
    nome = " ".join(str(nome or "").replace("�", "à").replace(" ", " ").split())
    if nome.startswith("P N "):
        nome = "Parco nazionale " + nome[4:]
    if nome.isupper():
        piccole = {"di", "del", "della", "dei", "delle", "degli", "e", "da", "in", "la", "le"}
        parole = nome.lower().split()
        nome = " ".join(w if (i > 0 and w in piccole) else w[:1].upper() + w[1:] for i, w in enumerate(parole))
    return nome


def elementi_ritagliati(rettangolo, chiave_extra, visti=None):
    """Poligoni delle due fonti che toccano il rettangolo, ritagliati e semplificati."""
    visti = set() if visti is None else visti
    ritaglio = box(*rettangolo)
    risultato = []
    for livello, tipo, campo_nome, campo_codice in FONTI:
        for el in scarica(livello, rettangolo):
            p = el["properties"]
            codice = str(p.get(campo_codice) or "")
            chiave = (tipo, codice, chiave_extra)
            if not el.get("geometry") or chiave in visti:
                continue
            visti.add(chiave)
            forma = shape(el["geometry"]).buffer(0).intersection(ritaglio)
            forma = forma.simplify(SEMPLIFICA_GRADI, preserve_topology=True)
            if forma.is_empty:
                continue
            risultato.append({
                "type": "Feature",
                "properties": {"tipo": tipo, "nome": nome_pulito(p.get(campo_nome)), "codice": codice},
                "geometry": json.loads(json.dumps(mapping(forma)), parse_float=lambda x: round(float(x), 5)),
            })
    return risultato


def main_italia():
    """Un file per riquadro, ritagliato sul riquadro: l'app scarica solo quelli che servono."""
    indice = json.loads((RADICE / "docs" / "data" / "italia" / "indice.json").read_text(encoding="utf-8"))
    cartella = RADICE / "docs" / "data" / "aree_protette"
    cartella.mkdir(parents=True, exist_ok=True)
    for n, (codice, (sud, ovest, nord, est, _)) in enumerate(sorted(indice.items()), start=1):
        uscita = cartella / f"{codice}.json"
        if uscita.exists():
            continue
        risultato = elementi_ritagliati((ovest, sud, est, nord), codice)
        uscita.write_text(json.dumps({"type": "FeatureCollection", "features": risultato}, ensure_ascii=False,
                                     separators=(",", ":")), encoding="utf-8")
        print(f"[{n}/{len(indice)}] {codice}: {len(risultato)} aree ({uscita.stat().st_size / 1024:.0f} KB)", flush=True)


def main():
    if "--italia" in sys.argv:
        main_italia()
        return
    config = carica_aree(RADICE / "config" / "aree.yaml")
    risultato, visti = [], set()
    for codice_area, area in config["aree"].items():
        zone = area["zone"]
        rettangolo = (min(z["ovest"] for z in zone) - MARGINE, min(z["sud"] for z in zone) - MARGINE,
                      max(z["est"] for z in zone) + MARGINE, max(z["nord"] for z in zone) + MARGINE)
        ritaglio = box(*rettangolo)
        for livello, tipo, campo_nome, campo_codice in FONTI:
            elementi = scarica(livello, rettangolo)
            print(f"{codice_area}, {tipo}: {len(elementi)} poligoni")
            for el in elementi:
                p = el["properties"]
                codice = str(p.get(campo_codice) or "")
                chiave = (tipo, codice, codice_area)
                if not el.get("geometry") or chiave in visti:
                    continue
                visti.add(chiave)
                forma = shape(el["geometry"]).buffer(0).intersection(ritaglio)
                forma = forma.simplify(SEMPLIFICA_GRADI, preserve_topology=True)
                if forma.is_empty:
                    continue
                risultato.append({
                    "type": "Feature",
                    "properties": {"tipo": tipo, "nome": nome_pulito(p.get(campo_nome)), "codice": codice},
                    # coordinate arrotondate a 5 decimali (circa 1 m): file più piccolo
                    "geometry": json.loads(json.dumps(mapping(forma)), parse_float=lambda x: round(float(x), 5)),
                })

    uscita = RADICE / "docs" / "data" / "aree_protette.json"
    with open(uscita, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": risultato}, f, ensure_ascii=False, separators=(",", ":"))
    parchi = sum(1 for r in risultato if r["properties"]["tipo"] == "parco")
    print(f"Scritto {uscita.relative_to(RADICE)}: {parchi} parchi e riserve, "
          f"{len(risultato) - parchi} siti Natura 2000 ({uscita.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
