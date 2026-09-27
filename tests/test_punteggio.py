"""Test del motore del punteggio.

Si lanciano con:
    .venv\\Scripts\\python -m pytest

Ogni test costruisce un meteo o una cella inventati, di cui conosciamo già
il risultato giusto, e controlla che il codice lo ritrovi.
"""

import sys
from pathlib import Path

import pytest

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.punteggio import (  # noqa: E402
    calo_termico_dopo_pioggia,
    carica_specie,
    fattore_habitat,
    fattore_pioggia,
    fattore_quota,
    fattore_stagione,
    fattore_temperatura,
    fattori_statici,
    punteggio,
    rampa,
)

CONFIG = carica_specie(RADICE / "config" / "specie.yaml")
COMUNE = CONFIG["comune"]
SPECIE = CONFIG["specie"]


def meteo_costante(giorni=22, pioggia=0.0, tmed=15.0, suolo=0.2):
    """Meteo inventato: tutti i giorni uguali."""
    return {
        "pioggia": [pioggia] * giorni,
        "tmed": [tmed] * giorni,
        "tmin": [tmed - 5] * giorni,
        "tmax": [tmed + 5] * giorni,
        "suolo": [suolo] * giorni,
    }


# --- rampa -----------------------------------------------------------------

@pytest.mark.parametrize("valore, atteso", [
    (16, 1.0), (20, 1.0), (24, 1.0),   # dentro l'intervallo
    (14, 0.5), (26, 0.5),              # a metà rampa
    (12, 0.0), (28, 0.0), (5, 0.0),    # fuori
])
def test_rampa(valore, atteso):
    assert rampa(valore, 16, 24, 4) == pytest.approx(atteso)


# --- pioggia ---------------------------------------------------------------

def test_pioggia_sale_linearmente_fino_alla_soglia():
    regole = COMUNE["pioggia"]
    # 1 mm al giorno per 14 giorni = 14 mm; soglia 28 -> metà
    meteo = meteo_costante(pioggia=1.0)
    fattore, mm = fattore_pioggia(meteo, 20, 28, regole)
    assert mm == pytest.approx(14)
    assert fattore == pytest.approx(0.5)


def test_pioggia_conta_solo_gli_ultimi_14_giorni():
    regole = COMUNE["pioggia"]
    # Con ritardo 3 per il giorno 20 contano i giorni da 4 a 17
    meteo = meteo_costante()
    meteo["pioggia"][0] = 100  # 20 giorni prima: troppo vecchia
    meteo["pioggia"][4] = 30   # 16 giorni prima: conta
    meteo["pioggia"][19] = 50  # ieri: troppo recente, i funghi non sono ancora usciti
    _, mm = fattore_pioggia(meteo, 20, 30, regole)
    assert mm == pytest.approx(30)


def test_pioggia_oltre_soglia_vale_uno():
    fattore, _ = fattore_pioggia(meteo_costante(pioggia=10), 20, 30, COMUNE["pioggia"])
    assert fattore == 1.0


def test_bonus_suolo_umido():
    regole = COMUNE["pioggia"]
    secco, _ = fattore_pioggia(meteo_costante(pioggia=1, suolo=0.1), 20, 28, regole)
    umido, _ = fattore_pioggia(meteo_costante(pioggia=1, suolo=0.4), 20, 28, regole)
    assert secco == pytest.approx(0.5)
    assert umido == pytest.approx(0.55)


def test_bonus_suolo_non_crea_pioggia_dal_nulla():
    fattore, _ = fattore_pioggia(meteo_costante(pioggia=0, suolo=0.5), 20, 30, COMUNE["pioggia"])
    assert fattore == 0.0


def test_pioggia_con_dati_mancanti():
    meteo = meteo_costante(pioggia=2)
    meteo["pioggia"][15] = None
    _, mm = fattore_pioggia(meteo, 20, 30, COMUNE["pioggia"])
    assert mm == pytest.approx(26)


# --- temperatura -----------------------------------------------------------

def test_temperatura_ideale_e_fuori():
    regole = COMUNE["temperatura"]
    assert fattore_temperatura(meteo_costante(tmed=20), 20, [16, 24], regole)[0] == 1.0
    assert fattore_temperatura(meteo_costante(tmed=14), 20, [16, 24], regole)[0] == pytest.approx(0.5)
    assert fattore_temperatura(meteo_costante(tmed=8), 20, [16, 24], regole)[0] == 0.0


def test_temperatura_usa_la_media_di_7_giorni():
    meteo = meteo_costante(tmed=20)
    meteo["tmed"][20] = 6  # un giorno freddo solo: la media resta 18
    _, t_rif = fattore_temperatura(meteo, 20, [16, 24], COMUNE["temperatura"])
    assert t_rif == pytest.approx(18)


def meteo_con_calo():
    """Pioggia forte il giorno 14, poi 5 gradi in meno."""
    meteo = meteo_costante(tmed=20)
    meteo["pioggia"][14] = 25
    for g in range(15, 22):
        meteo["tmed"][g] = 15
    return meteo


def test_calo_termico_riconosciuto():
    assert calo_termico_dopo_pioggia(meteo_con_calo(), 20, COMUNE["temperatura"])


def test_nessun_calo_senza_pioggia():
    meteo = meteo_con_calo()
    meteo["pioggia"][14] = 2
    assert not calo_termico_dopo_pioggia(meteo, 20, COMUNE["temperatura"])


def test_nessun_calo_se_la_pioggia_e_troppo_recente():
    # Il giorno 14 è solo 1 giorno prima del 15: fuori dalla finestra (da 10 a 2 giorni prima)
    assert not calo_termico_dopo_pioggia(meteo_con_calo(), 15, COMUNE["temperatura"])


def test_bonus_calo_termico():
    regole = COMUNE["temperatura"]
    # Stesse temperature; l'unica differenza è la pioggia forte prima del calo.
    con_pioggia = meteo_con_calo()
    senza_pioggia = meteo_con_calo()
    senza_pioggia["pioggia"][14] = 0
    # Intervallo 17-25: la media di circa 15,7 gradi sta sulla rampa (fattore < 1)
    senza = fattore_temperatura(senza_pioggia, 20, [17, 25], regole)[0]
    con = fattore_temperatura(con_pioggia, 20, [17, 25], regole)[0]
    assert 0 < senza < 1
    assert con == pytest.approx(senza * 1.10)


# --- habitat ---------------------------------------------------------------

def test_habitat_latifoglie_per_porcini_estivi():
    regole = COMUNE["habitat"]
    habitat = SPECIE["porcini_estivi"]["habitat"]
    assert fattore_habitat({"311": 40, "211": 60}, habitat, regole) == 1.0
    assert fattore_habitat({"313": 50, "211": 50}, habitat, regole) == 0.3
    assert fattore_habitat({"211": 100}, habitat, regole) == 0.0


def test_habitat_sotto_il_15_percento_non_conta():
    habitat = SPECIE["porcini_estivi"]["habitat"]
    assert fattore_habitat({"311": 10, "112": 90}, habitat, COMUNE["habitat"]) == 0.0


def test_bosco_misto_adatto_ai_porcini_autunnali():
    habitat = SPECIE["porcini_autunnali"]["habitat"]
    assert fattore_habitat({"313": 50, "211": 50}, habitat, COMUNE["habitat"]) == 1.0


def test_mazza_di_tamburo_margine_del_bosco():
    regole = COMUNE["habitat"]
    habitat = SPECIE["mazza_di_tamburo"]["habitat"]
    # Solo bosco: parziale
    assert fattore_habitat({"311": 100}, habitat, regole) == 0.3
    # Bosco e seminativi: c'è un margine
    assert fattore_habitat({"311": 50, "211": 50}, habitat, regole) == 1.0
    # Pascolo: adatto
    assert fattore_habitat({"231": 30, "112": 70}, habitat, regole) == 1.0
    # Solo città
    assert fattore_habitat({"111": 100}, habitat, regole) == 0.0


# --- stagione --------------------------------------------------------------

def test_stagione_porcini_estivi():
    sp = SPECIE["porcini_estivi"]
    regole = COMUNE["stagione"]
    valori = [fattore_stagione(m, sp["mesi_centrali"], sp["mesi_margine"], regole)
              for m in range(1, 13)]
    #          gen feb mar apr mag  giu  lug  ago  set  ott  nov dic
    assert valori == [0, 0, 0, 0, 0.5, 1, 1, 1, 1, 0.5, 0, 0]


# --- quota -----------------------------------------------------------------

def test_quota_tutta_nella_fascia():
    assert fattore_quota({"800": 50, "900": 50}, [200, 1200], COMUNE["quota"]) == 1.0


def test_quota_meta_dentro_meta_fuori():
    assert fattore_quota({"900": 50, "1500": 50}, [200, 1200], COMUNE["quota"]) == pytest.approx(0.5)


def test_quota_sulla_rampa():
    # Fascia 1300-1400: centro 1350, 150 m sopra 1200 -> 1 - 150/200 = 0,25
    assert fattore_quota({"1300": 100}, [200, 1200], COMUNE["quota"]) == pytest.approx(0.25)


# --- punteggio completo ----------------------------------------------------

def test_punteggio_condizioni_perfette_fa_100():
    cella = {"corine": {"311": 80, "231": 20}, "fasce_quota": {"800": 100}}
    sp = SPECIE["porcini_estivi"]
    statici = fattori_statici(cella, sp, COMUNE)
    meteo = meteo_costante(pioggia=5, tmed=20)
    assert punteggio(meteo, 20, 8, sp, COMUNE, statici)["S"] == 100


def test_punteggio_fuori_stagione_fa_zero():
    cella = {"corine": {"311": 100}, "fasce_quota": {"800": 100}}
    sp = SPECIE["porcini_estivi"]
    statici = fattori_statici(cella, sp, COMUNE)
    meteo = meteo_costante(pioggia=5, tmed=20)
    assert punteggio(meteo, 20, 1, sp, COMUNE, statici)["S"] == 0


def test_punteggio_e_il_prodotto_dei_fattori():
    cella = {"corine": {"313": 100}, "fasce_quota": {"800": 100}}  # habitat 0,3
    sp = SPECIE["porcini_estivi"]
    statici = fattori_statici(cella, sp, COMUNE)
    meteo = meteo_costante(pioggia=1.07143, tmed=20)  # 15 mm su 30 -> 0,5
    r = punteggio(meteo, 20, 5, sp, COMUNE, statici)  # maggio: margine 0,5
    # 100 x 0,5 (pioggia) x 1 (temp) x 0,3 (habitat) x 0,5 (stagione) x 1 (quota) = 7,5
    assert r["S"] == round(100 * r["pioggia"] * 1 * 0.3 * 0.5 * 1)
    assert r["S"] in (7, 8)


def test_config_tutte_le_specie_complete():
    campi = {"nome", "latino", "mesi_centrali", "mesi_margine", "quota",
             "pioggia_mm", "temperatura", "habitat"}
    for codice, sp in SPECIE.items():
        mancanti = campi - set(sp)
        assert not mancanti, f"{codice}: mancano {mancanti}"
        assert sp["quota"][0] < sp["quota"][1]
        assert sp["temperatura"][0] < sp["temperatura"][1]
        assert not set(sp["mesi_centrali"]) & set(sp["mesi_margine"])
