"""Prova il punteggio su stagioni passate, con le previsioni storiche di Open-Meteo.

    python scripts/prova_storica.py                  # 2023, 2024, 2025
    python scripts/prova_storica.py --anni 2024

Per alcuni posti noti calcola il punteggio di ogni giorno da agosto a novembre
nella sottocella da 500 m che contiene il posto, usando solo dati già
osservati (la previsione del giorno stesso, niente futuro). Stampa, per ogni
settimana, il punteggio medio come una barretta (vuoto = 0, pieno = 100) e
salva tutti i numeri in output/prova_storica_<anno>.csv.

Il meteo viene dall'archivio delle previsioni (historical-forecast-api), che
ha gli stessi modelli e la stessa scala dei dati usati ogni mattina; parte dal
2023 per l'umidità del suolo.

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

from fungometer.griglia import SOTTOCELLE_PER_LATO, bbox_sottocella  # noqa: E402
from fungometer.meteo import scarica_meteo  # noqa: E402
from fungometer.punteggio import carica_specie, fattori_meteo, fattori_statici, punteggio  # noqa: E402

# Posti noti: (nome, lat, lon). Si usa la sottocella che contiene il punto.
POSTI = [
    ("Faggeta del Monte Cimino", 42.408, 12.197),
    ("Macchia di Manziana", 42.115, 12.100),
    ("Castagneti di Rocca di Papa", 41.760, 12.700),
    ("Monte Livata, Simbruini", 41.950, 13.130),
    ("Monte Subasio", 43.063, 12.684),
    ("Monte Cucco", 43.370, 12.730),
    ("Colfiorito", 43.026, 12.889),
    ("Monti Martani", 42.800, 12.550),
    ("Castelluccio di Norcia", 42.828, 13.207),
]
BARRETTE = " ▁▂▃▄▅▆▇█"
NOMI_USO = json.loads((RADICE / "data" / "tipi_bosco.json").read_text(encoding="utf-8"))


def barretta(valore):
    """Da 0-100 a un carattere: vuoto per 0, pieno per 100."""
    return BARRETTE[min(8, round(valore / 12.5))]


def sottocella_del_posto(celle, sottocelle, lat, lon):
    """(cella, numero sottocella, dati sottocella) del punto, o None."""
    for c in celle:
        sud, ovest, nord, est = c["bbox"]
        if sud <= lat <= nord and ovest <= lon <= est:
            for k in range(SOTTOCELLE_PER_LATO ** 2):
                s_, o_, n_, e_ = bbox_sottocella(c["bbox"], k)
                if s_ <= lat <= n_ and o_ <= lon <= e_ and sottocelle[c["id"]][k]:
                    return c, k, sottocelle[c["id"]][k]
    return None


def descrivi_uso(uso):
    parti = []
    for chiave, perc in sorted(uso.items(), key=lambda x: -x[1])[:2]:
        nome = NOMI_USO.get(chiave[1:], chiave) if chiave.startswith("t") else f"Corine {chiave[1:]}"
        parti.append(f"{nome} {perc}%")
    return ", ".join(parti)


def prova_anno(anno, scelti, config):
    inizio = date(anno, 8, 1)
    fine = date(anno, 11, 30)
    giorni_prima = config["comune"]["acqua"]["giorni_pioggia"]
    date_meteo, meteo_per_cella = scarica_meteo(
        [c for _, c, _, _ in scelti],
        start_date=(inizio - timedelta(days=giorni_prima)).isoformat(),
        end_date=fine.isoformat(),
    )
    primo = date_meteo.index(inizio.isoformat())
    comune = config["comune"]

    righe_csv = []
    print(f"\n===== {anno}  (una barretta per settimana, da agosto a novembre) =====")
    for nome, cella, k, sotto in scelti:
        meteo = meteo_per_cella[cella["id"]]
        print(f"\n{nome}  (quota {sotto['q'][1]} m, {descrivi_uso(sotto['h'])})")
        pioggia_sett = [sum(p or 0 for p in meteo["pioggia"][i: i + 7])
                        for i in range(primo, len(date_meteo), 7)]
        print(f"  {'pioggia mm/settimana':24s} " + " ".join(f"{p:3.0f}" for p in pioggia_sett))

        for codice, sp in config["specie"].items():
            statici = fattori_statici(sotto, sp, comune)
            giornalieri = []
            for i in range(primo, len(date_meteo)):
                giorno = date.fromisoformat(date_meteo[i])
                mf = fattori_meteo(meteo, i, giorno, sp, comune)
                s = punteggio(mf, statici, comune)
                giornalieri.append(s)
                righe_csv.append({
                    "data": date_meteo[i], "posto": nome, "specie": codice, "S": round(s),
                    "f_acqua": round(mf["acqua"], 2), "f_temperatura": round(mf["temperatura"], 2),
                    "f_stagione": mf["stagione"], "f_habitat": round(statici["habitat"], 2),
                    "f_quota": round(statici["quota"], 2), "f_terreno": round(statici["terreno"], 2),
                    "pioggia_26gg": round(mf["pioggia_mm"]),
                    "suolo": None if mf["suolo"] is None else round(mf["suolo"], 3),
                    "giorni_caldo": mf["caldo"],
                    "t_rif": None if mf["t_rif"] is None else round(mf["t_rif"], 1),
                })
            settimane = [sum(giornalieri[j: j + 7]) / len(giornalieri[j: j + 7])
                         for j in range(0, len(giornalieri), 7)]
            nota = "" if statici["habitat"] and statici["quota"] else "  (habitat o quota non adatti)"
            print(f"  {sp['nome']:24s} " + "   ".join(barretta(s) for s in settimane)
                  + f"   max {max(giornalieri):3.0f}{nota}")

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

    celle = json.loads((RADICE / "data" / "celle.json").read_text(encoding="utf-8"))
    sottocelle = json.loads((RADICE / "data" / "sottocelle.json").read_text(encoding="utf-8"))
    config = carica_specie(RADICE / "config" / "specie.yaml")

    scelti = []
    for nome, lat, lon in POSTI:
        trovato = sottocella_del_posto(celle, sottocelle, lat, lon)
        if trovato is None:
            print(f"{nome}: nessuna sottocella, lo salto")
        else:
            scelti.append((nome, *trovato))

    for anno in args.anni:
        prova_anno(anno, scelti, config)


if __name__ == "__main__":
    main()
