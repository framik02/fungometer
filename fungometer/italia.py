"""La griglia di tutta Italia e il modello delle sue celle.

L'Italia è divisa in riquadri di mezzo grado (circa 55 x 40 km). Ogni
riquadro ha una sua griglia di celle da circa 3 km, divise come sempre in
6 x 6 quadrati da 500 m, ed è un'"area" dell'app: si scarica solo quando la
mappa lo mostra.

Il meteo, per stare nel limite gratuito di Open-Meteo, si chiede per gruppi di
5 x 5 celle (circa 15 km). Dentro un gruppo le celle non sono tutte uguali:
- la temperatura si corregge con la quota della cella (0,65 °C ogni 100 m,
  il gradiente medio dell'atmosfera), e con lei la campana della temperatura
  e le notti di gelo;
- il calendario della stagione si sposta con la quota della cella, come per
  Foligno e Roma;
- pioggia, umidità del suolo e giorni di caldo restano quelli del gruppo.

Le stesse formule stanno in docs/app.js (funzione fattoriCellaItalia): l'app
le rifà per ogni cella partendo dal riassunto del gruppo, così ogni giorno si
pubblica solo il meteo dei gruppi e non quello di ventimila celle.
"""

import math

from fungometer.punteggio import _finestra, _media, calo_termico_dopo_pioggia, campana, fattore_gelo, \
    fattore_stagione, rampa

KM_PER_GRADO_LAT = 111.32
LATO_RIQUADRO = 0.5          # gradi
LATO_CELLA_KM = 3
CELLE_PER_GRUPPO = 5         # 5 x 5 celle = un punto meteo ogni 15 km circa
GRADIENTE_TERMICO = 0.0065   # °C per metro

# Rettangolo che contiene l'Italia (isole comprese)
SUD, NORD, OVEST, EST = 35.5, 47.1, 6.5, 18.6

# Giorni di tmin che l'app riceve per ogni giorno mostrato: la settimana
# prima (per le notti di gelo). Con 8 giorni mostrati sono 14 valori.
GIORNI_GELO = 7


def codice_riquadro(sud, ovest):
    """Es. sud 42.5, ovest 12.0 -> "i4250n1200". Senza trattini bassi: l'app
    ricava l'area dall'id della cella tagliando al primo "_"."""
    return f"i{round(sud * 100):04d}n{round(ovest * 100):04d}"


def riquadri():
    """Tutti i riquadri del rettangolo dell'Italia: (codice, sud, ovest)."""
    elenco = []
    lat = SUD
    while lat < NORD:
        lon = OVEST
        while lon < EST:
            elenco.append((codice_riquadro(lat, lon), lat, lon))
            lon = round(lon + LATO_RIQUADRO, 4)
        lat = round(lat + LATO_RIQUADRO, 4)
    return elenco


def passi_riquadro(sud):
    """Righe e colonne di celle in un riquadro: celle di circa 3 x 3 km."""
    righe = round(LATO_RIQUADRO * KM_PER_GRADO_LAT / LATO_CELLA_KM)
    lat_centrale = sud + LATO_RIQUADRO / 2
    colonne = round(LATO_RIQUADRO * KM_PER_GRADO_LAT * math.cos(math.radians(lat_centrale)) / LATO_CELLA_KM)
    return righe, colonne


def celle_riquadro(codice, sud, ovest):
    """Le celle di un riquadro, nello stesso formato di fungometer.griglia."""
    righe, colonne = passi_riquadro(sud)
    passo_lat = LATO_RIQUADRO / righe
    passo_lon = LATO_RIQUADRO / colonne
    celle = []
    for r in range(righe):
        for c in range(colonne):
            c_sud = sud + r * passo_lat
            c_ovest = ovest + c * passo_lon
            celle.append({
                "id": f"{codice}_{r:03d}_{c:03d}",
                "area": codice,
                "zona_id": codice,
                "lat": round(c_sud + passo_lat / 2, 5),
                "lon": round(c_ovest + passo_lon / 2, 5),
                "bbox": [round(c_sud, 6), round(c_ovest, 6),
                         round(c_sud + passo_lat, 6), round(c_ovest + passo_lon, 6)],
                "gruppo": f"{codice}_g{r // CELLE_PER_GRUPPO}_{c // CELLE_PER_GRUPPO}",
            })
    return celle


# ---------------------------------------------------------------------------
# Il modello delle celle d'Italia (lo stesso in docs/app.js)
# ---------------------------------------------------------------------------

def riassunto_gruppo(meteo, i, comune):
    """Quello che serve all'app per un giorno i di un gruppo.

    p = pioggia degli ultimi 26 giorni (mm), u = umidità media del suolo
    degli ultimi 3 giorni, k = giorni oltre 30 °C nelle ultime 2 settimane,
    tr = temperatura media degli ultimi 20 giorni (alla quota del gruppo),
    c = 1 se dopo una pioggia c'è stato un calo termico, tn e tx = minima e
    massima del giorno.
    """
    acqua = comune["acqua"]
    pioggia = sum(v or 0 for v in _finestra(meteo["pioggia"], i, acqua["giorni_pioggia"]))
    suolo = _media(_finestra(meteo["suolo"], i, acqua["giorni_suolo"]))
    caldo = sum(1 for t in _finestra(meteo["tmax"], i, acqua["giorni_caldo"])
                if t is not None and t >= acqua["caldo_tmax"])
    t_rif = _media(_finestra(meteo["tmed"], i, comune["temperatura"]["giorni_media"]))
    calo = calo_termico_dopo_pioggia(meteo, i, comune["temperatura"])
    return {"p": pioggia, "u": suolo, "k": caldo, "tr": t_rif, "c": 1 if calo else 0,
            "tn": meteo["tmin"][i], "tx": meteo["tmax"][i]}


def fattore_acqua_riassunto(pioggia, suolo, caldo, soglia_mm, regole):
    """Come punteggio.fattore_acqua, ma da pioggia, suolo e caldo già sommati."""
    f_pioggia = min(1.0, pioggia / soglia_mm)
    if suolo is None:
        f_acqua = f_pioggia
    else:
        f_suolo = rampa(suolo, regole["suolo_umido"], 99, regole["suolo_umido"] - regole["suolo_secco"])
        f_acqua = regole["peso_pioggia"] * f_pioggia + regole["peso_suolo"] * f_suolo
    return f_acqua * max(regole["minimo_caldo"], 1 - regole["penalita_caldo"] * caldo)


def fattori_cella_italia(r, tmin_settimana, quota_cella, quota_gruppo, giorno, specie, comune):
    """Acqua, temperatura e stagione di una cella d'Italia per un giorno e una specie.

    `r` è il riassunto del gruppo per quel giorno (riassunto_gruppo);
    `tmin_settimana` sono le minime del gruppo negli ultimi 7 giorni, giorno compreso.
    """
    scarto = -GRADIENTE_TERMICO * (quota_cella - quota_gruppo)
    f_acqua = fattore_acqua_riassunto(r["p"], r["u"], r["k"], specie["pioggia_mm"], comune["acqua"])

    if r["tr"] is None:
        f_temp = 0.0
    else:
        basso, alto = specie["temperatura"]
        ottimo = specie.get("temperatura_ottimale", (basso + alto) / 2)
        f_temp = campana(r["tr"] + scarto, ottimo, basso, alto)
        if r["c"]:
            f_temp = min(1.0, f_temp * (1 + comune["temperatura"]["bonus_calo"]))

    f_stagione = fattore_stagione(giorno, specie["mesi_centrali"], specie["mesi_margine"],
                                  quota_cella, comune.get("stagione"))
    gelo = comune["gelo"]
    notti = sum(1 for t in tmin_settimana if t is not None and t + scarto <= gelo["soglia_tmin"])
    f_stagione *= fattore_gelo(notti, gelo)
    return {"acqua": f_acqua, "temperatura": f_temp, "stagione": f_stagione, "gelo": notti}
