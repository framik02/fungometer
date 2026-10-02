"""Prove della griglia d'Italia e del modello delle sue celle (fungometer/italia.py)."""

from datetime import date
from pathlib import Path

from fungometer.italia import (codice_riquadro, celle_riquadro, fattori_cella_italia, passi_riquadro,
                               riassunto_gruppo, riquadri)
from fungometer.punteggio import carica_specie, fattore_stagione

CONFIG = carica_specie(Path(__file__).resolve().parent.parent / "config" / "specie.yaml")
COMUNE = CONFIG["comune"]
PORCINO = CONFIG["specie"]["porcini_autunnali"]


def meteo_costante(giorni=40, pioggia=3.0, tmed=12.0, tmin=6.0, tmax=18.0, suolo=0.30):
    return {"pioggia": [pioggia] * giorni, "tmin": [tmin] * giorni, "tmax": [tmax] * giorni,
            "tmed": [tmed] * giorni, "suolo": [suolo] * giorni}


def test_codici_dei_riquadri():
    assert codice_riquadro(42.5, 12.0) == "i4250n1200"
    assert codice_riquadro(36.0, 6.5) == "i3600n0650"
    codici = [r[0] for r in riquadri()]
    assert len(codici) == len(set(codici))
    assert all("_" not in c for c in codici)   # l'app ricava l'area tagliando l'id al primo "_"


def test_celle_circa_tre_km_e_gruppi():
    righe, colonne = passi_riquadro(42.5)
    celle = celle_riquadro("i4250n1200", 42.5, 12.0)
    assert len(celle) == righe * colonne
    assert celle[0]["gruppo"] == "i4250n1200_g0_0"
    assert celle[-1]["bbox"][2] == 43.0 and celle[-1]["bbox"][3] == 12.5


def test_riassunto_del_gruppo():
    m = meteo_costante()
    r = riassunto_gruppo(m, 35, COMUNE)
    assert r["p"] == 3.0 * COMUNE["acqua"]["giorni_pioggia"]
    assert r["tr"] == 12.0 and r["k"] == 0 and r["c"] == 0


def test_stessa_quota_come_il_gruppo():
    """Alla quota del gruppo la cella ha i fattori del gruppo: nessuna correzione."""
    m = meteo_costante()
    r = riassunto_gruppo(m, 35, COMUNE)
    giorno = date(2026, 10, 10)
    f = fattori_cella_italia(r, m["tmin"][29:36], 900, 900, giorno, PORCINO, COMUNE)
    stagione = fattore_stagione(giorno, PORCINO["mesi_centrali"], PORCINO["mesi_margine"], 900, COMUNE["stagione"])
    assert abs(f["stagione"] - stagione) < 1e-12
    assert f["gelo"] == 0


def test_piu_in_alto_fa_piu_freddo_e_gela():
    """1000 m più in alto: 6,5 °C in meno, la minima scende sotto zero."""
    m = meteo_costante(tmin=5.0)
    r = riassunto_gruppo(m, 35, COMUNE)
    giorno = date(2026, 10, 10)
    basso = fattori_cella_italia(r, m["tmin"][29:36], 500, 500, giorno, PORCINO, COMUNE)
    alto = fattori_cella_italia(r, m["tmin"][29:36], 1500, 500, giorno, PORCINO, COMUNE)
    assert basso["gelo"] == 0 and alto["gelo"] == 7
    assert alto["stagione"] < basso["stagione"]
    # L'acqua non dipende dalla quota
    assert alto["acqua"] == basso["acqua"]
