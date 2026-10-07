# Preferiti e copertura — 6 ottobre 2026

- La scheda conserva un elemento DOM invece di una stringa: gli aggiornamenti
  di Leaflet non cancellano più il pulsante dei preferiti e i suoi eventi.
- Aprire l'elenco dei preferiti chiude la scheda, che prima nascondeva l'elenco.
- La preparazione nazionale scarta soltanto celle interamente coperte dall'unione
  delle celle locali, non quelle con il solo centro coperto. Il vecchio criterio
  lasciava strisce lungo i confini delle aree di Foligno e Roma.
- Verificati 153 candidati in nove riquadri e recuperate 145 celle da 3 km,
  ciascuna con i propri quadrati da circa 500 m. Otto restano escluse dai normali
  filtri di terreno e habitat. Tutti i valori già pubblicati sono conservati.
- Cinque gruppi meteo aggiunti usano coordinate e quota di punti previsionali
  esistenti. La distanza massima delle celle da questi punti è 19,36 km.
  Le coordinate sono nel registro usato dagli aggiornamenti successivi.
- I dati locali sono visualizzati sopra la copertura nazionale, anche quando
  quest'ultima viene caricata dopo. I vuoti legittimi e gli errori di caricamento
  hanno messaggi distinti; nessun punteggio è inventato per riempire i vuoti.

Riparazione ripetibile con `scripts/ripara_giunzioni.py --cache-dir <data/raw>`
e le dipendenze di `requirements-prepare.txt`. La cache indicata è solo letta.
Il rapporto dettagliato è scritto in `output/riparazione-giunzioni.json`.

Validazione: 53 test Python, 46 test del servizio; audit di 224 riquadri,
30.848 celle e riferimenti meteo completi. Controllo visivo di Foligno,
Camaldoli e Roma, oltre al controllo dei confini tramite geometrie.

Pubblicata la versione Cloudflare `07016611-8a76-466f-b3b8-4e773cf4f4b3`.
Collaudo online dei preferiti: creazione, apertura dell'elenco con scheda
aperta, permanenza dopo il ricaricamento, riapertura e rimozione del solo
posto di collaudo. Verificati anche i vincoli di accesso e la modalità test.
