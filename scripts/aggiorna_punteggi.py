"""Calcola i punteggi di oggi e dei prossimi 7 giorni e li salva per l'app.

    python scripts/aggiorna_punteggi.py                  (lavora subito)
    python scripts/aggiorna_punteggi.py --controlla-ora  (come il cron: solo dopo le 6, una volta al giorno)

Legge:  data/celle.json (da prepare_static.py) e config/specie.yaml
Scrive: docs/data/punteggi.json  (punteggi e meteo, cambia ogni giorno)
        docs/data/celle.json     (forma e dati fissi delle celle, per la mappa)

Formato di punteggi.json (scritto compatto per restare sotto 1 MB):
{
  "aggiornato": "2026-09-27T06:03:12+02:00",
  "giorni": ["2026-09-27", ... 8 date],
  "specie": [{"id": "porcini_estivi", "nome": ..., "stagione": [8 fattori 0-100]}, ...],
  "celle": {
    "foligno_000_010": {
      "p":  [8 x pioggia degli ultimi 14 giorni, mm],
      "tn": [8 x temperatura minima del giorno], "tx": [8 x massima],
      "tr": [8 x temperatura di riferimento, media degli ultimi 7 giorni],
      "u":  [8 x umidità del suolo, m3/m3],
      "s":  [una voce per specie, nello stesso ordine di "specie":
             null se habitat o quota valgono 0 (punteggio sempre 0), altrimenti
             {"S": [8 punteggi], "fp": [8], "ft": [8], "fh": habitat, "fq": quota}]
    }
  }
}
Tutti i fattori sono interi da 0 a 100 (cioè il fattore x 100).
"""

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.meteo import scarica_meteo  # noqa: E402
from fungometer.punteggio import (  # noqa: E402
    carica_specie,
    fattore_stagione,
    fattori_statici,
    punteggio,
)

GIORNI_PASSATI = 17  # 14 giorni di pioggia che finiscono 3 giorni prima di oggi
GIORNI_FUTURI = 8  # oggi + 7
FUSO = ZoneInfo("Europe/Rome")


def _cento(x):
    """Da fattore 0-1 a intero 0-100."""
    return round(100 * x)


def _arrotonda(lista, cifre):
    return [None if v is None else round(v, cifre) for v in lista]


def calcola(celle, config, date_meteo, meteo_per_cella, giorni):
    """Costruisce il dizionario di punteggi.json per i giorni richiesti."""
    comune = config["comune"]
    specie = config["specie"]
    indici = [date_meteo.index(g) for g in giorni]
    mesi = [date.fromisoformat(g).month for g in giorni]

    uscita_specie = []
    for codice, sp in specie.items():
        uscita_specie.append({
            "id": codice,
            "nome": sp["nome"],
            "latino": sp["latino"],
            "ambiente": sp["ambiente"],
            # Parametri mostrati nella pagina Info (sempre allineati a specie.yaml)
            "mesi_centrali": sp["mesi_centrali"],
            "mesi_margine": sp["mesi_margine"],
            "quota": sp["quota"],
            "pioggia_mm": sp["pioggia_mm"],
            "temperatura": sp["temperatura"],
            "stagione": [
                _cento(fattore_stagione(m, sp["mesi_centrali"], sp["mesi_margine"],
                                        comune["stagione"]))
                for m in mesi
            ],
        })

    uscita_celle = {}
    for cella in celle:
        meteo = meteo_per_cella[cella["id"]]
        voce = {
            "p": [], "tr": [],
            "tn": _arrotonda([meteo["tmin"][i] for i in indici], 1),
            "tx": _arrotonda([meteo["tmax"][i] for i in indici], 1),
            "u": _arrotonda([meteo["suolo"][i] for i in indici], 2),
            "s": [],
        }
        for codice, sp in specie.items():
            statici = fattori_statici(cella, sp, comune)
            risultati = [
                punteggio(meteo, i, m, sp, comune, statici)
                for i, m in zip(indici, mesi)
            ]
            # Pioggia e temperatura di riferimento non dipendono dalla specie:
            # le prendiamo dalla prima.
            if not voce["p"]:
                voce["p"] = [round(r["pioggia_mm"]) for r in risultati]
                voce["tr"] = _arrotonda([r["t_rif"] for r in risultati], 1)

            if statici["habitat"] == 0 or statici["quota"] == 0:
                voce["s"].append(None)
            else:
                voce["s"].append({
                    "S": [r["S"] for r in risultati],
                    "fp": [_cento(r["pioggia"]) for r in risultati],
                    "ft": [_cento(r["temperatura"]) for r in risultati],
                    "fh": _cento(statici["habitat"]),
                    "fq": _cento(statici["quota"]),
                })
        uscita_celle[cella["id"]] = voce

    return {
        "aggiornato": datetime.now(FUSO).isoformat(timespec="seconds"),
        "regole": {
            "giorni_pioggia": comune["pioggia"]["giorni"],
            "ritardo_pioggia": comune["pioggia"].get("ritardo", 0),
            "giorni_temperatura": comune["temperatura"]["giorni_media"],
        },
        "giorni": giorni,
        "specie": uscita_specie,
        "celle": uscita_celle,
    }


def celle_per_la_mappa(celle):
    """Versione ridotta di celle.json con quello che serve all'app."""
    return [
        {
            "id": c["id"],
            "zona": c["zona"],
            "bbox": c["bbox"],
            "quota": c["quota"],
            # Solo le classi Corine che coprono almeno il 5% della cella.
            "corine": {k: v for k, v in c["corine"].items() if v >= 5},
        }
        for c in celle
    ]


def scrivi_json(dati, percorso):
    percorso.parent.mkdir(parents=True, exist_ok=True)
    with open(percorso, "w", encoding="utf-8") as f:
        json.dump(dati, f, ensure_ascii=False, separators=(",", ":"))
    kb = percorso.stat().st_size / 1024
    print(f"Scritto {percorso.relative_to(RADICE)} ({kb:.0f} KB)")
    return kb


def serve_aggiornare(percorso_punteggi, ora_minima=6):
    """Decide se è il momento di lavorare (usato dal cron di GitHub Actions).

    Il cron di GitHub ragiona in ora UTC e non conosce l'ora legale, quindi il
    workflow parte due volte (04:00 e 05:00 UTC). Qui si lavora solo se:
    - in Italia sono almeno le 6;
    - il file di oggi non è ancora stato scritto.
    Così l'aggiornamento avviene una volta sola, alle 6, estate e inverno.
    """
    adesso = datetime.now(FUSO)
    if adesso.hour < ora_minima:
        print(f"In Italia sono le {adesso:%H:%M}: troppo presto, esco.")
        return False
    if percorso_punteggi.exists():
        with open(percorso_punteggi, encoding="utf-8") as f:
            aggiornato = json.load(f).get("aggiornato", "")
        if aggiornato.startswith(adesso.date().isoformat()):
            print(f"Punteggi già aggiornati oggi ({aggiornato}), esco.")
            return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Calcola i punteggi di oggi e dei prossimi 7 giorni")
    parser.add_argument(
        "--controlla-ora",
        action="store_true",
        help="lavora solo se in Italia sono passate le 6 e oggi non è ancora stato fatto",
    )
    args = parser.parse_args()

    uscita_punteggi = RADICE / "docs" / "data" / "punteggi.json"
    if args.controlla_ora and not serve_aggiornare(uscita_punteggi):
        return

    with open(RADICE / "data" / "celle.json", encoding="utf-8") as f:
        celle = json.load(f)
    config = carica_specie(RADICE / "config" / "specie.yaml")

    print(f"Scarico il meteo di {len(celle)} celle...")
    date_meteo, meteo_per_cella = scarica_meteo(
        celle, past_days=GIORNI_PASSATI, forecast_days=GIORNI_FUTURI
    )

    oggi = datetime.now(FUSO).date().isoformat()
    inizio = date_meteo.index(oggi)
    giorni = date_meteo[inizio: inizio + GIORNI_FUTURI]

    dati = calcola(celle, config, date_meteo, meteo_per_cella, giorni)
    kb = scrivi_json(dati, uscita_punteggi)
    scrivi_json(celle_per_la_mappa(celle), RADICE / "docs" / "data" / "celle.json")

    if kb > 1024:
        sys.exit("ATTENZIONE: punteggi.json supera 1 MB")


if __name__ == "__main__":
    main()
