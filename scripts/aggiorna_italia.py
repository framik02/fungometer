"""La parte di tutta Italia dell'aggiornamento del mattino.

La chiama scripts/aggiorna_punteggi.py dopo Foligno e Roma. Fa tre cose:

1. scarica il meteo dei gruppi da circa 15 km (data/italia_gruppi.json,
   scritto da prepara_italia.py), con pause lunghe per stare sotto le
   5.000 chiamate all'ora di Open-Meteo;
2. per ogni riquadro scrive docs/data/italia/meteo/<riquadro>.json con il
   riassunto di ogni gruppo per gli 8 giorni (pioggia, suolo, caldo,
   temperatura, minime della settimana prima): l'app ne ricava i fattori di
   ogni cella correggendo la temperatura con la quota (fungometer/italia.py);
3. scrive docs/data/italia/panoramica.json, il quadro di tutta Italia per la
   mappa vista da lontano: per ogni gruppo e specie, il punteggio del
   quadrato migliore e l'acqua, giorno per giorno.

Formato di meteo/<riquadro>.json:
{ "id gruppo": {"q": quota del punto meteo,
                "p": [8], "u": [8], "k": [8], "tr": [8], "c": [8], "tn": [8], "tx": [8],
                "gm": [14 minime: dai 6 giorni prima del primo giorno all'ultimo]} }

Formato di panoramica.json:
{ "gruppi": [[sud, ovest, nord, est], ...],
  "nomi": ["Orvieto (TR)", ...],
  "p": base64 di gruppi x specie x giorni byte (punteggio del quadrato migliore, 0-100),
  "a": base64 come sopra (fattore acqua migliore, 0-100) }
"""

import base64
import json
import math
from collections import Counter
from datetime import date
from pathlib import Path

import numpy as np

from fungometer.italia import (CELLE_PER_GRUPPO, GIORNI_GELO, LATO_RIQUADRO, OVEST, SUD, codice_riquadro,
                               fattori_cella_italia, passi_riquadro, riassunto_gruppo)
from fungometer.meteo import scarica_meteo

RADICE = Path(__file__).resolve().parent.parent
CARTELLA = RADICE / "docs" / "data" / "italia"
VUOTO = 255


def _cento(x):
    return round(100 * x)


def _arrotonda(v, cifre):
    return None if v is None else round(v, cifre)


def gruppo_di_un_punto(lat, lon):
    """Il gruppo d'Italia che contiene un punto, con i suoi confini."""
    sud = SUD + math.floor((lat - SUD) / LATO_RIQUADRO) * LATO_RIQUADRO
    ovest = OVEST + math.floor((lon - OVEST) / LATO_RIQUADRO) * LATO_RIQUADRO
    sud, ovest = round(sud, 4), round(ovest, 4)
    codice = codice_riquadro(sud, ovest)
    righe, colonne = passi_riquadro(sud)
    passo_lat, passo_lon = LATO_RIQUADRO / righe, LATO_RIQUADRO / colonne
    gr = int((lat - sud) / passo_lat) // CELLE_PER_GRUPPO
    gc = int((lon - ovest) / passo_lon) // CELLE_PER_GRUPPO
    confini = [sud + gr * CELLE_PER_GRUPPO * passo_lat, ovest + gc * CELLE_PER_GRUPPO * passo_lon,
               min(sud + LATO_RIQUADRO, sud + (gr + 1) * CELLE_PER_GRUPPO * passo_lat),
               min(ovest + LATO_RIQUADRO, ovest + (gc + 1) * CELLE_PER_GRUPPO * passo_lon)]
    return f"{codice}_g{gr}_{gc}", [round(x, 5) for x in confini]


def migliore_dei_quadrati(statiche, fa, ft, fs, effetto):
    """Punteggio del quadrato migliore per specie e giorno.

    statiche: array (36, specie + 1) con 255 sull'acqua; fa, ft, fs: (specie, giorni) da 0 a 1.
    """
    validi = statiche[:, 0] != VUOTO
    if not validi.any():
        return np.zeros(fa.shape)
    st = statiche[validi].astype(float) / 100
    hq = st[:, :-1][:, :, None]                  # (quadrati, specie, 1)
    terreno = st[:, -1][:, None, None]           # (quadrati, 1, 1)
    terreno_eff = 1 - (1 - terreno) * (1 - effetto * fa[None])
    punteggi = 100 * fa[None] * ft[None] * fs[None] * hq * terreno_eff
    return punteggi.max(axis=0)


def aggiorna_italia(config, date_meteo_vecchie, giorni, dati_esistenti, celle_esistenti, statiche_esistenti):
    """Meteo dei gruppi, file per riquadro e panoramica. Restituisce il numero di gruppi."""
    percorso_gruppi = RADICE / "data" / "italia_gruppi.json"
    if not percorso_gruppi.exists():
        print("Niente data/italia_gruppi.json: salto l'Italia.")
        return 0
    gruppi = json.loads(percorso_gruppi.read_text(encoding="utf-8"))
    comune, specie = config["comune"], config["specie"]
    codici = list(specie)
    effetto = comune["terreno"]["effetto_se_bagnato"]

    punti = [{"id": gid, "lat": g["lat"], "lon": g["lon"], "quota": {"media": g["quota"]}}
             for gid, g in gruppi.items()]
    print(f"Scarico il meteo di {len(punti)} gruppi d'Italia...")
    date_meteo, meteo = scarica_meteo(punti, past_days=26, forecast_days=len(giorni))
    indici = [date_meteo.index(g) for g in giorni]
    date_giorni = [date.fromisoformat(g) for g in giorni]

    # 1. riassunto dei gruppi, un file per riquadro
    riassunti, per_riquadro = {}, {}
    for gid, g in gruppi.items():
        m = meteo[gid]
        righe = [riassunto_gruppo(m, i, comune) for i in indici]
        primo = indici[0] - (GIORNI_GELO - 1)
        voce = {
            "q": g["quota"],
            "p": [round(r["p"]) for r in righe],
            "u": [_arrotonda(r["u"], 3) for r in righe],
            "k": [r["k"] for r in righe],
            "tr": [_arrotonda(r["tr"], 1) for r in righe],
            "c": [r["c"] for r in righe],
            "tn": [_arrotonda(r["tn"], 1) for r in righe],
            "tx": [_arrotonda(r["tx"], 1) for r in righe],
            "gm": [_arrotonda(m["tmin"][j], 1) if 0 <= j < len(date_meteo) else None
                   for j in range(primo, indici[-1] + 1)],
        }
        riassunti[gid] = (righe, voce)
        per_riquadro.setdefault(g["riquadro"], {})[gid] = voce
    (CARTELLA / "meteo").mkdir(parents=True, exist_ok=True)
    for riquadro, contenuto in per_riquadro.items():
        (CARTELLA / "meteo" / f"{riquadro}.json").write_text(
            json.dumps(contenuto, separators=(",", ":")), encoding="utf-8")

    # 2. panoramica: il quadrato migliore di ogni gruppo, specie per specie
    costruisci_panoramica(config, giorni, dati_esistenti, celle_esistenti, statiche_esistenti)
    return len(gruppi)


def costruisci_panoramica(config, giorni, dati_esistenti, celle_esistenti, statiche_esistenti):
    """Il quadro d'insieme, dai file meteo/<riquadro>.json già scritti.

    Usa gli stessi numeri arrotondati che legge l'app: così da lontano e da
    vicino i conti tornano. Si può rifare senza riscaricare il meteo.
    """
    comune, specie = config["comune"], config["specie"]
    codici = list(specie)
    effetto = comune["terreno"]["effetto_se_bagnato"]
    date_giorni = [date.fromisoformat(g) for g in giorni]
    per_riquadro = {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted((CARTELLA / "meteo").glob("*.json"))}
    migliori, acqua, confini, nomi = {}, {}, {}, {}
    n_s, n_g = len(codici), len(giorni)

    def accumula(gid, bbox, punteggi, fa, nome):
        if gid not in migliori:
            migliori[gid] = np.zeros((n_s, n_g))
            acqua[gid] = np.zeros((n_s, n_g))
            confini[gid] = bbox
            nomi[gid] = Counter()
        nomi[gid][nome] += 1
        migliori[gid] = np.maximum(migliori[gid], punteggi)
        acqua[gid] = np.maximum(acqua[gid], fa)

    for riquadro in sorted(per_riquadro):
        dati = json.loads((CARTELLA / f"{riquadro}.json").read_text(encoding="utf-8"))
        for cella in dati["celle"]:
            voce = per_riquadro[riquadro][cella["gruppo"]]
            righe = [{k: voce[k][d] for k in ("p", "u", "k", "tr", "c")} for d in range(len(giorni))]
            fa, ft, fs = np.zeros((n_s, n_g)), np.zeros((n_s, n_g)), np.zeros((n_s, n_g))
            for s, cod in enumerate(codici):
                for d, (r, giorno) in enumerate(zip(righe, date_giorni)):
                    f = fattori_cella_italia(r, voce["gm"][d:d + GIORNI_GELO], cella["quota"]["media"],
                                             voce["q"], giorno, specie[cod], comune)
                    fa[s, d], ft[s, d], fs[s, d] = f["acqua"], f["temperatura"], f["stagione"]
            st = np.frombuffer(base64.b64decode(dati["statiche"][cella["id"]]), dtype=np.uint8)
            st = st.reshape(36, n_s + 1)
            _, bbox = gruppo_di_un_punto(*_centro(cella["bbox"]))
            accumula(cella["gruppo"], bbox, migliore_dei_quadrati(st, fa, ft, fs, effetto), fa, cella["zona"])

    # Le celle di Foligno e Roma entrano nel gruppo d'Italia che le contiene
    for cella in celle_esistenti:
        voce = dati_esistenti[cella["id"]]
        fa = np.array([v["fa"] for v in voce["s"]], dtype=float) / 100
        ft = np.array([v["ft"] for v in voce["s"]], dtype=float) / 100
        fs = np.array([v["fs"] for v in voce["s"]], dtype=float) / 100
        st = np.array(statiche_esistenti[cella["id"]], dtype=np.uint16).reshape(36, n_s + 1)
        gid, bbox = gruppo_di_un_punto(*_centro(cella["bbox"]))
        accumula(gid, bbox, migliore_dei_quadrati(st, fa, ft, fs, effetto), fa, cella["zona"])

    ordine = sorted(migliori)
    p = np.stack([migliori[g] for g in ordine]).round().clip(0, 100).astype(np.uint8)
    a = (np.stack([acqua[g] for g in ordine]) * 100).round().clip(0, 100).astype(np.uint8)
    panoramica = {
        "ids": ordine,
        "gruppi": [confini[g] for g in ordine],
        # Il comune (o la zona) che compare più spesso fra le celle del gruppo
        "nomi": [nomi[g].most_common(1)[0][0] for g in ordine],
        "p": base64.b64encode(p.tobytes()).decode("ascii"),
        "a": base64.b64encode(a.tobytes()).decode("ascii"),
    }
    (CARTELLA / "panoramica.json").write_text(json.dumps(panoramica, separators=(",", ":")), encoding="utf-8")
    kb = (CARTELLA / "panoramica.json").stat().st_size / 1024
    print(f"Scritti il meteo di {len(per_riquadro)} riquadri e la panoramica ({len(ordine)} gruppi, {kb:.0f} KB)")


def _centro(bbox):
    return (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
