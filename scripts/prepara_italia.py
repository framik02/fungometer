"""Prepara i dati fissi di tutta Italia, riquadro per riquadro.

Si lancia sul tuo PC, una volta sola (ci vogliono alcune ore la prima volta):

    python scripts/prepara_italia.py              # tutti i riquadri, riprende da dove era
    python scripts/prepara_italia.py i4250n1200   # solo alcuni riquadri
    python scripts/prepara_italia.py --pubblica   # rifà solo i file dell'app (dopo un cambio di specie.yaml)

Per ogni riquadro di mezzo grado (vedi fungometer/italia.py):
1. tiene solo le celle in Italia (confini ISTAT) e fuori dalle aree di
   Foligno e Roma, che hanno già i loro dati più fini;
2. calcola quota, forme del terreno e pendenza dal DEM Copernicus, come
   prepare_static.py;
3. scarica l'uso del suolo Corine del riquadro dal servizio EEA;
4. scarta le celle senza nessun ambiente adatto ad almeno una specie
   (città, campi, mare): lì il punteggio sarebbe sempre zero;
5. scrive i file dell'app: docs/data/italia/<riquadro>.json (celle e
   quadrati), docs/data/sottocelle/<riquadro>.json (schede), il disegno dei
   canaloni e, alla fine, l'elenco dei riquadri e dei gruppi meteo.

I risultati intermedi stanno in data/raw/italia/ (esclusa da git): se lo
script si interrompe, rilanciandolo salta i riquadri già fatti.
"""

import argparse
import base64
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import Point, Polygon, mapping

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))
sys.path.insert(0, str(RADICE / "scripts"))

from fungometer.griglia import SOTTOCELLE_PER_LATO  # noqa: E402
from fungometer.italia import CELLE_PER_GRUPPO, LATO_RIQUADRO, celle_riquadro, riquadri  # noqa: E402
from fungometer.punteggio import carica_specie  # noqa: E402
from fungometer.shp import leggi_poligoni  # noqa: E402
from aggiorna_punteggi import sottocelle_per_zona, statiche_leggere, statici_di_tutte  # noqa: E402
from prepare_static import (FORME, SOGLIA_ACQUA, forme_del_terreno, in_codice_corine,  # noqa: E402
                            leggi_nei_punti, mosaico_dem, percentuali, punti_delle_sottocelle,
                            salva_canaloni)
from scarica_corine import PER_PAGINA, PIXEL_GRADI, chiedi_pagina  # noqa: E402

CARTELLA_ISTAT = RADICE / "data" / "raw" / "istat" / "Limiti01012024_g"
RASTER_COMUNI = RADICE / "data" / "raw" / "istat" / "comuni.tif"
TABELLA_COMUNI = RADICE / "data" / "raw" / "istat" / "comuni.json"
CARTELLA_CORINE = RADICE / "data" / "raw" / "corine_italia"
CARTELLA_INTERMEDI = RADICE / "data" / "raw" / "italia"
CARTELLA_APP = RADICE / "docs" / "data" / "italia"
PIXEL_COMUNI = 0.0025   # gradi, circa 250 m: basta per sapere in che comune cade un punto
MARGINE = 0.02


# ---------------------------------------------------------------------------
# Comuni ISTAT: un raster con il codice del comune di ogni punto d'Italia
# ---------------------------------------------------------------------------

def _area_con_segno(anello):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(anello, anello[1:] + anello[:1])) / 2


def prepara_comuni():
    """Crea (una volta) il raster dei comuni e la tabella codice -> nome, sigla, regione."""
    if RASTER_COMUNI.exists() and TABELLA_COMUNI.exists():
        return
    print("Raster dei comuni ISTAT...")
    utm = Transformer.from_crs("EPSG:32632", "EPSG:4326", always_xy=True)
    regioni = {r["COD_REG"]: r["DEN_REG"] for r, _ in leggi_poligoni(
        CARTELLA_ISTAT / "Reg01012024_g" / "Reg01012024_g_WGS84")}
    sigle = {r["COD_UTS"]: r["SIGLA"] for r, _ in leggi_poligoni(
        CARTELLA_ISTAT / "ProvCM01012024_g" / "ProvCM01012024_g_WGS84")}
    tabella, forme = {}, []
    for attr, anelli in leggi_poligoni(CARTELLA_ISTAT / "Com01012024_g" / "Com01012024_g_WGS84"):
        codice = int(attr["PRO_COM"])
        tabella[codice] = [attr["COMUNE"], sigle.get(attr["COD_UTS"], ""), regioni.get(attr["COD_REG"], "")]
        anelli_ll = []
        for anello in anelli:
            xs, ys = utm.transform([p[0] for p in anello], [p[1] for p in anello])
            anelli_ll.append(list(zip(xs, ys)))
        # Negli shapefile i contorni esterni girano in senso orario (area negativa), i buchi al contrario
        esterni = [a for a in anelli_ll if _area_con_segno(a) < 0] or anelli_ll[:1]
        buchi = [a for a in anelli_ll if _area_con_segno(a) >= 0 and a not in esterni]
        for esterno in esterni:
            poligono = Polygon(esterno)
            suoi = [b for b in buchi if poligono.contains(Point(b[0]))]
            forme.append((mapping(Polygon(esterno, suoi)), codice))
    larghezza = int(np.ceil((18.6 - 6.5) / PIXEL_COMUNI))
    altezza = int(np.ceil((47.2 - 35.4) / PIXEL_COMUNI))
    trasformazione = from_origin(6.5, 47.2, PIXEL_COMUNI, PIXEL_COMUNI)
    raster = rasterize(forme, out_shape=(altezza, larghezza), transform=trasformazione, fill=0, dtype="int32")
    with rasterio.open(RASTER_COMUNI, "w", driver="GTiff", height=altezza, width=larghezza, count=1,
                       dtype="int32", crs="EPSG:4326", transform=trasformazione, compress="deflate") as f:
        f.write(raster, 1)
    TABELLA_COMUNI.write_text(json.dumps(tabella, ensure_ascii=False), encoding="utf-8")
    print(f"  {len(tabella)} comuni")


# ---------------------------------------------------------------------------
# Corine del riquadro
# ---------------------------------------------------------------------------

def corine_riquadro(codice, ovest, sud, est, nord):
    """Raster Corine (codici a tre cifre) del riquadro, scaricato una volta sola."""
    percorso = CARTELLA_CORINE / f"{codice}.tif"
    if not percorso.exists():
        CARTELLA_CORINE.mkdir(parents=True, exist_ok=True)
        poligoni, offset = [], 0
        while True:
            pagina = chiedi_pagina((ovest, sud, est, nord), offset)
            poligoni.extend(pagina)
            if len(pagina) < PER_PAGINA:
                break
            offset += PER_PAGINA
        larghezza = int(np.ceil((est - ovest) / PIXEL_GRADI))
        altezza = int(np.ceil((nord - sud) / PIXEL_GRADI))
        trasformazione = from_origin(ovest, nord, PIXEL_GRADI, PIXEL_GRADI)
        forme = ((p["geometry"], int(p["properties"]["Code_18"])) for p in poligoni if p.get("geometry"))
        raster = rasterize(forme, out_shape=(altezza, larghezza), transform=trasformazione,
                           fill=0, dtype="uint16")
        with rasterio.open(percorso, "w", driver="GTiff", height=altezza, width=larghezza, count=1,
                           dtype="uint16", crs="EPSG:4326", transform=trasformazione, nodata=0,
                           compress="deflate") as f:
            f.write(raster, 1)
    with rasterio.open(percorso) as f:
        return f.read(1), f.transform


# ---------------------------------------------------------------------------
# Un riquadro
# ---------------------------------------------------------------------------

def celle_gia_coperte():
    """Rettangoli delle celle di Foligno e Roma: lì l'Italia non aggiunge celle."""
    with open(RADICE / "data" / "celle.json", encoding="utf-8") as f:
        return np.array([c["bbox"] for c in json.load(f)])


def prepara_riquadro(codice, sud, ovest, comuni, coperte, config):
    """Calcola i dati fissi di un riquadro. Restituisce il dizionario intermedio
    (eventualmente con zero celle, per ricordare che il riquadro è vuoto)."""
    nord, est = sud + LATO_RIQUADRO, ovest + LATO_RIQUADRO
    raster_comuni, tr_comuni, tabella = comuni

    celle = celle_riquadro(codice, sud, ovest)
    # Fuori dalle celle di Foligno e Roma
    if len(coperte):
        celle = [c for c in celle if not np.any(
            (coperte[:, 0] <= c["lat"]) & (c["lat"] <= coperte[:, 2])
            & (coperte[:, 1] <= c["lon"]) & (c["lon"] <= coperte[:, 3]))]
    if not celle:
        return {"celle": [], "sottocelle": {}}
    punti = [punti_delle_sottocelle(c) for c in celle]
    lats = np.stack([p[0] for p in punti])
    lons = np.stack([p[1] for p in punti])
    comune = leggi_nei_punti(raster_comuni, tr_comuni, lats, lons)
    dentro = (comune > 0).reshape(len(celle), -1).any(axis=1)
    if not dentro.any():
        return {"celle": [], "sottocelle": {}}
    celle = [c for c, d in zip(celle, dentro) if d]
    lats, lons, comune = lats[dentro], lons[dentro], comune[dentro]

    quote_dem, tr = mosaico_dem(ovest - MARGINE, sud - MARGINE, est + MARGINE, nord + MARGINE)
    forma, pendenza = forme_del_terreno(quote_dem, tr)
    quote = leggi_nei_punti(quote_dem, tr, lats, lons, vuoto=np.nan)
    forme = leggi_nei_punti(forma, tr, lats, lons)
    pendenze = leggi_nei_punti(pendenza, tr, lats, lons, vuoto=np.nan)
    canaloni = salva_canaloni(forma, tr, [{"ovest": ovest, "sud": sud, "est": est, "nord": nord}],
                              codice, RADICE / "docs" / "data" / "canaloni")
    del quote_dem, forma, pendenza

    raster_corine, tr_corine = corine_riquadro(codice, ovest - MARGINE, sud - MARGINE,
                                               est + MARGINE, nord + MARGINE)
    corine = in_codice_corine(leggi_nei_punti(raster_corine, tr_corine, lats, lons))
    etichette = np.char.add("c", corine.astype(str))
    # Acqua, mare e punti fuori dall'Italia non contano
    acqua = (corine >= 500) | (corine == 0) | (comune == 0)

    codici_specie = list(config["specie"])
    tenute, sottocelle = [], {}
    for i, cella in enumerate(celle):
        elenco = []
        for k in range(SOTTOCELLE_PER_LATO ** 2):
            q = quote[i, k]
            if np.mean(acqua[i, k]) >= SOGLIA_ACQUA or np.all(np.isnan(q)):
                elenco.append(None)
                continue
            forme_valide = forme[i, k][forme[i, k] > 0]
            terra = ~acqua[i, k]
            elenco.append({
                "q": [int(round(v)) for v in np.nanpercentile(q, [10, 50, 90])],
                "h": percentuali(etichette[i, k][terra]) if terra.any() else {},
                "m": {FORME[int(c)]: v for c, v in percentuali(forme_valide).items()} if forme_valide.size else {},
                "p": int(round(float(np.nanmean(pendenze[i, k])))),
            })
        if all(s is None for s in elenco):
            continue
        # Serve almeno un quadrato adatto ad almeno una specie
        statici = statici_di_tutte({cella["id"]: elenco}, config)[cella["id"]]
        if not any(st and any(st[c]["habitat"] * st[c]["quota"] > 0 for c in codici_specie) for st in statici):
            continue
        terra_cella = ~acqua[i] & ~np.isnan(quote[i])
        q_cella = quote[i][terra_cella]
        cella["quota"] = {"media": int(round(float(q_cella.mean()))), "min": int(round(float(q_cella.min()))),
                          "max": int(round(float(q_cella.max())))}
        cella["uso"] = percentuali(etichette[i][terra_cella])
        codice_comune = Counter(comune[i][comune[i] > 0].tolist()).most_common(1)[0][0]
        nome, sigla, regione = tabella[str(codice_comune)]
        cella["zona"] = f"{nome} ({sigla})" if sigla else nome
        cella["regione"] = regione
        tenute.append(cella)
        sottocelle[cella["id"]] = elenco
    if not tenute:   # niente celle: il disegno dei canaloni non serve
        for zona_id in canaloni:
            (RADICE / "docs" / "data" / "canaloni" / f"{zona_id}.png").unlink(missing_ok=True)
    return {"celle": tenute, "sottocelle": sottocelle, "canaloni": canaloni if tenute else {}}


# ---------------------------------------------------------------------------
# File dell'app
# ---------------------------------------------------------------------------

def pubblica_riquadro(codice, dati, config):
    """Scrive i file dell'app di un riquadro dai dati intermedi."""
    celle, sottocelle = dati["celle"], dati["sottocelle"]
    statici = statici_di_tutte(sottocelle, config)
    statiche = statiche_leggere(celle, statici, config)
    CARTELLA_APP.mkdir(parents=True, exist_ok=True)
    uscita = {
        "celle": [{"id": c["id"], "zona": c["zona"], "regione": c["regione"], "bbox": c["bbox"],
                   "quota": c["quota"], "uso": c["uso"], "gruppo": c["gruppo"]} for c in celle],
        # 36 x (specie + 1) numeri per cella, come in statiche.json, in base64 (un byte per numero)
        "statiche": {i: base64.b64encode(bytes(v)).decode("ascii") for i, v in statiche.items()},
    }
    (CARTELLA_APP / f"{codice}.json").write_text(json.dumps(uscita, ensure_ascii=False, separators=(",", ":")),
                                                 encoding="utf-8")
    for c in celle:
        c["zona_id"] = codice
    schede = sottocelle_per_zona(celle, sottocelle, statici, config).get(codice, {})
    (RADICE / "docs" / "data" / "sottocelle" / f"{codice}.json").write_text(
        json.dumps(schede, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def scrivi_indici(config):
    """Elenco dei riquadri (per l'app), dei gruppi meteo (per l'aggiornamento) e dei canaloni."""
    indice, gruppi, canaloni = {}, {}, {}
    for percorso in sorted(CARTELLA_INTERMEDI.glob("*.json")):
        dati = json.loads(percorso.read_text(encoding="utf-8"))
        if not dati["celle"]:
            continue
        codice = percorso.stem
        sud, ovest = int(codice[1:5]) / 100, int(codice[6:10]) / 100
        indice[codice] = [sud, ovest, sud + LATO_RIQUADRO, ovest + LATO_RIQUADRO, len(dati["celle"])]
        canaloni.update(dati.get("canaloni", {}))
        per_gruppo = {}
        for c in dati["celle"]:
            per_gruppo.setdefault(c["gruppo"], []).append(c)
        for gid, celle in per_gruppo.items():
            gruppi[gid] = {
                "lat": round(sum(c["lat"] for c in celle) / len(celle), 4),
                "lon": round(sum(c["lon"] for c in celle) / len(celle), 4),
                # Quota del punto meteo: la media delle celle del gruppo. L'app
                # corregge la temperatura di ogni cella rispetto a questa.
                "quota": round(sum(c["quota"]["media"] for c in celle) / len(celle)),
                "riquadro": codice,
                "celle": len(celle),
            }
    (CARTELLA_APP / "indice.json").write_text(json.dumps(indice, separators=(",", ":")), encoding="utf-8")
    (RADICE / "data" / "italia_gruppi.json").write_text(json.dumps(gruppi, indent=0), encoding="utf-8")
    percorso_canaloni = RADICE / "docs" / "data" / "canaloni" / "indice.json"
    tutti = json.loads(percorso_canaloni.read_text(encoding="utf-8"))
    tutti = {k: v for k, v in tutti.items() if not k.startswith("i")}
    tutti.update(canaloni)
    percorso_canaloni.write_text(json.dumps(tutti), encoding="utf-8")
    n_celle = sum(v[4] for v in indice.values())
    print(f"Riquadri con celle: {len(indice)}, celle: {n_celle}, gruppi meteo: {len(gruppi)}")


def scrivi_habitat():
    """docs/data/italia/habitat.json: per ogni cella da 3 km e ogni specie, quanto è
    adatto il suo quadrato migliore (habitat x quota x terreno, da 0 a 100).

    Non cambia di giorno in giorno: l'app lo scarica una volta e lo usa per dare
    al quadro d'insieme la forma dei boschi (il colore del meteo da 15 km si
    moltiplica per questo valore). Comprende anche le celle di Foligno e Roma,
    rimesse sulla griglia d'Italia.

    Formato: {"specie": S, "riquadri": {riquadro: base64 di record da 2 + S byte}},
    dove ogni record è il numero della cella nel riquadro (riga x colonne +
    colonna, due byte little-endian) seguito da S valori.
    """
    import math
    from fungometer.italia import OVEST, SUD, codice_riquadro, passi_riquadro
    per_riquadro = {}

    def metti(codice, numero, valori):
        voce = per_riquadro.setdefault(codice, {})
        voce[numero] = np.maximum(voce.get(numero, valori), valori)

    def migliori(byte, S):
        st = np.frombuffer(byte, dtype=np.uint8).reshape(36, S + 1).astype(float)
        validi = st[:, 0] != 255
        if not validi.any():
            return np.zeros(S, dtype=np.uint8)
        st = st[validi]
        return np.round((st[:, :S] * st[:, S:S + 1] / 100).max(axis=0)).astype(np.uint8)

    S = None
    for percorso in sorted(CARTELLA_APP.glob("i[0-9]*n[0-9]*.json")):
        dati = json.loads(percorso.read_text(encoding="utf-8"))
        codice = percorso.stem
        _, colonne = passi_riquadro(int(codice[1:5]) / 100)
        for cella in dati["celle"]:
            byte = base64.b64decode(dati["statiche"][cella["id"]])
            S = len(byte) // 36 - 1
            r, c = map(int, cella["id"].split("_")[1:])
            metti(codice, r * colonne + c, migliori(byte, S))

    # Foligno e Roma, rimesse nella cella d'Italia che contiene il loro centro
    statiche = json.loads((RADICE / "docs" / "data" / "statiche.json").read_text(encoding="utf-8"))
    for cella in json.loads((RADICE / "data" / "celle.json").read_text(encoding="utf-8")):
        lat, lon = cella["lat"], cella["lon"]
        sud = round(SUD + math.floor((lat - SUD) / LATO_RIQUADRO) * LATO_RIQUADRO, 4)
        ovest = round(OVEST + math.floor((lon - OVEST) / LATO_RIQUADRO) * LATO_RIQUADRO, 4)
        righe, colonne = passi_riquadro(sud)
        r = int((lat - sud) / (LATO_RIQUADRO / righe))
        c = int((lon - ovest) / (LATO_RIQUADRO / colonne))
        metti(codice_riquadro(sud, ovest), r * colonne + c, migliori(bytes(statiche[cella["id"]]), S))

    uscita = {"specie": S, "riquadri": {}}
    for codice, celle in sorted(per_riquadro.items()):
        record = b"".join(int(n).to_bytes(2, "little") + v.tobytes() for n, v in sorted(celle.items()))
        uscita["riquadri"][codice] = base64.b64encode(record).decode("ascii")
    percorso = CARTELLA_APP / "habitat.json"
    percorso.write_text(json.dumps(uscita, separators=(",", ":")), encoding="utf-8")
    n = sum(len(c) for c in per_riquadro.values())
    print(f"Scritto {percorso.relative_to(RADICE)}: {n} celle ({percorso.stat().st_size / 1024:.0f} KB)")


def main():
    parser = argparse.ArgumentParser(description="Dati fissi di tutta Italia")
    parser.add_argument("riquadri", nargs="*", help="solo questi riquadri (es. i4250n1200)")
    parser.add_argument("--pubblica", action="store_true", help="rifà solo i file dell'app")
    parser.add_argument("--habitat", action="store_true", help="rifà solo habitat.json")
    args = parser.parse_args()

    config = carica_specie(RADICE / "config" / "specie.yaml")
    CARTELLA_INTERMEDI.mkdir(parents=True, exist_ok=True)
    if args.habitat:
        scrivi_habitat()
        return
    elenco = [r for r in riquadri() if not args.riquadri or r[0] in args.riquadri]

    if not args.pubblica:
        prepara_comuni()
        with rasterio.open(RASTER_COMUNI) as f:
            comuni = (f.read(1), f.transform, json.loads(TABELLA_COMUNI.read_text(encoding="utf-8")))
        coperte = celle_gia_coperte()
        for n, (codice, sud, ovest) in enumerate(elenco, start=1):
            percorso = CARTELLA_INTERMEDI / f"{codice}.json"
            if percorso.exists() and not args.riquadri:
                continue
            dati = prepara_riquadro(codice, sud, ovest, comuni, coperte, config)
            percorso.write_text(json.dumps(dati, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            if dati["celle"]:
                pubblica_riquadro(codice, dati, config)
            print(f"[{n}/{len(elenco)}] {codice}: {len(dati['celle'])} celle", flush=True)
    else:
        for codice, _, _ in elenco:
            percorso = CARTELLA_INTERMEDI / f"{codice}.json"
            if percorso.exists():
                dati = json.loads(percorso.read_text(encoding="utf-8"))
                if dati["celle"]:
                    pubblica_riquadro(codice, dati, config)
    scrivi_indici(config)
    scrivi_habitat()


if __name__ == "__main__":
    main()
