"""Prova il punteggio su stagioni passate, con il meteo storico di Open-Meteo.

    python scripts/prova_storica.py                  # 2023, 2024, 2025
    python scripts/prova_storica.py --anni 2024

Per alcune celle di posti noti calcola il punteggio di ogni giorno da agosto a
novembre, usando solo meteo osservato (niente previsioni). Stampa, per ogni
settimana, il punteggio medio come una barretta (vuoto = 0, pieno = 100) e salva
tutti i numeri in output/prova_storica_<anno>.csv.

Non esiste un registro ufficiale dei ritrovamenti da confrontare: la prova serve
a controllare che i punteggi salgano dopo le piogge, calino col secco e col
freddo, e restino a zero fuori stagione.
"""

import argparse
import csv
import json
import sys
from datetime import date, timedelta
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.meteo import scarica_meteo  # noqa: E402
from fungometer.punteggio import carica_specie, fattori_statici, punteggio  # noqa: E402

# Posti noti: (nome, lat, lon). Si usa la cella che contiene il punto.
POSTI = [
    ("Faggeta del Monte Cimino", 42.408, 12.197),
    ("Macchia di Manziana", 42.115, 12.100),
    ("Monte Cavo, Castelli", 41.751, 12.708),
    ("Monte Livata, Simbruini", 41.950, 13.130),
    ("Monte Subasio", 43.063, 12.684),
    ("Monte Cucco", 43.370, 12.730),
    ("Colfiorito", 43.026, 12.889),
    ("Monti Martani", 42.800, 12.550),
    ("Castelluccio di Norcia", 42.828, 13.207),
]
BARRETTE = " ▁▂▃▄▅▆▇█"


def barretta(valore):
    """Da 0-100 a un carattere: vuoto per 0, pieno per 100."""
    return BARRETTE[min(8, round(valore / 12.5))]


def cella_del_posto(celle, lat, lon):
    for c in celle:
        sud, ovest, nord, est = c["bbox"]
        if sud <= lat <= nord and ovest <= lon <= est:
            return c
    return None


def prova_anno(anno, celle_scelte, config):
    inizio = date(anno, 8, 1)
    fine = date(anno, 11, 30)
    # 17 giorni prima dell'inizio per avere la pioggia (da 17 a 3 giorni prima) dal primo giorno
    date_meteo, meteo_per_cella = scarica_meteo(
        [c for _, c in celle_scelte],
        start_date=(inizio - timedelta(days=17)).isoformat(),
        end_date=fine.isoformat(),
    )
    primo = date_meteo.index(inizio.isoformat())
    comune = config["comune"]

    righe_csv = []
    print(f"\n===== {anno}  (una barretta per settimana, da agosto a novembre) =====")
    for nome, cella in celle_scelte:
        meteo = meteo_per_cella[cella["id"]]
        print(f"\n{nome}  ({cella['quota']['media']} m, zona: {cella['zona']})")

        # Pioggia della settimana, per leggere le barrette
        settimane_pioggia = []
        for i in range(primo, len(date_meteo), 7):
            settimane_pioggia.append(sum(p or 0 for p in meteo["pioggia"][i: i + 7]))
        print(f"  {'pioggia mm/settimana':24s} " + " ".join(f"{p:3.0f}" for p in settimane_pioggia))

        for codice, sp in config["specie"].items():
            statici = fattori_statici(cella, sp, comune)
            giornalieri = []
            for i in range(primo, len(date_meteo)):
                giorno = date.fromisoformat(date_meteo[i])
                r = punteggio(meteo, i, giorno.month, sp, comune, statici)
                giornalieri.append(r["S"])
                righe_csv.append({
                    "data": date_meteo[i], "posto": nome, "specie": codice,
                    "S": r["S"],
                    "f_pioggia": round(r["pioggia"], 2),
                    "f_temperatura": round(r["temperatura"], 2),
                    "f_habitat": round(r["habitat"], 2),
                    "f_stagione": r["stagione"],
                    "f_quota": round(r["quota"], 2),
                    "pioggia_14gg": round(r["pioggia_mm"]),
                    "t_rif": None if r["t_rif"] is None else round(r["t_rif"], 1),
                })
            settimane = [
                sum(giornalieri[k: k + 7]) / len(giornalieri[k: k + 7])
                for k in range(0, len(giornalieri), 7)
            ]
            nota = "" if statici["habitat"] and statici["quota"] else "  (habitat o quota non adatti)"
            print(f"  {sp['nome']:24s} " + "   ".join(barretta(s) for s in settimane)
                  + f"   max {max(giornalieri):3d}{nota}")

    uscita = RADICE / "output" / f"prova_storica_{anno}.csv"
    uscita.parent.mkdir(exist_ok=True)
    with open(uscita, "w", newline="", encoding="utf-8") as f:
        scrittore = csv.DictWriter(f, fieldnames=list(righe_csv[0]))
        scrittore.writeheader()
        scrittore.writerows(righe_csv)
    print(f"\nDettaglio giorno per giorno in {uscita.relative_to(RADICE)}")


def main():
    # Le barrette sono caratteri speciali: forziamo l'UTF-8 anche su Windows.
    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Prova il punteggio su stagioni passate")
    parser.add_argument("--anni", type=int, nargs="+", default=[2023, 2024, 2025])
    args = parser.parse_args()

    with open(RADICE / "data" / "celle.json", encoding="utf-8") as f:
        celle = json.load(f)
    config = carica_specie(RADICE / "config" / "specie.yaml")

    celle_scelte = []
    for nome, lat, lon in POSTI:
        cella = cella_del_posto(celle, lat, lon)
        if cella is None:
            print(f"{nome}: nessuna cella, lo salto")
        else:
            celle_scelte.append((nome, cella))

    for anno in args.anni:
        prova_anno(anno, celle_scelte, config)


if __name__ == "__main__":
    main()
