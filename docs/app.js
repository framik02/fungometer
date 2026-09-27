/*
 * FungoMeter: la logica della mappa.
 *
 * La mappa è fatta di quadrati da 500 m. Per ogni zona i quadrati sono
 * dipinti su una piccola immagine (un pixel = un quadrato) posata sulla mappa:
 * da lontano il browser sfuma i pixel e si vede un gradiente, da vicino i
 * pixel diventano quadrati netti. Toccando la mappa si apre la scheda del
 * quadrato toccato.
 *
 * Dati:
 *   data/celle.json        le celle da 3 km (forma, zona)
 *   data/punteggi.json     meteo e fattori di ogni cella, per 8 giorni
 *   data/statiche.json     6 numeri per quadrato: bastano per colorare
 *   data/sottocelle/*.json schede complete, scaricate solo quando servono
 *
 * JavaScript semplice, senza framework: si legge dall'alto in basso.
 */

"use strict";

// ---------------------------------------------------------------------------
// Stato dell'app: quello che l'utente ha scelto e i dati caricati
// ---------------------------------------------------------------------------

const stato = {
  celle: [],            // da celle.json
  cellePerId: {},       // id -> cella
  cellaInGriglia: {},   // "area:riga:colonna" -> cella
  aree: {},             // area -> geometria della griglia (origine e passo dei quadrati)
  zone: {},             // zona -> immagine, confini, celle
  punteggi: null,       // da punteggi.json
  statiche: null,       // da statiche.json
  schede: {},           // zona -> schede complete dei quadrati (scaricate quando servono)
  scelte: [0],          // posizioni delle specie scelte (in punteggi.specie)
  giorno: 0,            // posizione del giorno scelto in punteggi.giorni
  selezione: new Set(), // quadrati selezionati, come "area:R:C" (R, C in quadrati da 500 m)
  selezionando: false,  // modalità Seleziona attiva?
  stratoSelezione: null,
  evidenziato: null,    // bordo del quadrato di cui è aperta la scheda
  canaloni: null,
  indiceCanaloni: null,
  area: null,
};

const N = 6;                 // quadrati da 500 m per lato di una cella da 3 km
const DATI_PER_QUADRATO = 6; // in statiche.json: habitat x quota per 5 specie, poi terreno
const VUOTO = 255;           // in statiche.json: quadrato d'acqua, senza dati
const ZOOM_NETTO = 13;       // da qui in su i quadrati si vedono netti
const ZOOM_MASSIMI = 12;     // sotto questo ogni pixel prende il migliore dei vicini
const GIORNO_INCERTO = 5;    // i giorni da +5 in poi sono previsioni poco affidabili
const QUADRATI_INDICE = 10;  // quanti quadrati entrano nell'indice del giorno

let mappa;
let segnaPosizione = null;

// Nomi dei tipi di bosco delle carte regionali (codici t1..t11)
const TIPI_BOSCO = {
  1: "Faggeta", 2: "Castagneto", 3: "Cerreta", 4: "Querceto (roverella, farnia)",
  5: "Lecceta o sughereta", 6: "Pineta o conifere", 7: "Ostrieto o bosco di forra",
  8: "Bosco collinare misto", 9: "Altro bosco", 10: "Arbusteto o macchia",
  11: "Prateria o pascolo naturale",
};

// Nomi italiani delle classi Corine Land Cover (codici c111..c523)
const CORINE = {
  111: "Tessuto urbano continuo", 112: "Tessuto urbano discontinuo",
  121: "Aree industriali o commerciali", 122: "Strade e ferrovie", 123: "Aree portuali",
  124: "Aeroporti", 131: "Cave", 132: "Discariche", 133: "Cantieri",
  141: "Verde urbano", 142: "Aree sportive e ricreative",
  211: "Seminativi", 212: "Seminativi irrigui", 213: "Risaie", 221: "Vigneti",
  222: "Frutteti, noccioleti, castagneti da frutto", 223: "Oliveti",
  231: "Prati stabili e pascoli", 241: "Colture annuali e permanenti",
  242: "Colture miste", 243: "Aree agricole con spazi naturali", 244: "Aree agroforestali",
  311: "Boschi di latifoglie", 312: "Boschi di conifere", 313: "Boschi misti",
  321: "Pascoli naturali e praterie", 322: "Brughiere e cespuglieti",
  323: "Macchia mediterranea", 324: "Bosco e arbusteto in evoluzione",
  331: "Spiagge e dune", 332: "Rocce nude", 333: "Vegetazione rada",
  334: "Aree bruciate", 335: "Ghiacciai",
  411: "Paludi", 412: "Torbiere", 421: "Paludi salmastre", 422: "Saline", 423: "Zone intertidali",
  511: "Corsi d'acqua", 512: "Laghi", 521: "Lagune", 522: "Estuari", 523: "Mare",
};

const GIORNI_SETTIMANA = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

// ---------------------------------------------------------------------------
// Piccole funzioni di aiuto
// ---------------------------------------------------------------------------

/** Tonalità del colore di un punteggio: 120 = verde (0) ... 0 = rosso (100). */
function tonalita(punteggio) {
  return 120 - 1.2 * punteggio;
}

/** Colore di un punteggio come testo CSS: verde (0) > giallo > arancio > rosso (100). */
function colore(punteggio) {
  return `hsl(${tonalita(punteggio)} 78% ${punteggio > 40 ? 45 : 40}%)`;
}

/** Lo stesso colore come [r, g, b] da 0 a 255, per dipingere i pixel. */
function coloreRgb(punteggio) {
  const h = tonalita(punteggio) / 360, s = 0.78, l = punteggio > 40 ? 0.45 : 0.40;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const canale = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [canale(h + 1 / 3), canale(h), canale(h - 1 / 3)].map((v) => Math.round(v * 255));
}

/** I quadrati con punteggio basso sono più trasparenti, così sotto si vede la mappa. */
function opacita(punteggio) {
  return 0.2 + 0.55 * (punteggio / 100);
}

/** Una parola per il punteggio. */
function giudizio(punteggio) {
  if (punteggio >= 80) return "Ottimo";
  if (punteggio >= 60) return "Buono";
  if (punteggio >= 40) return "Discreto";
  if (punteggio >= 20) return "Scarso";
  return "Sfavorevole";
}

/** Nome leggibile di un ambiente: "t2" -> Castagneto, "c311" -> Boschi di latifoglie. */
function nomeUso(codice) {
  if (!codice) return "";
  const numero = codice.slice(1);
  return codice[0] === "t" ? (TIPI_BOSCO[numero] || codice) : (CORINE[numero] || `Corine ${numero}`);
}

/** Data di oggi in Italia, nel formato AAAA-MM-GG. */
function oggiIso() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
}

/** Da "2026-09-28" a un oggetto Date a mezzogiorno (evita problemi di fuso). */
function daIso(iso) {
  return new Date(iso + "T12:00:00");
}

/** localStorage può mancare (navigazione privata): lo usiamo solo se c'è. */
function ricorda(chiave, valore) {
  try { localStorage.setItem(chiave, valore); } catch (e) { /* niente */ }
}
function ricordato(chiave) {
  try { return localStorage.getItem(chiave); } catch (e) { return null; }
}

/** Mostra un messaggio breve sopra la mappa. */
function messaggio(testo, durataMs = 4000) {
  const box = document.getElementById("messaggio");
  box.textContent = testo;
  box.hidden = false;
  clearTimeout(messaggio.timer);
  messaggio.timer = setTimeout(() => { box.hidden = true; }, durataMs);
}

function numero(valore, decimali = 0) {
  if (valore === null || valore === undefined) return "n.d.";
  return valore.toFixed(decimali).replace(".", ",");
}

function etichettaGiorno(iso) {
  const differenza = Math.round((daIso(iso) - daIso(oggiIso())) / 86400000);
  if (differenza === 0) return "Oggi";
  if (differenza === 1) return "Domani";
  if (differenza === -1) return "Ieri";
  return GIORNI_SETTIMANA[daIso(iso).getDay()];
}

function dataBreve(iso) {
  const d = daIso(iso);
  return `${etichettaGiorno(iso)} ${d.getDate()} ${MESI[d.getMonth()]}`;
}

// ---------------------------------------------------------------------------
// Griglia dei quadrati da 500 m
// ---------------------------------------------------------------------------

/**
 * Ogni area (Foligno, Roma) ha una griglia regolare. Una cella da 3 km sta
 * alla riga r e colonna c (scritte nel suo id, es. "foligno_004_012");
 * il suo quadrato k (0..35, per righe da sud a nord) sta alla riga
 * R = r x 6 + k / 6 e colonna C = c x 6 + k % 6 della griglia da 500 m.
 */
function preparaGriglia() {
  stato.celle.forEach((cella) => {
    const [, riga, colonna] = cella.id.match(/_(\d+)_(\d+)$/).map(Number);
    cella.area = cella.id.split("_")[0];   // "foligno_004_012" -> "foligno"
    cella.riga = riga;
    cella.colonna = colonna;
    stato.cellePerId[cella.id] = cella;
    stato.cellaInGriglia[`${cella.area}:${riga}:${colonna}`] = cella;
    if (!stato.aree[cella.area]) {
      const [sud, ovest, nord, est] = cella.bbox;
      const passoLat = (nord - sud) / N, passoLon = (est - ovest) / N;
      stato.aree[cella.area] = {
        passoLat, passoLon,
        sud: sud - riga * N * passoLat,       // origine della griglia (angolo sud-ovest)
        ovest: ovest - colonna * N * passoLon,
      };
    }
    const zona = stato.zone[cella.zona_id] || (stato.zone[cella.zona_id] = {
      id: cella.zona_id, area: cella.area, celle: [],
      rMin: Infinity, rMax: -Infinity, cMin: Infinity, cMax: -Infinity,
    });
    zona.celle.push(cella);
    zona.rMin = Math.min(zona.rMin, riga); zona.rMax = Math.max(zona.rMax, riga);
    zona.cMin = Math.min(zona.cMin, colonna); zona.cMax = Math.max(zona.cMax, colonna);
  });
}

/** Quadrato da 500 m che contiene un punto: {area, R, C, cella, k} oppure null. */
function quadratoInPunto(latlng) {
  for (const [area, g] of Object.entries(stato.aree)) {
    const R = Math.floor((latlng.lat - g.sud) / g.passoLat);
    const C = Math.floor((latlng.lng - g.ovest) / g.passoLon);
    const q = quadrato(area, R, C);
    if (q) return q;
  }
  return null;
}

/** Il quadrato alla riga R e colonna C di un'area, se ha dati; altrimenti null. */
function quadrato(area, R, C) {
  if (R < 0 || C < 0) return null;
  const cella = stato.cellaInGriglia[`${area}:${Math.floor(R / N)}:${Math.floor(C / N)}`];
  if (!cella) return null;
  const k = (R % N) * N + (C % N);
  if (stato.statiche[cella.id][k * DATI_PER_QUADRATO] === VUOTO) return null;
  return { area, R, C, cella, k };
}

/** Confini [[sud, ovest], [nord, est]] di un quadrato. */
function confiniQuadrato(area, R, C) {
  const g = stato.aree[area];
  return [[g.sud + R * g.passoLat, g.ovest + C * g.passoLon],
          [g.sud + (R + 1) * g.passoLat, g.ovest + (C + 1) * g.passoLon]];
}

// ---------------------------------------------------------------------------
// Punteggi dei quadrati
// ---------------------------------------------------------------------------

/** È scelta una specie sola? Restituisce la sua posizione, altrimenti null. */
function specieScelta() {
  return stato.scelte.length === 1 ? stato.scelte[0] : null;
}

/**
 * Punteggio di un quadrato per una specie e un giorno: stessa formula del
 * programma Python (fungometer/punteggio.py).
 *   100 x acqua x temperatura x stagione x (habitat x quota) x terreno
 * Il terreno conta di più quando è secco.
 */
function punteggioSpecie(cella, k, specie, giorno) {
  const dati = stato.statiche[cella.id];
  const base = k * DATI_PER_QUADRATO;
  const voce = stato.punteggi.celle[cella.id].s[specie];
  const acqua = voce.fa[giorno] / 100;
  const temperatura = voce.ft[giorno] / 100;
  const stagione = stato.punteggi.specie[specie].stagione[giorno] / 100;
  const habitatQuota = dati[base + specie] / 100;
  const effetto = stato.punteggi.regole.effetto_se_bagnato;
  const terreno = 1 - (1 - dati[base + 5] / 100) * (1 - effetto * acqua);
  return 100 * acqua * temperatura * stagione * habitatQuota * terreno;
}

/**
 * Punteggio delle specie scelte insieme: "almeno una".
 *   combinato = 100 x (1 - (1 - A/100) x (1 - B/100) x ...)
 * Si legge come se i punteggi fossero probabilità: la probabilità di trovarne
 * almeno una. Con una specie sola è esattamente il suo punteggio.
 */
function punteggioQuadrato(cella, k, giorno = stato.giorno) {
  let nessuna = 1;
  stato.scelte.forEach((s) => { nessuna *= 1 - punteggioSpecie(cella, k, s, giorno) / 100; });
  return 100 * (1 - nessuna);
}

// ---------------------------------------------------------------------------
// Caricamento dei dati
// ---------------------------------------------------------------------------

async function caricaJson(percorso) {
  // "no-cache": chiede sempre al server se c'è una versione nuova
  // (se non è cambiata la risposta è minuscola)
  const risposta = await fetch(percorso, { cache: "no-cache" });
  if (!risposta.ok) throw new Error(`${percorso}: errore ${risposta.status}`);
  return risposta.json();
}

async function avvia() {
  preparaMappa();
  preparaAvvertenze();

  try {
    const [celle, punteggi, statiche] = await Promise.all([
      caricaJson("data/celle.json"),
      caricaJson("data/punteggi.json"),
      caricaJson("data/statiche.json"),
    ]);
    stato.celle = celle;
    stato.punteggi = punteggi;
    stato.statiche = statiche;
  } catch (errore) {
    document.getElementById("aggiornamento").textContent =
      "Non riesco a caricare i dati. Controlla la connessione e ricarica la pagina.";
    console.error(errore);
    return;
  }

  preparaGriglia();
  mostraAggiornamento();
  preparaFiltro();
  preparaGiorni();
  preparaAree();
  preparaSelezione();
  creaImmagini();

  // Prima inquadratura: l'ultima area scelta, altrimenti tutte e due
  const area = ricordato("area");
  if (area && stato.aree[area]) vaiAllArea(area); else mappa.fitBounds(limitiDi(stato.celle));
  aggiornaStileZoom();
  ricolora();

  document.getElementById("mia-posizione").addEventListener("click", trovaPosizione);
  document.getElementById("mostra-canaloni").addEventListener("click", alternaCanaloni);
}

// ---------------------------------------------------------------------------
// Data di aggiornamento e avviso se i dati sono vecchi
// ---------------------------------------------------------------------------

function mostraAggiornamento() {
  const quando = new Date(stato.punteggi.aggiornato);
  const testo = quando.toLocaleString("it-IT", {
    timeZone: "Europe/Rome", weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
  document.getElementById("aggiornamento").textContent = `Aggiornato: ${testo}`;

  // Se l'ultimo aggiornamento è di ieri o prima, lo diciamo chiaramente
  const giornoAggiornamento = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(quando);
  const oggi = oggiIso();
  if (giornoAggiornamento < oggi) {
    const giorni = Math.round((daIso(oggi) - daIso(giornoAggiornamento)) / 86400000);
    const avviso = document.getElementById("avviso-vecchio");
    avviso.textContent = giorni === 1
      ? "Attenzione: i dati sono di ieri. L'aggiornamento di stamattina non è ancora arrivato."
      : `Attenzione: i dati sono di ${giorni} giorni fa. I punteggi potrebbero non valere più.`;
    avviso.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Scelta delle specie: una casella per specie
// ---------------------------------------------------------------------------

function preparaFiltro() {
  const contenitore = document.getElementById("caselle-specie");
  const specie = stato.punteggi.specie;

  // Ricorda le ultime specie scelte (per nome, così resta valido se l'ordine cambia)
  let salvate = [];
  try { salvate = JSON.parse(ricordato("specie-scelte") || "[]"); } catch (e) { salvate = []; }
  const scelte = specie.map((sp, i) => (salvate.includes(sp.id) ? i : -1)).filter((i) => i >= 0);
  stato.scelte = scelte.length ? scelte : [0];

  specie.forEach((sp, i) => {
    const riga = document.createElement("label");
    riga.className = "casella";
    riga.innerHTML = `<input type="checkbox" value="${i}"> <span>${sp.nome}</span>`;
    const casella = riga.querySelector("input");
    casella.checked = stato.scelte.includes(i);
    casella.addEventListener("change", () => {
      const nuove = [...contenitore.querySelectorAll("input:checked")].map((c) => Number(c.value));
      if (!nuove.length) {            // almeno una specie deve restare scelta
        casella.checked = true;
        messaggio("Scegli almeno una specie.");
        return;
      }
      stato.scelte = nuove;
      ricorda("specie-scelte", JSON.stringify(nuove.map((k) => specie[k].id)));
      aggiornaRiassuntoSpecie();
      ricolora();
    });
    contenitore.appendChild(riga);
  });
  aggiornaRiassuntoSpecie();

  // Il pannello si chiude toccando fuori
  const pannello = document.getElementById("scelta-specie");
  document.addEventListener("click", (ev) => {
    if (pannello.open && !pannello.contains(ev.target)) pannello.open = false;
  });
}

function titoloFiltro() {
  const k = specieScelta();
  if (k !== null) return stato.punteggi.specie[k].nome;
  if (stato.scelte.length === stato.punteggi.specie.length) return "Almeno una specie (tutte)";
  return `Almeno una fra ${stato.scelte.length}: ` +
    stato.scelte.map((i) => stato.punteggi.specie[i].nome).join(", ");
}

function aggiornaRiassuntoSpecie() {
  document.getElementById("riassunto-specie").textContent = titoloFiltro();
}

// ---------------------------------------------------------------------------
// Selettore del giorno (oggi + 7) con i giorni migliori segnati
// ---------------------------------------------------------------------------

function preparaGiorni() {
  const contenitore = document.getElementById("giorni");
  const giorni = stato.punteggi.giorni;

  // Parte da oggi; se i dati sono vecchi e oggi non c'è, dal primo giorno
  const posOggi = giorni.indexOf(oggiIso());
  stato.giorno = posOggi >= 0 ? posOggi : 0;

  giorni.forEach((iso, i) => {
    const d = daIso(iso);
    const bottone = document.createElement("button");
    bottone.type = "button";
    bottone.setAttribute("role", "tab");
    if (i >= GIORNO_INCERTO) bottone.classList.add("incerto");
    bottone.innerHTML =
      `<span class="stella" aria-hidden="true"></span>` +
      `<span>${etichettaGiorno(iso)}</span><strong>${d.getDate()} ${MESI[d.getMonth()]}</strong>` +
      `<span class="indice"></span>`;
    bottone.addEventListener("click", () => {
      stato.giorno = i;
      aggiornaGiorni();
      ricolora();
    });
    contenitore.appendChild(bottone);
  });
  aggiornaGiorni();
}

function aggiornaGiorni() {
  document.querySelectorAll("#giorni button").forEach((b, i) => {
    b.setAttribute("aria-selected", i === stato.giorno ? "true" : "false");
  });
}

/**
 * I quadrati su cui si calcola l'indice dei giorni: quelli selezionati,
 * oppure, senza selezione, quelli che si vedono sullo schermo.
 */
function quadratiDellIndice() {
  const elenco = [];
  if (stato.selezione.size) {
    stato.selezione.forEach((c) => {
      const [area, R, C] = c.split(":");
      const q = quadrato(area, Number(R), Number(C));
      if (q) elenco.push(q);
    });
    return elenco;
  }
  const vista = mappa.getBounds();
  stato.celle.forEach((cella) => {
    const [sud, ovest, nord, est] = cella.bbox;
    if (!vista.intersects([[sud, ovest], [nord, est]])) return;
    for (let k = 0; k < N * N; k++) {
      if (stato.statiche[cella.id][k * DATI_PER_QUADRATO] === VUOTO) continue;
      const R = cella.riga * N + Math.floor(k / N), C = cella.colonna * N + (k % N);
      if (vista.intersects(confiniQuadrato(cella.area, R, C))) elenco.push({ cella, k });
    }
  });
  return elenco;
}

/** Indice di ogni giorno: media dei 10 quadrati migliori di quel giorno. */
function indiciDeiGiorni(quadrati) {
  return stato.punteggi.giorni.map((_, g) => {
    const valori = quadrati.map((q) => punteggioQuadrato(q.cella, q.k, g))
      .sort((a, b) => b - a).slice(0, QUADRATI_INDICE);
    return valori.length ? valori.reduce((a, b) => a + b, 0) / valori.length : 0;
  });
}

/** Posizioni dei giorni migliori (vuoto se i giorni sono tutti simili o tutti scarsi). */
function giorniMigliori(valori) {
  const massimo = Math.max(...valori);
  const minimo = Math.min(...valori);
  if (massimo < 10 || massimo - minimo < 3) return [];
  return valori.map((v, i) => (v >= massimo - 1 ? i : -1)).filter((i) => i >= 0);
}

/** Scrive l'indice sotto ogni giorno e mette la stella sui migliori. */
function segnaGiorniMigliori() {
  const quadrati = quadratiDellIndice();
  const indici = indiciDeiGiorni(quadrati);
  const migliori = giorniMigliori(indici);
  const massimo = Math.max(...indici);
  const dove = stato.selezione.size
    ? `nella tua zona (${quadrati.length} quadrati)`
    : "nella zona sullo schermo";

  document.querySelectorAll("#giorni button").forEach((b, i) => {
    const migliore = migliori.includes(i);
    b.classList.toggle("migliore", migliore);
    b.querySelector(".stella").textContent = migliore ? "★" : "";
    b.querySelector(".indice").textContent = Math.round(indici[i]);
    b.title = `Media dei ${QUADRATI_INDICE} quadrati migliori ${dove}: ${Math.round(indici[i])}` +
      (i >= GIORNO_INCERTO ? " (previsione incerta)" : "");
  });
  const nota = document.getElementById("nota-giorni");
  if (!quadrati.length) {
    nota.textContent = "Nessun quadrato sullo schermo";
  } else if (massimo < 10) {
    nota.textContent = `Condizioni sfavorevoli per tutta la settimana ${dove}`;
  } else if (!migliori.length) {
    nota.textContent = `Condizioni simili per tutta la settimana ${dove}`;
  } else {
    const incerto = migliori.some((i) => i >= GIORNO_INCERTO);
    nota.textContent = `★ giorno migliore ${dove}` + (incerto ? " (da +5 giorni la previsione è incerta)" : "");
  }
}

// ---------------------------------------------------------------------------
// Mappa e immagini dei quadrati
// ---------------------------------------------------------------------------

function preparaMappa() {
  mappa = L.map("mappa", { zoomControl: true }).setView([42.4, 12.6], 8);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' +
      ' | Meteo <a href="https://open-meteo.com/">Open-Meteo</a>',
  }).addTo(mappa);

  stato.stratoSelezione = L.layerGroup().addTo(mappa);

  // Con una scheda aperta nascondiamo legenda e pulsanti: sui telefoni
  // piccoli coprirebbero la scheda.
  const contenitore = document.querySelector(".contenitore-mappa");
  mappa.on("popupopen", () => contenitore.classList.add("scheda-aperta"));
  mappa.on("popupclose", () => {
    contenitore.classList.remove("scheda-aperta");
    if (stato.evidenziato) { stato.evidenziato.remove(); stato.evidenziato = null; }
  });

  // Tocco sulla mappa: apre la scheda del quadrato (solo in modalità Mappa)
  mappa.on("click", (ev) => {
    if (!stato.punteggi || stato.selezionando) return;
    const q = quadratoInPunto(ev.latlng);
    if (q) apriSchedaQuadrato(q);
  });

  mappa.on("zoomend", () => {
    if (stato.punteggi) aggiornaStileZoom();
  });

  // Quando la mappa si ferma, l'indice dei giorni segue lo schermo
  mappa.on("moveend", () => {
    if (!stato.punteggi) return;
    aggiornaAreaDaMappa();
    if (!stato.selezione.size) segnaGiorniMigliori();
  });
}

/**
 * Da lontano: gradiente, e ogni pixel prende il migliore dei vicini.
 * Da vicino: quadrati netti, ognuno col suo valore.
 */
let eraVicino = null, eraLontano = null;
function aggiornaStileZoom() {
  const vicino = mappa.getZoom() >= ZOOM_NETTO;
  const lontano = mappa.getZoom() < ZOOM_MASSIMI;
  if (vicino !== eraVicino) {
    document.querySelector(".contenitore-mappa").classList.toggle("quadrati-netti", vicino);
    eraVicino = vicino;
  }
  if (lontano !== eraLontano) {
    const primaVolta = eraLontano === null;
    eraLontano = lontano;
    if (!primaVolta) dipingiTutte();
  }
}

/** Un'immagine per zona: un pixel per ogni quadrato da 500 m. */
function creaImmagini() {
  Object.values(stato.zone).forEach((zona) => {
    const g = stato.aree[zona.area];
    zona.larghezza = (zona.cMax - zona.cMin + 1) * N;
    zona.altezza = (zona.rMax - zona.rMin + 1) * N;
    zona.tela = document.createElement("canvas");
    zona.tela.width = zona.larghezza;
    zona.tela.height = zona.altezza;
    const limiti = [
      [g.sud + zona.rMin * N * g.passoLat, g.ovest + zona.cMin * N * g.passoLon],
      [g.sud + (zona.rMax + 1) * N * g.passoLat, g.ovest + (zona.cMax + 1) * N * g.passoLon],
    ];
    zona.immagine = L.imageOverlay(zona.tela.toDataURL(), limiti, { className: "quadrati", interactive: false })
      .addTo(mappa);
  });
}

/** Ricolora tutto dopo un cambio di specie o di giorno. */
function ricolora() {
  mappa.closePopup();
  dipingiTutte();
  segnaGiorniMigliori();
}

function dipingiTutte() {
  Object.values(stato.zone).forEach(dipingiZona);
}

/**
 * Dipinge l'immagine di una zona. Da lontano (zoom sotto 12) ogni pixel prende
 * il valore migliore fra sé e i vicini: così un quadrato ottimo non sparisce
 * nella sfumatura con quelli intorno.
 */
function dipingiZona(zona) {
  const W = zona.larghezza, H = zona.altezza;
  const valori = new Float32Array(W * H).fill(-1);   // -1 = nessun dato (trasparente)
  zona.celle.forEach((cella) => {
    for (let k = 0; k < N * N; k++) {
      if (stato.statiche[cella.id][k * DATI_PER_QUADRATO] === VUOTO) continue;
      const x = (cella.colonna - zona.cMin) * N + (k % N);
      const y = H - 1 - ((cella.riga - zona.rMin) * N + Math.floor(k / N)); // nord in alto
      valori[y * W + x] = punteggioQuadrato(cella, k);
    }
  });

  let finali = valori;
  if (mappa.getZoom() < ZOOM_MASSIMI) {
    finali = new Float32Array(valori);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (valori[y * W + x] < 0) continue;
        let m = valori[y * W + x];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H) m = Math.max(m, valori[yy * W + xx]);
          }
        }
        finali[y * W + x] = m;
      }
    }
  }

  const ctx = zona.tela.getContext("2d");
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < finali.length; i++) {
    const v = finali[i];
    if (v < 0) continue;
    const [r, g, b] = coloreRgb(v);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(255 * opacita(v));
  }
  ctx.putImageData(img, 0, 0);
  zona.immagine.setUrl(zona.tela.toDataURL());
}

function limitiDi(celle) {
  return L.latLngBounds(celle.flatMap((c) => [[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]]));
}

// ---------------------------------------------------------------------------
// Aree: pulsanti Foligno/Roma
// ---------------------------------------------------------------------------

function preparaAree() {
  document.querySelectorAll(".aree button").forEach((b) => {
    b.addEventListener("click", () => vaiAllArea(b.dataset.area));
  });
}

function vaiAllArea(area) {
  const celle = stato.celle.filter((c) => c.area === area);
  if (!celle.length) return;
  mappa.fitBounds(limitiDi(celle));
  ricorda("area", area);
  impostaArea(area);
}

function impostaArea(area) {
  if (stato.area === area) return;
  stato.area = area;
  document.querySelectorAll(".aree button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.area === area ? "true" : "false");
  });
}

/** L'area evidenziata è quella più vicina al centro della mappa. */
function aggiornaAreaDaMappa() {
  const centro = mappa.getCenter();
  let migliore = null, distanza = Infinity;
  stato.celle.forEach((c) => {
    const d = (c.bbox[0] + c.bbox[2]) / 2 - centro.lat;
    const e = (c.bbox[1] + c.bbox[3]) / 2 - centro.lng;
    if (d * d + e * e < distanza) { distanza = d * d + e * e; migliore = c.area; }
  });
  if (migliore) impostaArea(migliore);
}

// ---------------------------------------------------------------------------
// Selezione della tua zona: tocchi, lazo e anelli chiusi
// ---------------------------------------------------------------------------

function preparaSelezione() {
  // La selezione resta salvata nel telefono
  try { JSON.parse(ricordato("selezione") || "[]").forEach((q) => stato.selezione.add(q)); } catch (e) { /* niente */ }
  disegnaSelezione();

  document.getElementById("modo-mappa").addEventListener("click", () => impostaModalita(false));
  document.getElementById("modo-seleziona").addEventListener("click", () => impostaModalita(true));
  document.getElementById("svuota-selezione").addEventListener("click", () => {
    stato.selezione.clear();
    salvaSelezione();
  });

  const contenitore = mappa.getContainer();
  let tratto = null;   // il dito che sta disegnando

  contenitore.addEventListener("pointerdown", (ev) => {
    if (!stato.selezionando || !ev.isPrimary) return;
    ev.preventDefault();
    contenitore.setPointerCapture(ev.pointerId);
    const q = quadratoInPunto(mappa.mouseEventToLatLng(ev));
    // Se si parte da un quadrato già selezionato, il dito toglie invece di aggiungere
    const togli = !!q && stato.selezione.has(chiave(q));
    tratto = { togli, ultimo: mappa.mouseEventToContainerPoint(ev), toccati: new Set() };
    if (q) segna(q, tratto);
  });

  contenitore.addEventListener("pointermove", (ev) => {
    if (!tratto) return;
    const punto = mappa.mouseEventToContainerPoint(ev);
    const distanza = punto.distanceTo(tratto.ultimo);
    if (distanza < 2) return;
    // Campiona il tratto ogni 3 pixel, così non salta quadrati se il dito è veloce
    const passi = Math.ceil(distanza / 3);
    for (let i = 1; i <= passi; i++) {
      const p = tratto.ultimo.add(punto.subtract(tratto.ultimo).multiplyBy(i / passi));
      const q = quadratoInPunto(mappa.containerPointToLatLng(p));
      if (q) segna(q, tratto);
    }
    tratto.ultimo = punto;
  });

  const fine = () => {
    if (!tratto) return;
    if (!tratto.togli) riempiAnelli();
    tratto = null;
    salvaSelezione();
  };
  contenitore.addEventListener("pointerup", fine);
  contenitore.addEventListener("pointercancel", fine);
}

function chiave(q) {
  return `${q.area}:${q.R}:${q.C}`;
}

/** Aggiunge (o toglie) un quadrato durante un tratto, una volta sola per tratto. */
function segna(q, tratto) {
  const c = chiave(q);
  if (tratto.toccati.has(c)) return;
  tratto.toccati.add(c);
  if (tratto.togli) stato.selezione.delete(c); else stato.selezione.add(c);
  disegnaSelezione();
}

/**
 * Se i quadrati selezionati formano un anello chiuso, seleziona anche quelli
 * dentro. Si parte dal bordo di un rettangolo appena più grande della
 * selezione e ci si espande fra i quadrati non selezionati: quelli che non si
 * raggiungono senza attraversare la selezione sono chiusi dentro.
 */
function riempiAnelli() {
  const perArea = {};
  stato.selezione.forEach((c) => {
    const [area, R, C] = c.split(":");
    (perArea[area] = perArea[area] || []).push([Number(R), Number(C)]);
  });
  Object.entries(perArea).forEach(([area, punti]) => {
    let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    punti.forEach(([R, C]) => {
      r0 = Math.min(r0, R); r1 = Math.max(r1, R); c0 = Math.min(c0, C); c1 = Math.max(c1, C);
    });
    r0 -= 1; r1 += 1; c0 -= 1; c1 += 1;
    const W = c1 - c0 + 1, H = r1 - r0 + 1;
    if (W * H > 400000) return;   // selezioni enormi: niente riempimento
    const selezionato = new Uint8Array(W * H);
    punti.forEach(([R, C]) => { selezionato[(R - r0) * W + (C - c0)] = 1; });
    const raggiunto = new Uint8Array(W * H);
    const coda = [];
    for (let x = 0; x < W; x++) coda.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) coda.push(y * W, y * W + W - 1);
    while (coda.length) {
      const i = coda.pop();
      if (raggiunto[i] || selezionato[i]) continue;
      raggiunto[i] = 1;
      const y = Math.floor(i / W), x = i % W;
      if (y > 0) coda.push(i - W);
      if (y < H - 1) coda.push(i + W);
      if (x > 0) coda.push(i - 1);
      if (x < W - 1) coda.push(i + 1);
    }
    for (let i = 0; i < W * H; i++) {
      if (raggiunto[i] || selezionato[i]) continue;
      const q = quadrato(area, Math.floor(i / W) + r0, (i % W) + c0);
      if (q) stato.selezione.add(chiave(q));
    }
  });
}

function salvaSelezione() {
  ricorda("selezione", JSON.stringify([...stato.selezione]));
  disegnaSelezione();
  segnaGiorniMigliori();
}

/** Bordo dei quadrati selezionati. */
function disegnaSelezione() {
  stato.stratoSelezione.clearLayers();
  stato.selezione.forEach((c) => {
    const [area, R, C] = c.split(":");
    if (!stato.aree[area]) return;
    L.rectangle(confiniQuadrato(area, Number(R), Number(C)), {
      color: "#1b2a4a", weight: 1.5, opacity: 0.9, fillColor: "#ffffff", fillOpacity: 0.15,
      interactive: false,
    }).addTo(stato.stratoSelezione);
  });
  document.getElementById("svuota-selezione").hidden = !stato.selezione.size;
}

/** Modalità Seleziona: la mappa smette di spostarsi col dito. */
function impostaModalita(seleziona) {
  stato.selezionando = seleziona;
  document.getElementById("modo-mappa").setAttribute("aria-pressed", String(!seleziona));
  document.getElementById("modo-seleziona").setAttribute("aria-pressed", String(seleziona));
  document.querySelector(".contenitore-mappa").classList.toggle("selezionando", seleziona);
  const comandi = [mappa.dragging, mappa.touchZoom, mappa.doubleClickZoom, mappa.boxZoom];
  comandi.forEach((c) => (seleziona ? c.disable() : c.enable()));
  mappa.closePopup();
  if (seleziona) {
    messaggio("Tocca i quadrati o passaci sopra col dito. Se chiudi un anello, si riempie anche l'interno.", 6000);
  }
}

// ---------------------------------------------------------------------------
// Canaloni
// ---------------------------------------------------------------------------

async function alternaCanaloni() {
  const bottone = document.getElementById("mostra-canaloni");
  if (stato.canaloni) {
    stato.canaloni.remove();
    stato.canaloni = null;
    bottone.setAttribute("aria-pressed", "false");
    return;
  }
  try {
    if (!stato.indiceCanaloni) stato.indiceCanaloni = await caricaJson("data/canaloni/indice.json");
  } catch (errore) {
    messaggio("Non riesco a caricare i canaloni.");
    return;
  }
  stato.canaloni = L.layerGroup(
    Object.entries(stato.indiceCanaloni).map(([zona, limiti]) =>
      L.imageOverlay(`data/canaloni/${zona}.png`, limiti, { opacity: 0.55, interactive: false }))
  ).addTo(mappa);
  bottone.setAttribute("aria-pressed", "true");
  if (mappa.getZoom() < 12) messaggio("Ingrandisci la mappa per vedere bene i canaloni (in blu).");
}

// ---------------------------------------------------------------------------
// Scheda del quadrato
// ---------------------------------------------------------------------------

function barraFattore(nome, valore) {
  // valore è un intero 0-100
  return `<li><span>${nome}</span><span class="barra"><span style="width:${valore}%"></span></span><span>${(valore / 100).toFixed(2).replace(".", ",")}</span></li>`;
}

/** Righe con il meteo della cella da 3 km nel giorno scelto. */
function righeMeteo(idCella) {
  const g = stato.giorno;
  const m = stato.punteggi.celle[idCella];
  const r = stato.punteggi.regole;
  const k = specieScelta();
  const soglia = k !== null ? ` (soglia ${stato.punteggi.specie[k].pioggia_mm} mm)` : "";
  const caldo = m.k[g] ? `, ${m.k[g]} giorni oltre 30 °C nelle ultime 2 settimane` : "";
  return `
    <dt>Pioggia</dt><dd>${numero(m.p[g])} mm in ${r.giorni_pioggia} giorni${soglia}</dd>
    <dt>Suolo</dt><dd>umidità ${numero(m.u[g], 2)} m³/m³${caldo}</dd>
    <dt>Temperature</dt><dd>min ${numero(m.tn[g], 1)} °C, max ${numero(m.tx[g], 1)} °C</dd>
    <dt>Media ${r.giorni_temperatura} gg</dt><dd>${numero(m.tr[g], 1)} °C</dd>`;
}

/** Punteggio di ogni specie scelta, dal più alto (quando le specie sono più d'una). */
function elencoSpecie(q) {
  return `<ul class="elenco-specie">` + stato.scelte
    .map((s) => ({ nome: stato.punteggi.specie[s].nome, p: punteggioSpecie(q.cella, q.k, s, stato.giorno) }))
    .sort((a, b) => b.p - a.p)
    .map((x) => `<li><span>${x.nome}</span><strong style="color:${colore(x.p)}">${Math.round(x.p)}</strong></li>`)
    .join("") + `</ul>`;
}

/**
 * Piccolo grafico degli 8 giorni per un quadrato: una barra per giorno,
 * stella sul giorno migliore, bordo tratteggiato per i giorni incerti.
 */
function graficoGiorni(valori) {
  const migliori = giorniMigliori(valori);
  const barre = valori.map((v, g) => {
    const iso = stato.punteggi.giorni[g];
    const classi = ["giorno-barra", g === stato.giorno ? "scelto" : "", g >= GIORNO_INCERTO ? "incerto" : ""].join(" ");
    return `<div class="${classi}" title="${dataBreve(iso)}: ${Math.round(v)}">
        <span class="valore">${migliori.includes(g) ? "★" : ""}${Math.round(v)}</span>
        <span class="colonna"><span style="height:${Math.max(3, v)}%;background:${colore(v)}"></span></span>
        <span class="etichetta">${iso === oggiIso() ? "oggi" : GIORNI_SETTIMANA[daIso(iso).getDay()]} ${daIso(iso).getDate()}</span>
      </div>`;
  }).join("");
  const nota = migliori.length ? "★ giorno migliore per questo quadrato"
    : Math.max(...valori) < 10 ? "Sfavorevole per tutta la settimana" : "Simile per tutta la settimana";
  return `<div class="grafico-giorni">${barre}</div><p class="nota">${nota}</p>`;
}

/** Scarica (una volta sola) le schede complete dei quadrati di una zona. */
async function schedeDellaZona(zonaId) {
  if (!stato.schede[zonaId]) stato.schede[zonaId] = await caricaJson(`data/sottocelle/${zonaId}.json`);
  return stato.schede[zonaId];
}

async function apriSchedaQuadrato(q) {
  const limiti = confiniQuadrato(q.area, q.R, q.C);
  const centro = L.latLngBounds(limiti).getCenter();
  if (stato.evidenziato) stato.evidenziato.remove();
  stato.evidenziato = L.rectangle(limiti, { color: "#1b2a4a", weight: 2, fill: false, interactive: false }).addTo(mappa);

  let scheda;
  try {
    scheda = (await schedeDellaZona(q.cella.zona_id))[q.cella.id][q.k];
  } catch (errore) {
    messaggio("Non riesco a caricare la scheda di questo quadrato.");
    return;
  }
  const [quota, pendenza, uso1, perc1, uso2, perc2, canaloni, terreno, habitat, quote] = scheda;
  const g = stato.giorno;
  const p = punteggioQuadrato(q.cella, q.k);
  const k = specieScelta();

  const ambienti = [uso1 && `${nomeUso(uso1)} ${perc1}%`, uso2 && `${nomeUso(uso2)} ${perc2}%`]
    .filter(Boolean).join("<br>");

  let fattori;
  if (k !== null) {
    const voce = stato.punteggi.celle[q.cella.id].s[k];
    const effetto = stato.punteggi.regole.effetto_se_bagnato;
    const terrenoEff = 100 * (1 - (1 - terreno / 100) * (1 - effetto * voce.fa[g] / 100));
    fattori = `<ul class="fattori">
        ${barraFattore("Acqua", voce.fa[g])}
        ${barraFattore("Temperatura", voce.ft[g])}
        ${barraFattore("Stagione", stato.punteggi.specie[k].stagione[g])}
        ${barraFattore("Habitat", habitat[k])}
        ${barraFattore("Quota", quote[k])}
        ${barraFattore("Terreno", Math.round(terrenoEff))}
      </ul>`;
  } else {
    fattori = elencoSpecie(q);
  }
  const grafico = graficoGiorni(stato.punteggi.giorni.map((_, gg) => punteggioQuadrato(q.cella, q.k, gg)));

  const html = `
    <div class="scheda">
      <h3>${titoloFiltro()}</h3>
      <div class="zona">${q.cella.zona}, quadrato da 500 m · ${dataBreve(stato.punteggi.giorni[g])}</div>
      <div class="punteggio">
        <span class="numero" style="color:${colore(p)}">${Math.round(p)}</span>
        <span class="giudizio">${giudizio(p)}</span>
      </div>
      <dl>
        <dt>Ambienti</dt><dd>${ambienti || "n.d."}</dd>
        <dt>Quota</dt><dd>circa ${quota} m</dd>
        <dt>Terreno</dt><dd>pendenza media ${pendenza}°${canaloni ? `, canaloni ${canaloni}%` : ""}</dd>
        ${righeMeteo(q.cella.id)}
      </dl>
      ${grafico}
      ${fattori}
      <p class="nota">Il meteo è quello della zona di 3 km intorno. <a href="info.html">Come si calcola</a></p>
    </div>`;

  // Altezza massima: la scheda non esce mai dalla mappa, al massimo scorre
  const altezzaMax = Math.max(180, mappa.getSize().y - 100);
  L.popup({ maxWidth: 300, maxHeight: altezzaMax, autoPanPadding: [16, 16] })
    .setLatLng(centro).setContent(html).openOn(mappa);
}

// ---------------------------------------------------------------------------
// La mia posizione (GPS, solo nel telefono: non viene inviata a nessuno)
// ---------------------------------------------------------------------------

function trovaPosizione() {
  if (!navigator.geolocation) {
    messaggio("Questo browser non permette di leggere la posizione.");
    return;
  }
  messaggio("Cerco la tua posizione…", 10000);

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const punto = L.latLng(pos.coords.latitude, pos.coords.longitude);
      if (segnaPosizione) segnaPosizione.remove();
      segnaPosizione = L.layerGroup([
        L.circle(punto, { radius: pos.coords.accuracy, color: "#1a73e8", weight: 1, fillOpacity: 0.1 }),
        L.circleMarker(punto, { radius: 7, color: "#fff", weight: 2, fillColor: "#1a73e8", fillOpacity: 1 }),
      ]).addTo(mappa);

      const q = quadratoInPunto(punto);
      if (!q) {
        mappa.setView(punto, 12);
        messaggio("Sei fuori dalle aree coperte da FungoMeter.");
        return;
      }
      document.getElementById("messaggio").hidden = true;
      if (stato.selezionando) impostaModalita(false);
      mappa.once("moveend", () => apriSchedaQuadrato(q));
      mappa.setView(punto, 14);
    },
    (errore) => {
      const testi = {
        1: "Permesso negato: abilita la posizione per questo sito nelle impostazioni del browser.",
        2: "Posizione non disponibile. Riprova all'aperto.",
        3: "La posizione ci sta mettendo troppo. Riprova.",
      };
      messaggio(testi[errore.code] || "Non riesco a leggere la posizione.");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ---------------------------------------------------------------------------
// Avvertenze: sempre raggiungibili, e aperte da sole la prima volta
// ---------------------------------------------------------------------------

function preparaAvvertenze() {
  const finestra = document.getElementById("avvertenze");
  const apri = () => finestra.showModal();
  document.getElementById("apri-avvertenze").addEventListener("click", apri);
  document.querySelectorAll("[data-apri-avvertenze]").forEach((b) => b.addEventListener("click", apri));

  if (!ricordato("avvertenze-lette")) {
    apri();
    finestra.addEventListener("close", () => ricorda("avvertenze-lette", "1"), { once: true });
  }
}

// ---------------------------------------------------------------------------
// App installabile: registra il service worker (funziona anche offline)
// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker:", e));
  });
}

avvia();
