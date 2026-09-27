"""Test del motore del punteggio.

Si lanciano con:
    .venv\\Scripts\\python -m pytest

Ogni test costruisce un meteo o una sottocella inventati, di cui conosciamo
già il risultato giusto, e controlla che il codice lo ritrovi.
"""

import sys
from pathlib import Path

import pytest

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.griglia import bbox_sottocella  # noqa: E402
from fungometer.punteggio import (  # noqa: E402
    calo_termico_dopo_pioggia,
    campana,
    carica_specie,
    fattore_acqua,
    fattore_habitat,
    fattore_quota,
    fattore_stagione,
    fattore_temperatura,
    fattore_terreno_base,
    fattori_meteo,
    fattori_statici,
    punteggio,
    punteggio_cella,
    rampa,
    terreno_effettivo,
)

CONFIG = carica_specie(RADICE / "config" / "specie.yaml")
COMUNE = CONFIG["comune"]
SPECIE = CONFIG["specie"]
ACQUA = COMUNE["acqua"]
GIORNI = 34  # 26 passati + 8


def meteo_costante(pioggia=0.0, tmed=15.0, tmax=None, suolo=0.2):
    """Meteo inventato: tutti i giorni uguali."""
    return {
        "pioggia": [pioggia] * GIORNI,
        "tmed": [tmed] * GIORNI,
        "tmin": [tmed - 5] * GIORNI,
        "tmax": [tmax if tmax is not None else tmed + 5] * GIORNI,
        "suolo": [suolo] * GIORNI,
    }


# --- curve di base ---------------------------------------------------------

@pytest.mark.parametrize("valore, atteso", [
    (200, 1.0), (700, 1.0), (1200, 1.0),   # dentro la fascia
    (100, 0.5), (1300, 0.5),               # a metà rampa
    (0, 0.0), (1400, 0.0),                 # fuori
])
def test_rampa(valore, atteso):
    assert rampa(valore, 200, 1200, 200) == pytest.approx(atteso)


def test_campana():
    assert campana(13, 13, 10, 18) == pytest.approx(1.0)
    assert campana(17, 13, 10, 18) == pytest.approx(0.6065, abs=1e-3)   # una deviazione
    assert campana(9, 13, 10, 18) == pytest.approx(campana(17, 13, 10, 18))  # simmetrica
    assert campana(5, 13, 10, 18) < 0.15


# --- acqua -----------------------------------------------------------------

def test_acqua_pioggia_e_suolo():
    # 1 mm al giorno per 26 giorni = 26 mm, soglia 52 -> pioggia 0,5
    # suolo 0,225 = metà fra 0,15 e 0,30 -> suolo 0,5
    f, mm, suolo, caldo = fattore_acqua(meteo_costante(pioggia=1, suolo=0.225), 30, 52, ACQUA)
    assert mm == pytest.approx(26)
    assert caldo == 0
    assert f == pytest.approx(0.6 * 0.5 + 0.4 * 0.5)


def test_acqua_conta_solo_gli_ultimi_26_giorni():
    meteo = meteo_costante()
    meteo["pioggia"][0] = 100   # 30 giorni prima del giorno 30: non conta
    meteo["pioggia"][5] = 40    # 25 giorni prima: conta
    _, mm, _, _ = fattore_acqua(meteo, 30, 55, ACQUA)
    assert mm == pytest.approx(40)


def test_acqua_suolo_secco_e_umido():
    secco = fattore_acqua(meteo_costante(pioggia=10, suolo=0.10), 30, 55, ACQUA)[0]
    umido = fattore_acqua(meteo_costante(pioggia=10, suolo=0.35), 30, 55, ACQUA)[0]
    assert secco == pytest.approx(0.6)   # pioggia piena, suolo 0
    assert umido == pytest.approx(1.0)


def test_acqua_senza_dati_del_suolo_usa_solo_la_pioggia():
    meteo = meteo_costante(pioggia=1)
    meteo["suolo"] = [None] * GIORNI
    f, _, suolo, _ = fattore_acqua(meteo, 30, 52, ACQUA)
    assert suolo is None
    assert f == pytest.approx(0.5)


def test_giorni_di_caldo_tolgono_acqua():
    fresco = fattore_acqua(meteo_costante(pioggia=10, suolo=0.35, tmax=25), 30, 55, ACQUA)[0]
    meteo = meteo_costante(pioggia=10, suolo=0.35, tmax=25)
    for g in range(26, 30):          # 4 giorni di caldo nelle ultime 2 settimane
        meteo["tmax"][g] = 33
    caldo = fattore_acqua(meteo, 30, 55, ACQUA)
    assert caldo[3] == 4
    assert caldo[0] == pytest.approx(fresco * 0.8)


def test_caldo_al_massimo_dimezza():
    f, _, _, caldo = fattore_acqua(meteo_costante(pioggia=10, suolo=0.35, tmax=35), 30, 55, ACQUA)
    assert caldo == 14
    assert f == pytest.approx(0.5)


# --- temperatura -----------------------------------------------------------

def test_temperatura_usa_la_media_di_20_giorni():
    meteo = meteo_costante(tmed=13)
    meteo["tmed"][30] = -7   # un giorno freddissimo: la media di 20 giorni scende di 1 grado
    f, t_rif = fattore_temperatura(meteo, 30, SPECIE["porcini_autunnali"], COMUNE["temperatura"])
    assert t_rif == pytest.approx(12)
    assert f == pytest.approx(campana(12, 13, 10, 18))


def test_temperatura_ottimale_vale_uno():
    f, _ = fattore_temperatura(meteo_costante(tmed=13), 30, SPECIE["porcini_autunnali"],
                               COMUNE["temperatura"])
    assert f == pytest.approx(1.0)


def meteo_con_calo():
    """Pioggia forte il giorno 24, poi 5 gradi in meno."""
    meteo = meteo_costante(tmed=20)
    meteo["pioggia"][24] = 25
    for g in range(25, GIORNI):
        meteo["tmed"][g] = 15
    return meteo


def test_calo_termico_riconosciuto():
    assert calo_termico_dopo_pioggia(meteo_con_calo(), 30, COMUNE["temperatura"])


def test_nessun_calo_senza_pioggia():
    meteo = meteo_con_calo()
    meteo["pioggia"][24] = 2
    assert not calo_termico_dopo_pioggia(meteo, 30, COMUNE["temperatura"])


def test_nessun_calo_se_la_pioggia_e_troppo_recente():
    assert not calo_termico_dopo_pioggia(meteo_con_calo(), 25, COMUNE["temperatura"])


def test_bonus_calo_termico():
    regole = COMUNE["temperatura"]
    senza_pioggia = meteo_con_calo()
    senza_pioggia["pioggia"][24] = 0
    sp = SPECIE["porcini_autunnali"]
    senza = fattore_temperatura(senza_pioggia, 30, sp, regole)[0]
    con = fattore_temperatura(meteo_con_calo(), 30, sp, regole)[0]
    assert 0 < senza < 1
    assert con == pytest.approx(min(1, senza * 1.10))


# --- habitat ---------------------------------------------------------------

def test_habitat_tipi_di_bosco():
    regole = COMUNE["habitat"]
    autunnali = SPECIE["porcini_autunnali"]["habitat"]
    assert fattore_habitat({"t1": 60, "c211": 40}, autunnali, regole) == 1.0   # faggeta
    assert fattore_habitat({"t3": 80, "c211": 20}, autunnali, regole) == 0.3   # cerreta: parziale
    assert fattore_habitat({"c211": 100}, autunnali, regole) == 0.0


def test_castagneto_adatto_agli_ovoli_frutteto_no():
    regole = COMUNE["habitat"]
    ovolo = SPECIE["ovolo"]["habitat"]
    assert fattore_habitat({"t2": 50, "c211": 50}, ovolo, regole) == 1.0
    assert fattore_habitat({"c222": 100}, ovolo, regole) == 0.3


def test_habitat_sotto_il_15_percento_non_conta():
    habitat = SPECIE["porcini_estivi"]["habitat"]
    assert fattore_habitat({"t3": 10, "c112": 90}, habitat, COMUNE["habitat"]) == 0.0


def test_mazza_di_tamburo_margine_del_bosco():
    regole = COMUNE["habitat"]
    habitat = SPECIE["mazza_di_tamburo"]["habitat"]
    assert fattore_habitat({"t3": 100}, habitat, regole) == 0.3              # solo bosco
    assert fattore_habitat({"t3": 50, "c211": 50}, habitat, regole) == 1.0   # margine
    assert fattore_habitat({"t11": 30, "c112": 70}, habitat, regole) == 1.0  # prateria
    assert fattore_habitat({"c111": 100}, habitat, regole) == 0.0


# --- stagione, quota, terreno ----------------------------------------------

def test_stagione_porcini_estivi():
    sp = SPECIE["porcini_estivi"]
    valori = [fattore_stagione(m, sp["mesi_centrali"], sp["mesi_margine"], COMUNE["stagione"])
              for m in range(1, 13)]
    #          gen feb mar apr mag  giu  lug  ago  set  ott  nov dic
    assert valori == [0, 0, 0, 0, 0.5, 1, 1, 1, 1, 0.5, 0, 0]


def test_quota_percentili():
    regole = COMUNE["quota"]
    assert fattore_quota([700, 800, 900], [200, 1200], regole) == 1.0
    # 1300 è a metà rampa: (1 + 1 + 0,5) / 3
    assert fattore_quota([1000, 1100, 1300], [200, 1200], regole) == pytest.approx(2.5 / 3)
    assert fattore_quota([1500, 1600, 1700], [200, 1200], regole) == 0.0


def test_terreno_base():
    regole = COMUNE["terreno"]
    assert fattore_terreno_base({"ca": 100}, regole) == pytest.approx(1.0)
    assert fattore_terreno_base({"ca": 50, "cr": 50}, regole) == pytest.approx(0.9)
    assert fattore_terreno_base({}, regole) == 1.0


def test_terreno_conta_meno_quando_e_bagnato():
    regole = COMUNE["terreno"]
    assert terreno_effettivo(0.8, 0.0, regole) == pytest.approx(0.8)   # secco: effetto pieno
    assert terreno_effettivo(0.8, 1.0, regole) == pytest.approx(0.9)   # bagnato: effetto dimezzato


# --- punteggio completo ----------------------------------------------------

SOTTOCELLA_FAGGETA = {"h": {"t1": 90, "c231": 10}, "q": [900, 1000, 1100], "m": {"ca": 100}}


def test_punteggio_condizioni_perfette_fa_100():
    sp = SPECIE["porcini_autunnali"]
    statici = fattori_statici(SOTTOCELLA_FAGGETA, sp, COMUNE)
    mf = fattori_meteo(meteo_costante(pioggia=5, tmed=13, suolo=0.35), 30, 10, sp, COMUNE)
    assert punteggio(mf, statici, COMUNE) == pytest.approx(100)


def test_punteggio_fuori_stagione_fa_zero():
    sp = SPECIE["porcini_autunnali"]
    statici = fattori_statici(SOTTOCELLA_FAGGETA, sp, COMUNE)
    mf = fattori_meteo(meteo_costante(pioggia=5, tmed=13, suolo=0.35), 30, 1, sp, COMUNE)
    assert punteggio(mf, statici, COMUNE) == 0


def test_punteggio_e_il_prodotto_dei_fattori():
    sp = SPECIE["porcini_autunnali"]
    sottocella = {"h": {"t3": 100}, "q": [900, 1000, 1100], "m": {"cr": 100}}  # cerreta, cresta
    statici = fattori_statici(sottocella, sp, COMUNE)
    mf = fattori_meteo(meteo_costante(pioggia=5, tmed=13, suolo=0.35), 30, 11, sp, COMUNE)
    # acqua 1, temperatura 1, stagione 0,5 (novembre), habitat 0,3, quota 1,
    # terreno: cresta 0,8, ma con acqua piena vale 0,9
    assert punteggio(mf, statici, COMUNE) == pytest.approx(100 * 0.5 * 0.3 * 0.9)


def test_punteggio_cella_media_delle_migliori():
    punti = [0] * 27 + [80] * 9   # 36 sottocelle, le 9 migliori a 80
    assert punteggio_cella(punti, COMUNE) == pytest.approx(80)
    assert punteggio_cella([], COMUNE) == 0


def test_sottocelle_coprono_la_cella():
    bbox = [42.0, 12.0, 42.03, 12.04]
    prima, ultima = bbox_sottocella(bbox, 0), bbox_sottocella(bbox, 35)
    assert prima[0] == pytest.approx(42.0) and prima[1] == pytest.approx(12.0)
    assert ultima[2] == pytest.approx(42.03) and ultima[3] == pytest.approx(12.04)


def test_config_tutte_le_specie_complete():
    campi = {"nome", "latino", "mesi_centrali", "mesi_margine", "quota",
             "pioggia_mm", "temperatura", "habitat"}
    for codice, sp in SPECIE.items():
        mancanti = campi - set(sp)
        assert not mancanti, f"{codice}: mancano {mancanti}"
        assert sp["quota"][0] < sp["quota"][1]
        assert sp["temperatura"][0] < sp["temperatura"][1]
        assert not set(sp["mesi_centrali"]) & set(sp["mesi_margine"])
        assert not set(sp["habitat"]["adatte"]) & set(sp["habitat"].get("parziali", []))
