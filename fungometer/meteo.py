"""Scarica il meteo giornaliero da Open-Meteo (gratuito, senza chiave).

Due servizi con lo stesso formato:
- previsioni: api.open-meteo.com, con past_days (giorni passati) e
  forecast_days (oggi + giorni futuri);
- storico: historical-forecast-api.open-meteo.com, con start_date e end_date.
  È l'archivio delle previsioni passate (dal 2022): stessi modelli e stessa
  scala dei dati di ogni giorno, così la prova sugli anni passati è onesta.
  (L'altro archivio, ERA5, misura l'umidità del suolo su una scala diversa.)

Per non fare 900 richieste, si chiedono più celle alla volta (un "lotto"):
Open-Meteo accetta liste di coordinate separate da virgole.

Limiti del piano gratuito: 600 chiamate al minuto, 5.000 all'ora,
10.000 al giorno. Una località con più di 14 giorni di dati conta come
più di una chiamata (34 giorni = circa 2,4). Per questo fra un lotto e
l'altro si aspetta qualche secondo.
"""

import time
from datetime import date

import requests

URL_PREVISIONI = "https://api.open-meteo.com/v1/forecast"
URL_STORICO = "https://historical-forecast-api.open-meteo.com/v1/forecast"

# Nomi delle variabili Open-Meteo e nomi corti usati nel resto del codice.
VARIABILI = {
    "precipitation_sum": "pioggia",
    "temperature_2m_min": "tmin",
    "temperature_2m_max": "tmax",
    "temperature_2m_mean": "tmed",
    # Umidità del suolo fra 7 e 28 cm, dove vive il micelio
    "soil_moisture_7_to_28cm_mean": "suolo",
}

CELLE_PER_LOTTO = 50
PAUSA_FRA_LOTTI = 15  # secondi: 50 celle x 2,4 = 120 chiamate ogni 15 s, cioè 480 al minuto (limite 600)

# Limite orario: 5.000 chiamate. Ne teniamo un po' di margine e contiamo le
# chiamate fatte nell'ultima ora da tutte le richieste dello script (Foligno,
# Roma e i gruppi d'Italia): se il prossimo lotto supererebbe il tetto, si
# aspetta che le chiamate più vecchie escano dalla finestra di un'ora.
TETTO_ORARIO = 4700
_registro = []   # (istante, chiamate) dei lotti dell'ultima ora


def _costo(n_localita, giorni, n_variabili):
    """Quante chiamate conta Open-Meteo per un lotto."""
    return n_localita * max(1.0, giorni / 14) * max(1.0, n_variabili / 10)


def _aspetta_il_tetto(chiamate):
    """Aspetta finché il lotto entra nel tetto orario."""
    while True:
        adesso = time.monotonic()
        _registro[:] = [(t, c) for t, c in _registro if adesso - t < 3600]
        usate = sum(c for _, c in _registro)
        if usate + chiamate <= TETTO_ORARIO:
            _registro.append((adesso, chiamate))
            return
        attesa = 3600 - (adesso - _registro[0][0]) + 1
        print(f"  tetto orario di Open-Meteo: {usate:.0f} chiamate nell'ultima ora, aspetto {attesa:.0f} s")
        time.sleep(attesa)

# Di solito Open-Meteo risponde in circa un secondo. Ogni tanto una richiesta
# resta appesa senza risposta: meglio abbandonarla presto e riprovare.
ATTESA_CONNESSIONE = 10  # secondi per aprire la connessione
ATTESA_RISPOSTA = 30     # secondi per ricevere la risposta


def _chiedi(url, parametri, tentativi=6):
    """Fa una richiesta GET con tentativi ripetuti.

    - errore 429 (troppe richieste): aspetta un minuto e riprova;
    - errori di rete o del server (5xx): aspetta sempre di più e riprova;
    - errori 400 (richiesta sbagliata): inutile riprovare, si ferma subito.
    """
    for tentativo in range(1, tentativi + 1):
        try:
            risposta = requests.get(
                url, params=parametri, timeout=(ATTESA_CONNESSIONE, ATTESA_RISPOSTA)
            )
            if risposta.status_code == 429:
                print(f"  troppe richieste, aspetto 60 s (tentativo {tentativo})")
                time.sleep(60)
                continue
            if 400 <= risposta.status_code < 500:
                raise ValueError(f"Richiesta rifiutata da Open-Meteo: {risposta.text[:300]}")
            risposta.raise_for_status()
            dati = risposta.json()
            # Con una sola località Open-Meteo restituisce un dizionario,
            # con più località una lista: la rendiamo sempre una lista.
            return dati if isinstance(dati, list) else [dati]
        except requests.RequestException as errore:
            attesa = 5 * tentativo
            # Solo l'inizio del messaggio: l'indirizzo completo è lunghissimo
            print(f"  errore di rete ({str(errore).split(' for url')[0][:120]}), riprovo fra {attesa} s")
            time.sleep(attesa)
    raise RuntimeError(f"Open-Meteo non risponde dopo {tentativi} tentativi")


def scarica_meteo(celle, past_days=None, forecast_days=None,
                  start_date=None, end_date=None):
    """Scarica il meteo giornaliero di tutte le celle.

    Si usa in due modi:
        scarica_meteo(celle, past_days=26, forecast_days=8)            # previsioni
        scarica_meteo(celle, start_date="2024-09-01", end_date="2024-11-30")  # storico

    Restituisce (date, meteo_per_cella):
        date = ["2026-09-13", ...]
        meteo_per_cella = {id_cella: {"pioggia": [...], "tmin": [...], ...}}
    """
    storico = start_date is not None
    url = URL_STORICO if storico else URL_PREVISIONI

    date = None
    meteo_per_cella = {}
    lotti = [celle[k: k + CELLE_PER_LOTTO] for k in range(0, len(celle), CELLE_PER_LOTTO)]

    for n, lotto in enumerate(lotti, start=1):
        parametri = {
            "latitude": ",".join(str(c["lat"]) for c in lotto),
            "longitude": ",".join(str(c["lon"]) for c in lotto),
            # La quota media della cella: Open-Meteo corregge la temperatura
            # per questa quota invece che per quella del punto centrale.
            "elevation": ",".join(str(c["quota"]["media"]) for c in lotto),
            "daily": ",".join(VARIABILI),
            "timezone": "Europe/Rome",
        }
        if storico:
            parametri.update(start_date=start_date, end_date=end_date)
        else:
            parametri.update(past_days=past_days, forecast_days=forecast_days)

        if storico:
            giorni = (date.fromisoformat(end_date) - date.fromisoformat(start_date)).days + 1
        else:
            giorni = past_days + forecast_days
        _aspetta_il_tetto(_costo(len(lotto), giorni, len(VARIABILI)))
        partenza = time.monotonic()
        risultati = _chiedi(url, parametri)
        durata = time.monotonic() - partenza
        if len(risultati) != len(lotto):
            raise RuntimeError("Open-Meteo ha restituito un numero sbagliato di località")

        for cella, risultato in zip(lotto, risultati):
            giornaliero = risultato["daily"]
            if date is None:
                date = giornaliero["time"]
            meteo_per_cella[cella["id"]] = {
                corto: giornaliero.get(lungo) or [None] * len(date)
                for lungo, corto in VARIABILI.items()
            }

        print(f"  meteo: lotto {n}/{len(lotti)} in {durata:.1f} s")
        if n < len(lotti):
            time.sleep(PAUSA_FRA_LOTTI)

    return date, meteo_per_cella
