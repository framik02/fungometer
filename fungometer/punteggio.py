"""Il motore del punteggio di FungoMeter.

S = 100 x f_pioggia x f_temperatura x f_habitat x f_stagione x f_quota

Ogni funzione qui sotto calcola UN fattore fra 0 e 1. Sono funzioni "pure":
ricevono numeri e restituiscono numeri, senza leggere file né internet.
Così si provano facilmente con pytest (vedi tests/test_punteggio.py).

Il meteo di una cella arriva come dizionario di liste giornaliere, tutte
lunghe uguali e nello stesso ordine di date:
    {"pioggia": [...], "tmin": [...], "tmax": [...], "tmed": [...], "suolo": [...]}
`i` è la posizione del giorno per cui si calcola il punteggio.
"""

from pathlib import Path

import yaml


def carica_specie(percorso):
    """Legge config/specie.yaml."""
    with open(percorso, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _media(valori):
    """Media che ignora i valori mancanti (None). None se non resta niente."""
    validi = [v for v in valori if v is not None]
    return sum(validi) / len(validi) if validi else None


def _finestra(lista, i, giorni):
    """Gli ultimi `giorni` valori fino alla posizione i compresa."""
    return lista[max(0, i - giorni + 1): i + 1]


def rampa(valore, basso, alto, larghezza):
    """1 dentro [basso, alto], scende in linea retta a 0 entro `larghezza` fuori.

    Esempio con basso=16, alto=24, larghezza=4:
        14 -> 0,5    16 -> 1    24 -> 1    26 -> 0,5    28 o più -> 0
    """
    if basso <= valore <= alto:
        return 1.0
    distanza = basso - valore if valore < basso else valore - alto
    return max(0.0, 1.0 - distanza / larghezza)


# ---------------------------------------------------------------------------
# I cinque fattori
# ---------------------------------------------------------------------------

def fattore_pioggia(meteo, i, soglia_mm, regole):
    """Pioggia cumulata in N giorni, divisa per la soglia della specie.

    La finestra finisce `ritardo` giorni prima di i: con giorni=14 e
    ritardo=3 si somma la pioggia caduta da 17 a 3 giorni prima.
    Sale in linea retta da 0 (niente pioggia) a 1 (soglia raggiunta).
    Se il suolo è umido si aggiunge un piccolo bonus (sempre fino a 1).
    Restituisce (fattore, pioggia_mm).
    """
    fine = i - regole.get("ritardo", 0)
    pioggia = sum(p or 0 for p in _finestra(meteo["pioggia"], fine, regole["giorni"]))
    fattore = min(1.0, pioggia / soglia_mm)

    suolo = _media(_finestra(meteo["suolo"], i, regole["giorni_suolo"]))
    if suolo is not None and suolo >= regole["soglia_suolo"]:
        fattore = min(1.0, fattore * (1 + regole["bonus_suolo"]))
    return fattore, pioggia


def calo_termico_dopo_pioggia(meteo, i, regole):
    """Vero se, qualche giorno fa, una pioggia è stata seguita da un calo termico.

    Cerca un giorno p fra `cerca_da_giorni` e `cerca_fino_a_giorni` prima di i
    con almeno `pioggia_minima_calo` mm; confronta la temperatura media dei
    3 giorni dopo p con quella dei 3 giorni prima.
    """
    for p in range(i - regole["cerca_da_giorni"], i - regole["cerca_fino_a_giorni"] + 1):
        if p - 3 < 0:
            continue
        if (meteo["pioggia"][p] or 0) < regole["pioggia_minima_calo"]:
            continue
        prima = _media(meteo["tmed"][p - 3: p])
        dopo = _media(meteo["tmed"][p + 1: min(p + 4, i + 1)])
        if prima is not None and dopo is not None and prima - dopo >= regole["calo_minimo"]:
            return True
    return False


def fattore_temperatura(meteo, i, intervallo, regole):
    """Media delle temperature medie degli ultimi N giorni, confrontata con
    l'intervallo ideale della specie (rampa di 4 °C fuori).

    Bonus se dopo una pioggia c'è stato un calo termico.
    Restituisce (fattore, temperatura_di_riferimento).
    """
    t_rif = _media(_finestra(meteo["tmed"], i, regole["giorni_media"]))
    if t_rif is None:
        return 0.0, None
    fattore = rampa(t_rif, intervallo[0], intervallo[1], regole["rampa"])
    if fattore > 0 and calo_termico_dopo_pioggia(meteo, i, regole):
        fattore = min(1.0, fattore * (1 + regole["bonus_calo"]))
    return fattore, t_rif


def fattore_habitat(corine, habitat, regole):
    """Quanto l'uso del suolo della cella è adatto alla specie.

    `corine` è {codice: percentuale della cella}, es. {"311": 52, "222": 23}.
    Conta solo una classe che copre almeno il 15% della cella:
        classe adatta -> 1;  classe parziale (es. bosco misto) -> 0,3;  altro -> 0.
    Si prende il valore migliore fra le classi presenti.
    Per la mazza di tamburo c'è anche la regola del "margine" (bosco + aperto).
    """
    minimo = regole["quota_minima_cella"]
    presenti = {int(c) for c, perc in corine.items() if perc >= minimo}

    if presenti & set(habitat.get("adatte", [])):
        return 1.0

    margine = habitat.get("margine")
    if margine:
        bosco = sum(perc for c, perc in corine.items() if int(c) in margine["bosco"])
        aperto = sum(perc for c, perc in corine.items() if int(c) in margine["aperto"])
        if bosco >= minimo and aperto >= minimo:
            return 1.0

    if presenti & set(habitat.get("parziali", [])):
        return regole["peso_parziale"]
    return 0.0


def fattore_stagione(mese, mesi_centrali, mesi_margine, regole):
    """1 nei mesi centrali, 0,5 in quelli di margine, 0 fuori stagione."""
    if mese in mesi_centrali:
        return 1.0
    if mese in mesi_margine:
        return regole["peso_margine"]
    return 0.0


def fattore_quota(fasce_quota, fascia_ideale, regole):
    """Quanto della cella sta nella fascia di quota ideale.

    `fasce_quota` è {inizio fascia da 100 m: percentuale}, es. {"700": 14}.
    Ogni fascia vale la rampa calcolata sul suo centro (700 -> 750 m);
    il fattore è la media pesata sulle percentuali.
    Esempio: metà cella a 900 m (ideale) e metà a 1500 m (fuori) -> 0,5.
    """
    totale = sum(fasce_quota.values())
    if totale == 0:
        return 0.0
    somma = 0.0
    for inizio, perc in fasce_quota.items():
        centro = int(inizio) + 50
        somma += perc * rampa(centro, fascia_ideale[0], fascia_ideale[1], regole["rampa"])
    return somma / totale


# ---------------------------------------------------------------------------
# Il punteggio finale
# ---------------------------------------------------------------------------

def fattori_statici(cella, specie, comune):
    """Habitat e quota non cambiano di giorno in giorno: si calcolano una volta."""
    return {
        "habitat": fattore_habitat(cella["corine"], specie["habitat"], comune["habitat"]),
        "quota": fattore_quota(cella["fasce_quota"], specie["quota"], comune["quota"]),
    }


def punteggio(meteo, i, mese, specie, comune, statici):
    """Calcola il punteggio di una specie in una cella per il giorno i.

    Restituisce un dizionario con il punteggio (0-100, intero) e i fattori,
    che servono all'app per spiegare il numero.
    """
    f_pioggia, pioggia_mm = fattore_pioggia(meteo, i, specie["pioggia_mm"], comune["pioggia"])
    f_temp, t_rif = fattore_temperatura(meteo, i, specie["temperatura"], comune["temperatura"])
    f_stagione = fattore_stagione(
        mese, specie["mesi_centrali"], specie["mesi_margine"], comune["stagione"]
    )
    s = 100 * f_pioggia * f_temp * statici["habitat"] * f_stagione * statici["quota"]
    return {
        "S": round(s),
        "pioggia": f_pioggia,
        "temperatura": f_temp,
        "habitat": statici["habitat"],
        "stagione": f_stagione,
        "quota": statici["quota"],
        "pioggia_mm": pioggia_mm,
        "t_rif": t_rif,
    }


if __name__ == "__main__":
    # Prova veloce con un meteo inventato: python -m fungometer.punteggio
    radice = Path(__file__).resolve().parent.parent
    config = carica_specie(radice / "config" / "specie.yaml")
    meteo = {
        "pioggia": [0] * 10 + [20, 15] + [0] * 4,
        "tmed": [20] * 11 + [15] * 5,
        "tmin": [12] * 16, "tmax": [25] * 16, "suolo": [0.35] * 16,
    }
    cella = {"corine": {"311": 60, "231": 40}, "fasce_quota": {"900": 50, "1000": 50}}
    for codice, sp in config["specie"].items():
        statici = fattori_statici(cella, sp, config["comune"])
        print(codice, punteggio(meteo, 15, 10, sp, config["comune"], statici)["S"])
