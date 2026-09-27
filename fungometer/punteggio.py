"""Il motore del punteggio di FungoMeter.

Per ogni sottocella da 500 m:
    S = 100 x acqua x temperatura x habitat x stagione x quota x terreno

- acqua e temperatura dipendono dal meteo della cella da 3 km (e dal giorno);
- habitat, quota e terreno dipendono dalla sottocella (e non cambiano);
- stagione dipende solo dalla data.

Ogni funzione qui sotto calcola UN fattore fra 0 e 1. Sono funzioni "pure":
ricevono numeri e restituiscono numeri, senza leggere file né internet.
Così si provano facilmente con pytest (vedi tests/test_punteggio.py).

Il meteo di una cella arriva come dizionario di liste giornaliere, tutte
lunghe uguali e nello stesso ordine di date:
    {"pioggia": [...], "tmin": [...], "tmax": [...], "tmed": [...], "suolo": [...]}
`i` è la posizione del giorno per cui si calcola il punteggio.
"""

import math
from datetime import date

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

    Esempio con basso=200, alto=1200, larghezza=200:
        100 -> 0,5    200 -> 1    1200 -> 1    1300 -> 0,5    1400 o più -> 0
    """
    if basso <= valore <= alto:
        return 1.0
    distanza = basso - valore if valore < basso else valore - alto
    return max(0.0, 1.0 - distanza / larghezza)


def campana(valore, ottimo, basso, alto):
    """Curva a campana: 1 all'ottimo, circa 0,6 ai bordi [basso, alto].

    È una gaussiana con deviazione standard pari a metà dell'intervallo.
    Esempio con ottimo 13 e intervallo 10-18 (deviazione 4):
        13 -> 1    9 o 17 -> 0,61    5 o 21 -> 0,14
    """
    sigma = (alto - basso) / 2
    return math.exp(-0.5 * ((valore - ottimo) / sigma) ** 2)


# ---------------------------------------------------------------------------
# Fattori che dipendono dal meteo (per cella e per giorno)
# ---------------------------------------------------------------------------

def fattore_acqua(meteo, i, soglia_mm, regole):
    """Quanta acqua c'è per i funghi: pioggia recente e umidità del suolo.

    - pioggia: somma degli ultimi 26 giorni, divisa per la soglia della specie
      (da 0 a 1, poi resta 1);
    - suolo: umidità a 7-28 cm, media degli ultimi 3 giorni, da 0 (secco) a 1
      (umido). L'umidità del suolo tiene già conto di quanto evapora: è il
      "bilancio idrico" calcolato dal modello meteo;
    - acqua = 60% pioggia + 40% suolo;
    - ogni giorno con la massima oltre 30 °C nelle ultime 2 settimane toglie il
      5% (al massimo si dimezza): il caldo secca il terreno.
    Restituisce (fattore, pioggia_mm, suolo, giorni_di_caldo).
    """
    pioggia = sum(p or 0 for p in _finestra(meteo["pioggia"], i, regole["giorni_pioggia"]))
    f_pioggia = min(1.0, pioggia / soglia_mm)

    suolo = _media(_finestra(meteo["suolo"], i, regole["giorni_suolo"]))
    if suolo is None:
        # Senza dati sul suolo si usa solo la pioggia
        f_acqua = f_pioggia
    else:
        f_suolo = rampa(suolo, regole["suolo_umido"], 99, regole["suolo_umido"] - regole["suolo_secco"])
        f_acqua = regole["peso_pioggia"] * f_pioggia + regole["peso_suolo"] * f_suolo

    caldo = sum(1 for t in _finestra(meteo["tmax"], i, regole["giorni_caldo"])
                if t is not None and t >= regole["caldo_tmax"])
    f_acqua *= max(regole["minimo_caldo"], 1 - regole["penalita_caldo"] * caldo)
    return f_acqua, pioggia, suolo, caldo


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


def fattore_temperatura(meteo, i, specie, regole):
    """Media delle temperature medie degli ultimi 20 giorni, su una campana
    centrata sulla temperatura ottimale della specie.

    Bonus se dopo una pioggia c'è stato un calo termico.
    Restituisce (fattore, temperatura_di_riferimento).
    """
    t_rif = _media(_finestra(meteo["tmed"], i, regole["giorni_media"]))
    if t_rif is None:
        return 0.0, None
    basso, alto = specie["temperatura"]
    ottimo = specie.get("temperatura_ottimale", (basso + alto) / 2)
    fattore = campana(t_rif, ottimo, basso, alto)
    if calo_termico_dopo_pioggia(meteo, i, regole):
        fattore = min(1.0, fattore * (1 + regole["bonus_calo"]))
    return fattore, t_rif


def _primo_del_mese(anno, mese):
    """Primo giorno del mese; accetta anche mesi oltre dicembre o prima di gennaio."""
    anno += (mese - 1) // 12
    return date(anno, (mese - 1) % 12 + 1, 1)


def fattore_stagione(giorno, mesi_centrali, mesi_margine):
    """Quanto il giorno è dentro la stagione della specie, in modo graduale.

    - nei mesi centrali vale 1;
    - nei mesi di margine sale (prima della stagione) o scende (dopo) in linea
      retta: per i porcini estivi, con ottobre di margine, vale circa 1 il
      1° ottobre, 0,5 a metà mese e quasi 0 il 31;
    - fuori vale 0.
    In media un mese di margine vale 0,5, ma senza salti da un giorno all'altro.
    `giorno` è una data (datetime.date).
    """
    if not mesi_centrali:
        return 0.0
    anno = giorno.year
    primo, ultimo = min(mesi_centrali), max(mesi_centrali)
    inizio = _primo_del_mese(anno, primo)          # primo giorno della stagione piena
    fine = _primo_del_mese(anno, ultimo + 1)       # primo giorno dopo la stagione piena
    if inizio <= giorno < fine:
        return 1.0

    # Quanti mesi di margine ci sono subito prima e subito dopo
    prima = 0
    while (primo - prima - 1 - 1) % 12 + 1 in mesi_margine and prima < 12:
        prima += 1
    dopo = 0
    while (ultimo + dopo) % 12 + 1 in mesi_margine and dopo < 12:
        dopo += 1

    if giorno < inizio:
        if not prima:
            return 0.0
        partenza = _primo_del_mese(anno, primo - prima)
        return max(0.0, min(1.0, (giorno - partenza).days / (inizio - partenza).days))
    if not dopo:
        return 0.0
    arrivo = _primo_del_mese(anno, ultimo + 1 + dopo)
    return max(0.0, min(1.0, (arrivo - giorno).days / (arrivo - fine).days))


# ---------------------------------------------------------------------------
# Fattori della sottocella (non cambiano di giorno in giorno)
# ---------------------------------------------------------------------------

def fattore_habitat(uso, habitat, regole):
    """Quanto l'ambiente della sottocella è adatto alla specie.

    `uso` è {ambiente: percentuale}, es. {"t8": 55, "c211": 30}
    (t = tipo di bosco dalle carte regionali, c = classe Corine).
    Conta solo un ambiente che copre almeno il 15% della sottocella:
        adatto -> 1;  parziale -> 0,3;  altro -> 0.
    Per la mazza di tamburo c'è anche la regola del "margine" (bosco + aperto).
    """
    minimo = regole["quota_minima_cella"]
    presenti = {a for a, perc in uso.items() if perc >= minimo}

    if presenti & set(habitat.get("adatte", [])):
        return 1.0

    margine = habitat.get("margine")
    if margine:
        bosco = sum(perc for a, perc in uso.items() if a in margine["bosco"])
        aperto = sum(perc for a, perc in uso.items() if a in margine["aperto"])
        if bosco >= minimo and aperto >= minimo:
            return 1.0

    if presenti & set(habitat.get("parziali", [])):
        return regole["peso_parziale"]
    return 0.0


def fattore_quota(quote, fascia_ideale, regole):
    """Quota della sottocella rispetto alla fascia ideale della specie.

    `quote` sono il 10°, 50° e 90° percentile della quota della sottocella:
    il fattore è la media della rampa su questi tre valori, così una
    sottocella a cavallo del limite vale una via di mezzo.
    """
    valori = [rampa(q, fascia_ideale[0], fascia_ideale[1], regole["rampa"]) for q in quote]
    return sum(valori) / len(valori)


def fattore_terreno_base(forme, regole):
    """Media dei pesi delle forme del terreno della sottocella.

    `forme` è {forma: percentuale}, es. {"ca": 20, "vn": 50, "cr": 30}.
    """
    totale = sum(forme.values())
    if totale == 0:
        return 1.0
    return sum(perc * regole["pesi"].get(f, 1.0) for f, perc in forme.items()) / totale


def terreno_effettivo(base, f_acqua, regole):
    """Il terreno conta di più quando è secco.

    Con acqua 0 vale il fattore base; con acqua 1 la differenza da 1 si riduce
    di `effetto_se_bagnato` (a metà, con il valore predefinito).
    """
    return 1 - (1 - base) * (1 - regole["effetto_se_bagnato"] * f_acqua)


# ---------------------------------------------------------------------------
# Il punteggio finale
# ---------------------------------------------------------------------------

def fattori_statici(sottocella, specie, comune):
    """Habitat, quota e terreno di una sottocella per una specie."""
    return {
        "habitat": fattore_habitat(sottocella["h"], specie["habitat"], comune["habitat"]),
        "quota": fattore_quota(sottocella["q"], specie["quota"], comune["quota"]),
        "terreno": fattore_terreno_base(sottocella["m"], comune["terreno"]),
    }


def fattori_meteo(meteo, i, giorno, specie, comune):
    """Acqua, temperatura e stagione di una cella per un giorno e una specie.

    `giorno` è la data (datetime.date) corrispondente alla posizione i.
    """
    f_acqua, pioggia, suolo, caldo = fattore_acqua(meteo, i, specie["pioggia_mm"], comune["acqua"])
    f_temp, t_rif = fattore_temperatura(meteo, i, specie, comune["temperatura"])
    f_stagione = fattore_stagione(giorno, specie["mesi_centrali"], specie["mesi_margine"])
    return {
        "acqua": f_acqua, "temperatura": f_temp, "stagione": f_stagione,
        "pioggia_mm": pioggia, "suolo": suolo, "caldo": caldo, "t_rif": t_rif,
    }


def punteggio(meteo_f, statici, comune):
    """Punteggio 0-100 (decimale) di una sottocella, dati i fattori già calcolati."""
    terreno = terreno_effettivo(statici["terreno"], meteo_f["acqua"], comune["terreno"])
    return (100 * meteo_f["acqua"] * meteo_f["temperatura"] * meteo_f["stagione"]
            * statici["habitat"] * statici["quota"] * terreno)


def punteggio_cella(punteggi_sottocelle, comune):
    """Punteggio di una cella: media del 25% di sottocelle migliori.

    Così una cella con un bel bosco in un angolo non sparisce solo perché
    il resto è campo coltivato.
    """
    if not punteggi_sottocelle:
        return 0.0
    ordinati = sorted(punteggi_sottocelle, reverse=True)
    n = max(1, round(len(ordinati) * comune["cella"]["quota_migliori"] / 100))
    return sum(ordinati[:n]) / n
