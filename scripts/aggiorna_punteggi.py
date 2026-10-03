"""Calcola i punteggi di oggi e dei prossimi 7 giorni e li salva per l'app.

    python scripts/aggiorna_punteggi.py                  (lavora subito)
    python scripts/aggiorna_punteggi.py --controlla-ora  (come il cron: solo dopo le 6, una volta al giorno)

Legge:  data/celle.json e data/sottocelle.json (da prepare_static.py)
        config/specie.yaml
Scrive: docs/data/punteggi.json            data, giorni, specie e regole (piccolo)
        docs/data/punteggi_<area>.json     meteo e fattori delle celle di un'area, cambia ogni giorno
        docs/data/celle.json               forma e dati fissi delle celle, per la mappa
        docs/data/statiche.json            6 numeri per sottocella: servono a colorare la mappa
        docs/data/sottocelle/<zona>.json   schede complete delle sottocelle, una per zona
                                           (l'app le scarica solo quando tocchi un quadrato)

Formato di punteggi.json (scritto compatto per restare sotto 1 MB):
{
  "aggiornato": "2026-09-27T06:03:12+02:00",
  "regole": {...},                      numeri che servono all'app
  "giorni": ["2026-09-27", ... 8 date],
  "specie": [{"id": "porcini_estivi", "nome": ..., "stagione": [8 fattori 0-100]}, ...],
  "celle": {
    "foligno_000_010": {
      "p":  [8 x pioggia degli ultimi 26 giorni, mm],
      "u":  [8 x umidità del suolo 7-28 cm, m3/m3],
      "k":  [8 x giorni di caldo nelle ultime 2 settimane],
      "tn": [8 x temperatura minima del giorno], "tx": [8 x massima],
      "tr": [8 x temperatura di riferimento, media degli ultimi 20 giorni],
      "g":  [8 x notti di gelo nell'ultima settimana],
      "s":  [una voce per specie, nello stesso ordine di "specie":
             {"fa": [8 fattori acqua], "ft": [8 fattori temperatura],
              "fs": [8 fattori stagione per la quota della cella, gelo compreso]}]
    }
  }
}

Formato di docs/data/statiche.json:
{ "id cella": [36 x (specie + 1) numeri, sottocella dopo sottocella (per righe da sud a nord):
               habitat x quota per ognuna delle specie, poi il fattore terreno;
               255 se la sottocella è acqua] }
L'app calcola il punteggio di ogni quadrato da 500 m così:
  100 x acqua x temperatura x stagione x (habitat x quota) x terreno

Formato di docs/data/sottocelle/<zona>.json:
{ "id cella": [36 voci, per righe da sud a nord; null se la sottocella è acqua,
               altrimenti [quota mediana, pendenza media, uso principale, %, secondo uso, %,
                           % di canaloni, fattore terreno, [habitat x specie], [quota x specie]]] }
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
sys.path.insert(0, str(RADICE / "scripts"))

from fungometer.griglia import SOTTOCELLE_PER_LATO  # noqa: E402
from fungometer.italia import GRADIENTE_TERMICO  # noqa: E402
from fungometer.meteo import scarica_meteo  # noqa: E402
from aggiorna_italia import aggiorna_italia  # noqa: E402
from fungometer.punteggio import (  # noqa: E402
    carica_specie,
    fattore_stagione,
    fattori_meteo,
    fattori_statici,
)

GIORNI_PASSATI = 26  # la pioggia si somma su 26 giorni
GIORNI_FUTURI = 8    # oggi + 7
FUSO = ZoneInfo("Europe/Rome")


def _cento(x):
    """Da fattore 0-1 a intero 0-100."""
    return round(100 * x)


def _arrotonda(lista, cifre):
    return [None if v is None else round(v, cifre) for v in lista]


def statici_di_tutte(sottocelle, config):
    """Habitat, quota e terreno di ogni sottocella per ogni specie.

    Restituisce {id cella: [None o {codice specie: fattori}] x 36}.
    """
    risultato = {}
    for id_cella, elenco in sottocelle.items():
        risultato[id_cella] = [
            None if s is None else {
                codice: fattori_statici(s, sp, config["comune"])
                for codice, sp in config["specie"].items()
            }
            for s in elenco
        ]
    return risultato


def calcola(celle, config, statici, date_meteo, meteo_per_cella, giorni):
    """Costruisce il dizionario di punteggi.json per i giorni richiesti."""
    comune = config["comune"]
    specie = config["specie"]
    indici = [date_meteo.index(g) for g in giorni]
    date_giorni = [date.fromisoformat(g) for g in giorni]

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
            "temperatura_ottimale": sp.get("temperatura_ottimale"),
            "stagione": [
                _cento(fattore_stagione(d, sp["mesi_centrali"], sp["mesi_margine"]))
                for d in date_giorni
            ],
        })

    uscita_celle = {}
    for cella in celle:
        meteo = meteo_per_cella[cella["id"]]
        voce = {
            "p": [], "u": [], "k": [], "tr": [], "g": [],
            "tn": _arrotonda([meteo["tmin"][i] for i in indici], 1),
            "tx": _arrotonda([meteo["tmax"][i] for i in indici], 1),
            "s": [],
        }
        for codice, sp in specie.items():
            fa, ft, fs = [], [], []
            for i, d in zip(indici, date_giorni):
                mf = fattori_meteo(meteo, i, d, sp, comune, quota=cella["quota"]["media"])
                fa.append(_cento(mf["acqua"]))
                fs.append(_cento(mf["stagione"]))
                ft.append(_cento(mf["temperatura"]))
                # Pioggia, suolo, caldo e temperatura non dipendono dalla specie
                if len(voce["p"]) < len(indici):
                    voce["p"].append(round(mf["pioggia_mm"]))
                    voce["u"].append(None if mf["suolo"] is None else round(mf["suolo"], 3))
                    voce["k"].append(mf["caldo"])
                    voce["tr"].append(None if mf["t_rif"] is None else round(mf["t_rif"], 1))
                    voce["g"].append(mf["gelo"])
            voce["s"].append({"fa": fa, "ft": ft, "fs": fs})
        uscita_celle[cella["id"]] = voce

    return {
        "aggiornato": datetime.now(FUSO).isoformat(timespec="seconds"),
        "regole": {
            "giorni_pioggia": comune["acqua"]["giorni_pioggia"],
            "giorni_temperatura": comune["temperatura"]["giorni_media"],
            "effetto_se_bagnato": comune["terreno"]["effetto_se_bagnato"],
            "sottocelle_per_lato": SOTTOCELLE_PER_LATO,
            # Per le celle d'Italia l'app rifà acqua, temperatura e stagione
            # (fungometer/italia.py): servono le stesse regole del programma
            "acqua": comune["acqua"],
            "bonus_calo": comune["temperatura"]["bonus_calo"],
            "stagione": comune.get("stagione"),
            "gelo": comune.get("gelo"),
            "gradiente_termico": GRADIENTE_TERMICO,
        },
        "giorni": giorni,
        "specie": uscita_specie,
        "celle": uscita_celle,
    }


def celle_per_la_mappa(celle):
    """Versione ridotta di celle.json con quello che serve all'app."""
    return [
        {"id": c["id"], "area": c["area"], "zona": c["zona"], "zona_id": c["zona_id"], "bbox": c["bbox"],
         "quota": c["quota"], "uso": c["uso"]}
        for c in celle
    ]


def statiche_leggere(celle, statici, config):
    """I 6 numeri per sottocella che servono a colorare la mappa (vedi in cima)."""
    codici = list(config["specie"])
    risultato = {}
    for cella in celle:
        numeri = []
        for st in statici[cella["id"]]:
            if st is None:
                numeri.extend([255] * (len(codici) + 1))
                continue
            numeri.extend(_cento(st[c]["habitat"] * st[c]["quota"]) for c in codici)
            numeri.append(_cento(st[codici[0]]["terreno"]))
        risultato[cella["id"]] = numeri
    return risultato


def sottocelle_per_zona(celle, sottocelle, statici, config):
    """Dati fissi delle sottocelle, raggruppati per zona (un file per zona)."""
    codici = list(config["specie"])
    per_zona = {}
    for cella in celle:
        elenco = []
        for s, st in zip(sottocelle[cella["id"]], statici[cella["id"]]):
            if s is None:
                elenco.append(None)
                continue
            usi = sorted(s["h"].items(), key=lambda x: -x[1])[:2] + [("", 0)] * 2
            primo_statico = st[codici[0]]
            elenco.append([
                s["q"][1], s["p"],
                usi[0][0], usi[0][1], usi[1][0], usi[1][1],
                s["m"].get("ca", 0),
                _cento(primo_statico["terreno"]),
                [_cento(st[c]["habitat"]) for c in codici],
                [_cento(st[c]["quota"]) for c in codici],
            ])
        per_zona.setdefault(cella["zona_id"], {})[cella["id"]] = elenco
    return per_zona


def scrivi_json(dati, percorso, stampa=True):
    percorso.parent.mkdir(parents=True, exist_ok=True)
    with open(percorso, "w", encoding="utf-8") as f:
        json.dump(dati, f, ensure_ascii=False, separators=(",", ":"))
    kb = percorso.stat().st_size / 1024
    if stampa:
        print(f"Scritto {percorso.relative_to(RADICE)} ({kb:.0f} KB)")
    return kb


def serve_aggiornare(percorso_punteggi, ora_minima=4):
    """Decide se è il momento di lavorare (usato dal cron di GitHub Actions).

    Il cron di GitHub ragiona in ora UTC e non conosce l'ora legale, quindi il
    workflow parte due volte (02:17 e 03:17 UTC). Qui si lavora solo se:
    - in Italia sono almeno le 4;
    - il file di oggi non è ancora stato scritto.
    Così l'aggiornamento parte una volta sola, alle 4 e un quarto, estate e
    inverno. Con il meteo di tutta Italia dura circa un'ora e un quarto (il
    limite orario di Open-Meteo): i dati nuovi sono pronti prima delle 6.
    """
    adesso = datetime.now(FUSO)
    if adesso.hour < ora_minima:
        print(f"In Italia sono le {adesso:%H:%M}: troppo presto, esco.")
        return False
    if percorso_punteggi.exists():
        with open(percorso_punteggi, encoding="utf-8") as f:
            aggiornato = json.load(f).get("aggiornato", "")
        # Conta solo un aggiornamento fatto oggi dopo l'ora minima: uno lanciato a
        # mano dopo mezzanotte (il 3 ottobre 2026 alle 0:29) non deve far saltare
        # quello del mattino, che scarica il meteo nuovo.
        try:
            quando = datetime.fromisoformat(aggiornato).astimezone(FUSO)
        except ValueError:
            quando = None
        if quando and quando.date() == adesso.date() and quando.hour >= ora_minima:
            print(f"Punteggi già aggiornati oggi ({aggiornato}), esco.")
            return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Calcola i punteggi di oggi e dei prossimi 7 giorni")
    parser.add_argument(
        "--controlla-ora",
        action="store_true",
        help="lavora solo se in Italia sono passate le 4 e oggi non è ancora stato fatto",
    )
    parser.add_argument("--senza-italia", action="store_true", help="solo Foligno e Roma (per le prove)")
    parser.add_argument("--solo-italia", action="store_true",
                        help="rifà solo l'Italia, con i punteggi di Foligno e Roma già scritti oggi")
    args = parser.parse_args()

    uscita_punteggi = RADICE / "docs" / "data" / "punteggi.json"
    if args.controlla_ora and not serve_aggiornare(uscita_punteggi):
        return

    with open(RADICE / "data" / "celle.json", encoding="utf-8") as f:
        celle = json.load(f)

    if args.solo_italia:
        config = carica_specie(RADICE / "config" / "specie.yaml")
        dati = json.loads(uscita_punteggi.read_text(encoding="utf-8"))
        celle_dati = {}
        for area in dati.get("aree", []):
            parte = RADICE / "docs" / "data" / f"punteggi_{area}.json"
            celle_dati.update(json.loads(parte.read_text(encoding="utf-8"))["celle"])
        statiche = json.loads((RADICE / "docs" / "data" / "statiche.json").read_text(encoding="utf-8"))
        aggiorna_italia(config, None, dati["giorni"], celle_dati, celle, statiche)
        return
    with open(RADICE / "data" / "sottocelle.json", encoding="utf-8") as f:
        sottocelle = json.load(f)
    config = carica_specie(RADICE / "config" / "specie.yaml")
    statici = statici_di_tutte(sottocelle, config)

    print(f"Scarico il meteo di {len(celle)} celle...")
    date_meteo, meteo_per_cella = scarica_meteo(
        celle, past_days=GIORNI_PASSATI, forecast_days=GIORNI_FUTURI
    )

    oggi = datetime.now(FUSO).date().isoformat()
    inizio = date_meteo.index(oggi)
    giorni = date_meteo[inizio: inizio + GIORNI_FUTURI]

    dati = calcola(celle, config, statici, date_meteo, meteo_per_cella, giorni)
    celle_dati = dict(dati["celle"])
    # Un file per area, così ognuno resta sotto 1 MB anche con molte specie
    per_area = {}
    for cella in celle:
        per_area.setdefault(cella["area"], {})[cella["id"]] = dati["celle"][cella["id"]]
    dati["celle"] = {}
    dati["aree"] = sorted(per_area)
    kb = scrivi_json(dati, uscita_punteggi)
    for area, celle_area in per_area.items():
        kb = max(kb, scrivi_json({"celle": celle_area}, RADICE / "docs" / "data" / f"punteggi_{area}.json"))
    scrivi_json(celle_per_la_mappa(celle), RADICE / "docs" / "data" / "celle.json")
    scrivi_json(statiche_leggere(celle, statici, config), RADICE / "docs" / "data" / "statiche.json")
    totale = 0
    for zona_id, contenuto in sottocelle_per_zona(celle, sottocelle, statici, config).items():
        totale += scrivi_json(contenuto, RADICE / "docs" / "data" / "sottocelle" / f"{zona_id}.json",
                              stampa=False)
    print(f"Scritte le sottocelle di tutte le zone ({totale:.0f} KB in totale)")

    if not args.senza_italia:
        aggiorna_italia(config, date_meteo, giorni, celle_dati, celle, statiche_leggere(celle, statici, config))

    if kb > 1024:
        sys.exit("ATTENZIONE: un file dei punteggi supera 1 MB")


if __name__ == "__main__":
    main()
