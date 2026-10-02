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
  posizione: null,      // la tua posizione (dal GPS), per i posti vicini
  vicini: [],           // i 3 posti migliori vicino a te
  vicinoMostrato: 0,    // quale dei 3 si vede nella scheda in basso
  stratoVicini: null,   // segnaposti 1, 2, 3 sulla mappa
};

const N = 6;                 // quadrati da 500 m per lato di una cella da 3 km
// In statiche.json, per ogni quadrato: habitat x quota per ogni specie, poi il terreno.
// Il numero dipende da quante specie ci sono: si fissa quando arrivano i dati.
let DATI_PER_QUADRATO = 6;
const VUOTO = 255;           // in statiche.json: quadrato d'acqua, senza dati
const ZOOM_NETTO = 13;       // da qui in su i quadrati si vedono netti
const ZOOM_MASSIMI = 12;     // sotto questo ogni pixel prende il migliore dei vicini
const GIORNO_INCERTO = 5;    // i giorni da +5 in poi sono previsioni poco affidabili
const QUADRATI_INDICE = 10;  // quanti quadrati entrano nell'indice del giorno
const PIXEL_PER_QUADRATO = 4; // risoluzione dell'immagine morbida (da lontano)
const DISTANZA_META_KM = 15; // a questa distanza un posto conta la metà
const DISTANZA_MINIMA_KM = 1.5; // i 3 posti vicini distano almeno questo fra loro

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

/**
 * Due scale di colori:
 * - "classica": verde (0) > giallo > arancio > rosso (100);
 * - "daltonici": viridis, dal viola (0) al giallo (100), leggibile anche da
 *   chi non distingue il rosso dal verde (circa un uomo su dodici).
 * La scelta resta salvata nel telefono.
 */
let scalaDaltonici = ricordato("scala-colori") === "daltonici";

// Viridis: cinque colori di riferimento, in mezzo si sfuma
const VIRIDIS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];

/** Tonalità del colore di un punteggio: 120 = verde (0) ... 0 = rosso (100). */
function tonalita(punteggio) {
  return 120 - 1.2 * punteggio;
}

/** Colore di un punteggio come testo CSS. */
function colore(punteggio) {
  if (scalaDaltonici) return `rgb(${coloreRgb(punteggio).join(",")})`;
  return `hsl(${tonalita(punteggio)} 78% ${punteggio > 40 ? 45 : 40}%)`;
}

/** Lo stesso colore come [r, g, b] da 0 a 255, per dipingere i pixel. */
function coloreRgb(punteggio) {
  if (scalaDaltonici) {
    const t = Math.max(0, Math.min(1, punteggio / 100)) * (VIRIDIS.length - 1);
    const i = Math.min(VIRIDIS.length - 2, Math.floor(t)), f = t - i;
    return VIRIDIS[i].map((c, j) => Math.round(c + (VIRIDIS[i + 1][j] - c) * f));
  }
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

/**
 * Tendenza di un quadrato nel giorno g: confronta il punteggio del giorno con
 * la media dei due giorni dopo (nell'ultimo giorno, con il giorno prima).
 * Sotto i 3 punti di differenza è "stabile".
 */
function tendenza(cella, k, g = stato.giorno) {
  const n = stato.punteggi.giorni.length;
  const oggi = punteggioQuadrato(cella, k, g);
  let differenza;
  if (g < n - 1) {
    const dopo = [g + 1, g + 2].filter((x) => x < n).map((x) => punteggioQuadrato(cella, k, x));
    differenza = dopo.reduce((a, b) => a + b, 0) / dopo.length - oggi;
  } else {
    differenza = oggi - punteggioQuadrato(cella, k, g - 1);
  }
  if (differenza >= 3) return { testo: "in salita", simbolo: "↗", classe: "sale" };
  if (differenza <= -3) return { testo: "in calo", simbolo: "↘", classe: "scende" };
  return { testo: "stabile", simbolo: "→", classe: "stabile" };
}

function etichettaTendenza(t) {
  return `<span class="tendenza ${t.classe}" title="Rispetto ai giorni successivi">${t.simbolo} ${t.testo}</span>`;
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
        rMin: Infinity, rMax: -Infinity, cMin: Infinity, cMax: -Infinity, celle: [],
      };
    }
    const a = stato.aree[cella.area];
    a.celle.push(cella);
    a.rMin = Math.min(a.rMin, riga); a.rMax = Math.max(a.rMax, riga);
    a.cMin = Math.min(a.cMin, colonna); a.cMax = Math.max(a.cMax, colonna);
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
  // Stagione della cella (quota e gelo compresi); nei dati vecchi, quella della specie
  const stagione = (voce.fs ? voce.fs[giorno] : stato.punteggi.specie[specie].stagione[giorno]) / 100;
  const habitatQuota = dati[base + specie] / 100;
  const effetto = stato.punteggi.regole.effetto_se_bagnato;
  const terreno = 1 - (1 - dati[base + DATI_PER_QUADRATO - 1] / 100) * (1 - effetto * acqua);
  return 100 * acqua * temperatura * stagione * habitatQuota * terreno;
}

/**
 * Punteggio delle specie scelte insieme.
 *
 * Le specie non sono indipendenti: dipendono tutte dalla stessa acqua
 * (pioggia e umidità del suolo). Se manca l'acqua manca per tutte, e sommare
 * specie non deve far sembrare buona una zona secca. Quindi:
 *   - la parte propria di ogni specie (habitat, stagione, temperatura, quota)
 *     si combina come "almeno una": più specie = più occasioni;
 *   - il risultato si moltiplica per l'acqua, che è comune a tutte.
 *   combinato = 100 x acqua x (1 - (1 - resto A) x (1 - resto B) x ...)
 *   resto = punteggio della specie / (100 x acqua)
 * Come acqua comune si usa la migliore fra le specie scelte (le soglie di
 * pioggia cambiano da specie a specie). Con una specie sola il risultato è
 * esattamente il suo punteggio.
 */
function punteggioQuadrato(cella, k, giorno = stato.giorno) {
  const voci = stato.punteggi.celle[cella.id].s;
  const acqua = Math.max(...stato.scelte.map((s) => voci[s].fa[giorno] / 100));
  if (acqua <= 0) return 0;
  let nessuna = 1;
  stato.scelte.forEach((s) => {
    const resto = Math.min(1, punteggioSpecie(cella, k, s, giorno) / 100 / acqua);
    nessuna *= 1 - resto;
  });
  return 100 * acqua * (1 - nessuna);
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
    // I punteggi delle celle stanno in un file per area (punteggi_foligno.json, ...)
    if (punteggi.aree) {
      const parti = await Promise.all(punteggi.aree.map((a) => caricaJson(`data/punteggi_${a}.json`)));
      parti.forEach((parte) => Object.assign(punteggi.celle, parte.celle));
    }
    DATI_PER_QUADRATO = punteggi.specie.length + 1;
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
  preparaLegenda();
  preparaVicini();
  preparaMiglioriQui();
  preparaPreferiti();
  preparaRicerca();
  preparaPannelloFiltri();
  preparaStrumenti();

  // Prima inquadratura: l'ultima area scelta, altrimenti tutte e due
  const area = ricordato("area");
  if (area && stato.aree[area]) vaiAllArea(area); else mappa.fitBounds(limitiDi(stato.celle));
  aggiornaStileZoom();
  ricolora();

  document.getElementById("mia-posizione").addEventListener("click", trovaPosizione);
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
}

/** Il pannello di specie, giorno e area: si apre e si chiude dal tasto in alto. */
function preparaPannelloFiltri() {
  const tasto = document.getElementById("apri-filtri");
  const pannello = document.getElementById("filtri");
  const contenitore = document.querySelector(".contenitore-mappa");
  const apri = (si) => {
    pannello.hidden = !si;
    tasto.setAttribute("aria-expanded", String(si));
  };
  tasto.addEventListener("click", () => apri(pannello.hidden));
  document.getElementById("chiudi-filtri").addEventListener("click", () => apri(false));
  // Un tocco sulla mappa col pannello aperto lo chiude soltanto (niente scheda)
  contenitore.addEventListener("click", (ev) => {
    if (pannello.hidden || pannello.contains(ev.target) || tasto.contains(ev.target)) return;
    apri(false);
    ev.stopPropagation();
  }, true);
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
  const iso = stato.punteggi.giorni[stato.giorno];
  const d = daIso(iso);
  document.getElementById("riassunto-giorno").textContent = `${etichettaGiorno(iso)} ${d.getDate()} ${MESI[d.getMonth()]}`;
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
  return quadratiSulloSchermo();
}

/** Tutti i quadrati con dati che si vedono sullo schermo. */
function quadratiSulloSchermo() {
  const elenco = [];
  const vista = mappa.getBounds();
  stato.celle.forEach((cella) => {
    const [sud, ovest, nord, est] = cella.bbox;
    if (!vista.intersects([[sud, ovest], [nord, est]])) return;
    for (let k = 0; k < N * N; k++) {
      if (stato.statiche[cella.id][k * DATI_PER_QUADRATO] === VUOTO) continue;
      const R = cella.riga * N + Math.floor(k / N), C = cella.colonna * N + (k % N);
      if (vista.intersects(confiniQuadrato(cella.area, R, C))) {
        elenco.push({ area: cella.area, R, C, cella, k });
      }
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
  mappa = L.map("mappa", { zoomControl: false }).setView([42.4, 12.6], 8);

  // Mappe di base: stradale (OpenStreetMap) o topografica con curve di livello
  // (OpenTopoMap); in più, a scelta, i sentieri escursionistici (Waymarked Trails).
  // Attribuzioni brevi (su due righe al massimo sul telefono), con tutte le fonti e le licenze
  const meteo = ' | <a href="https://open-meteo.com/">Open-Meteo</a>';
  const basi = {
    "Stradale": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' + meteo,
    }),
    "Topografica": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17, subdomains: "abc",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM' +
        ' | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' + meteo,
    }),
  };
  const sentieri = L.tileLayer("https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png", {
    maxZoom: 17, opacity: 0.8,
    attribution: '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a> (CC-BY-SA)',
  });
  const baseScelta = basi[ricordato("mappa-base")] ? ricordato("mappa-base") : "Stradale";
  basi[baseScelta].addTo(mappa);
  if (ricordato("sentieri") === "si") sentieri.addTo(mappa);
  // Aree protette: i confini si scaricano solo quando accendi lo strato
  const protette = L.layerGroup();
  protette.on("add", async () => {
    if (protette.getLayers().length) return;
    const dati = await caricaAreeProtette();
    if (!dati) return;
    L.geoJSON(dati, {
      interactive: false,
      style: (f) => f.properties.tipo === "parco"
        ? { color: "#6a1b9a", weight: 2, dashArray: "6 4", fillColor: "#6a1b9a", fillOpacity: 0.06 }
        : { color: "#00796b", weight: 1.5, dashArray: "2 4", fill: false },
    }).addTo(protette);
  });
  if (ricordato("protette") === "si") protette.addTo(mappa);
  // Il menu delle mappe si apre dal pulsante "Mappe" (il suo tasto di Leaflet è nascosto)
  stato.menuMappe = L.control.layers(basi, { "Sentieri": sentieri, "Aree protette": protette },
    { position: "topright" }).addTo(mappa);
  mappa.on("baselayerchange", (ev) => ricorda("mappa-base", ev.name));
  mappa.on("overlayadd", (ev) => {
    if (ev.layer === sentieri) ricorda("sentieri", "si");
    if (ev.layer === protette) {
      ricorda("protette", "si");
      messaggio("Viola tratteggiato: parchi e riserve. Verde puntinato: siti Natura 2000.", 5000);
    }
  });
  mappa.on("overlayremove", (ev) => {
    if (ev.layer === sentieri) ricorda("sentieri", "no");
    if (ev.layer === protette) ricorda("protette", "no");
  });

  stato.stratoSelezione = L.layerGroup().addTo(mappa);

  // Con una scheda aperta nascondiamo legenda e pulsanti: sui telefoni
  // piccoli coprirebbero la scheda.
  const contenitore = document.querySelector(".contenitore-mappa");
  mappa.on("popupopen", (ev) => {
    adattaScheda(ev.popup);
    contenitore.classList.add("scheda-aperta");
    document.getElementById("messaggio").hidden = true;   // il messaggio non deve coprire la scheda
  });
  mappa.on("popupclose", () => {
    stato.schedaChiusaAlle = Date.now();
    contenitore.classList.remove("scheda-aperta");
    if (stato.evidenziato) { stato.evidenziato.remove(); stato.evidenziato = null; }
  });

  // Tocco sulla mappa: apre la scheda del quadrato (solo in modalità Mappa).
  // Se c'era una scheda aperta, il tocco fuori la chiude soltanto: Leaflet la
  // chiude appena prima del click, quindi guardiamo se si è chiusa in quel momento.
  mappa.on("click", (ev) => {
    if (!stato.punteggi || stato.selezionando) return;
    if (Date.now() - (stato.schedaChiusaAlle || 0) < 400) return;
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
    if (!document.getElementById("pannello-migliori").hidden) mostraMiglioriQui();
  });
}

/**
 * Due modi di disegnare i quadrati:
 * - da vicino (zoom 13 e oltre): un'immagine per zona, un pixel per quadrato,
 *   mostrata senza sfumature: quadrati netti;
 * - da lontano: un'immagine grande per area, sfumata con un filtro di
 *   sfocatura: gradiente morbido, senza spigoli fra una zona e l'altra.
 *   Sotto lo zoom 12 ogni quadrato prende il valore migliore dei vicini, così
 *   un posto ottimo non sparisce nella sfumatura.
 */
let eraVicino = null, eraMassimi = null;
function aggiornaStileZoom() {
  const vicino = mappa.getZoom() >= ZOOM_NETTO;
  const massimi = mappa.getZoom() < ZOOM_MASSIMI;
  if (vicino !== eraVicino) {
    document.querySelector(".contenitore-mappa").classList.toggle("quadrati-netti", vicino);
    Object.values(stato.zone).forEach((z) => (vicino ? z.immagine.addTo(mappa) : z.immagine.remove()));
    Object.values(stato.aree).forEach((a) => (vicino ? a.immagine.remove() : a.immagine.addTo(mappa)));
    eraVicino = vicino;
    eraMassimi = massimi;
    dipingiTutte();
  } else if (massimi !== eraMassimi) {
    eraMassimi = massimi;
    if (!vicino) dipingiTutte();
  }
}

/** Crea le immagini (vuote): una per zona (netta) e una per area (morbida). */
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
    zona.immagine = L.imageOverlay(zona.tela.toDataURL(), limiti, { className: "quadrati", interactive: false });
  });
  Object.values(stato.aree).forEach(preparaImmagineMorbida);
}

/** Da latitudine a coordinata verticale della proiezione della mappa (Mercatore). */
function mercatore(lat) {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

/**
 * Prepara l'immagine morbida di un'area. È costruita direttamente nella
 * proiezione della mappa (Mercatore), così resta allineata anche su un'area
 * alta un grado di latitudine. Ha un bordo di 2 quadrati vuoti dove la
 * sfumatura può allargarsi.
 */
function preparaImmagineMorbida(a) {
  const M = 2;
  a.R0 = a.rMin * N - M; a.R1 = (a.rMax + 1) * N - 1 + M;
  a.C0 = a.cMin * N - M; a.C1 = (a.cMax + 1) * N - 1 + M;
  a.W = a.C1 - a.C0 + 1; a.H = a.R1 - a.R0 + 1;
  const latSud = a.sud + a.R0 * a.passoLat, latNord = a.sud + (a.R1 + 1) * a.passoLat;
  const lonOvest = a.ovest + a.C0 * a.passoLon, lonEst = a.ovest + (a.C1 + 1) * a.passoLon;
  a.pxW = a.W * PIXEL_PER_QUADRATO;
  const scala = a.pxW / ((lonEst - lonOvest) * Math.PI / 180);   // pixel per unità di Mercatore
  a.pxH = Math.round((mercatore(latNord) - mercatore(latSud)) * scala);
  // Per ogni riga di pixel, la riga di quadrati che ci cade (dall'alto, cioè da nord)
  a.rigaDelPixel = new Int32Array(a.pxH);
  for (let y = 0; y < a.pxH; y++) {
    const m = mercatore(latNord) - (y + 0.5) / scala;
    const lat = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI;
    a.rigaDelPixel[y] = Math.min(a.H - 1, Math.max(0, Math.floor((lat - latSud) / a.passoLat)));
  }
  a.tela = document.createElement("canvas");
  a.tela.width = a.pxW; a.tela.height = a.pxH;
  a.sfumata = document.createElement("canvas");
  a.sfumata.width = a.pxW; a.sfumata.height = a.pxH;
  a.immagine = L.imageOverlay(a.tela.toDataURL(), [[latSud, lonOvest], [latNord, lonEst]],
    { className: "quadrati-morbidi", interactive: false });
}

/** Ricolora tutto dopo un cambio di specie o di giorno. */
function ricolora() {
  mappa.closePopup();
  dipingiTutte();
  segnaGiorniMigliori();
  if (stato.posizione) aggiornaVicini();
  if (!document.getElementById("pannello-migliori").hidden) mostraMiglioriQui();
  if (!document.getElementById("pannello-preferiti").hidden) mostraPreferiti();
}

/** Ridipinge solo le immagini che si stanno vedendo. */
function dipingiTutte() {
  if (mappa.getZoom() >= ZOOM_NETTO) Object.values(stato.zone).forEach(dipingiZona);
  else Object.values(stato.aree).forEach(dipingiArea);
}

/** Colori già pronti per i punteggi interi da 0 a 100: [r, g, b, alfa]. */
let TAVOLOZZA = [];
function preparaTavolozza() {
  TAVOLOZZA = Array.from({ length: 101 }, (_, v) => [...coloreRgb(v), Math.round(255 * opacita(v))]);
  document.querySelector(".contenitore-mappa").classList.toggle("scala-daltonici", scalaDaltonici);
}

/** Toccando la legenda si passa da una scala di colori all'altra. */
function preparaLegenda() {
  preparaTavolozza();
  document.querySelector(".legenda").addEventListener("click", () => {
    scalaDaltonici = !scalaDaltonici;
    ricorda("scala-colori", scalaDaltonici ? "daltonici" : "classica");
    preparaTavolozza();
    ricolora();
    messaggio(scalaDaltonici ? "Colori per daltonici: dal viola (sfavorevole) al giallo (ottimo)."
                             : "Colori classici: dal verde (sfavorevole) al rosso (ottimo).");
  });
}

/** Ogni valore diventa il migliore fra sé e gli 8 vicini (celle vuote escluse). */
function massimiDeiVicini(valori, W, H) {
  const finali = new Float32Array(valori);
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
  return finali;
}

/** Dipinge l'immagine netta di una zona: un pixel per quadrato. */
function dipingiZona(zona) {
  const W = zona.larghezza, H = zona.altezza;
  const ctx = zona.tela.getContext("2d");
  const img = ctx.createImageData(W, H);
  zona.celle.forEach((cella) => {
    for (let k = 0; k < N * N; k++) {
      if (stato.statiche[cella.id][k * DATI_PER_QUADRATO] === VUOTO) continue;
      const x = (cella.colonna - zona.cMin) * N + (k % N);
      const y = H - 1 - ((cella.riga - zona.rMin) * N + Math.floor(k / N)); // nord in alto
      const colore4 = TAVOLOZZA[Math.round(punteggioQuadrato(cella, k))];
      img.data.set(colore4, (y * W + x) * 4);
    }
  });
  ctx.putImageData(img, 0, 0);
  zona.immagine.setUrl(zona.tela.toDataURL());
}

/** Dipinge l'immagine morbida di un'area e la sfuma. */
function dipingiArea(a) {
  // 1. il punteggio di ogni quadrato, in una griglia con righe da sud a nord
  let valori = new Float32Array(a.W * a.H).fill(-1);
  a.celle.forEach((cella) => {
    for (let k = 0; k < N * N; k++) {
      if (stato.statiche[cella.id][k * DATI_PER_QUADRATO] === VUOTO) continue;
      const R = cella.riga * N + Math.floor(k / N), C = cella.colonna * N + (k % N);
      valori[(R - a.R0) * a.W + (C - a.C0)] = punteggioQuadrato(cella, k);
    }
  });
  if (mappa.getZoom() < ZOOM_MASSIMI) valori = massimiDeiVicini(valori, a.W, a.H);

  // 2. i pixel: ogni quadrato è largo 4 pixel, e alto quanto vuole la proiezione
  const ctx = a.tela.getContext("2d");
  const img = ctx.createImageData(a.pxW, a.pxH);
  for (let y = 0; y < a.pxH; y++) {
    const riga = a.rigaDelPixel[y] * a.W;
    for (let x = 0; x < a.pxW; x++) {
      const v = valori[riga + Math.floor(x / PIXEL_PER_QUADRATO)];
      if (v >= 0) img.data.set(TAVOLOZZA[Math.round(v)], (y * a.pxW + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);

  // 3. la sfumatura (dove il browser non sa sfocare, resta l'immagine com'è)
  const sfuma = a.sfumata.getContext("2d");
  sfuma.clearRect(0, 0, a.pxW, a.pxH);
  if ("filter" in sfuma) sfuma.filter = `blur(${PIXEL_PER_QUADRATO * 0.9}px)`;
  sfuma.drawImage(a.tela, 0, 0);
  sfuma.filter = "none";
  a.sfumata.toBlob((blob) => {
    if (!blob) return;
    if (a.url) URL.revokeObjectURL(a.url);
    a.url = URL.createObjectURL(blob);
    a.immagine.setUrl(a.url);
  });
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

  document.getElementById("modo-seleziona").addEventListener("click", () => impostaModalita(!stato.selezionando));
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
  document.getElementById("modo-seleziona").setAttribute("aria-pressed", String(seleziona));
  document.querySelector(".contenitore-mappa").classList.toggle("selezionando", seleziona);
  const comandi = [mappa.dragging, mappa.touchZoom, mappa.doubleClickZoom, mappa.boxZoom];
  comandi.forEach((c) => (seleziona ? c.disable() : c.enable()));
  mappa.closePopup();
  if (seleziona) {
    messaggio("Tocca i quadrati o passaci sopra col dito. Se chiudi un anello, si riempie anche l'interno. Ritocca il pulsante per tornare a spostare la mappa.", 6000);
  }
}

// ---------------------------------------------------------------------------
// Pulsanti sulla mappa: mappe, canaloni, dal web, zoom
// ---------------------------------------------------------------------------

function preparaStrumenti() {
  const mappe = document.getElementById("apri-strati");
  mappe.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const menu = stato.menuMappe;
    const aperto = menu.getContainer().classList.contains("leaflet-control-layers-expanded");
    if (aperto) menu.collapse(); else menu.expand();
    mappe.setAttribute("aria-expanded", String(!aperto));
  });
  mappa.on("click", () => mappe.setAttribute("aria-expanded", "false"));

  // Canaloni e posti dal web: il pulsante si accende quando lo strato è sulla mappa
  const interruttore = (id, attivo, accendi, spegni) => {
    const b = document.getElementById(id);
    b.addEventListener("click", async () => {
      if (attivo()) spegni(); else await accendi();
      b.setAttribute("aria-pressed", String(attivo()));
    });
  };
  interruttore("mostra-canaloni", () => !!stato.canaloni, accendiCanaloni, spegniCanaloni);
  interruttore("mostra-web", () => !!stratoWeb, accendiWeb, spegniWeb);

  document.getElementById("zoom-piu").addEventListener("click", () => mappa.zoomIn());
  document.getElementById("zoom-meno").addEventListener("click", () => mappa.zoomOut());
}

// ---------------------------------------------------------------------------
// Canaloni
// ---------------------------------------------------------------------------

function spegniCanaloni() {
  if (stato.canaloni) stato.canaloni.remove();
  stato.canaloni = null;
}

async function accendiCanaloni() {
  if (stato.canaloni) return;
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
    <dt>Media ${r.giorni_temperatura} gg</dt><dd>${numero(m.tr[g], 1)} °C</dd>
    ${m.g && m.g[g] ? `<dt>Gelo</dt><dd>${m.g[g]} ${m.g[g] === 1 ? "notte" : "notti"} sotto zero nell'ultima settimana</dd>` : ""}`;
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

// ---------------------------------------------------------------------------
// Aree protette (parchi, riserve, siti Natura 2000)
// ---------------------------------------------------------------------------

let areeProtette = null;

/** Scarica (una volta sola) i confini delle aree protette; null se non riesce. */
async function caricaAreeProtette() {
  if (!areeProtette) {
    try { areeProtette = await caricaJson("data/aree_protette.json"); } catch (e) { return null; }
  }
  return areeProtette;
}

/** Vero se il punto sta dentro l'anello (regola del raggio: conta gli attraversamenti). */
function dentroAnello(lat, lon, anello) {
  let dentro = false;
  for (let i = 0, j = anello.length - 1; i < anello.length; j = i++) {
    const [xi, yi] = anello[i], [xj, yj] = anello[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function dentroPoligono(lat, lon, poligono) {
  // Il primo anello è il bordo, gli altri sono buchi
  return dentroAnello(lat, lon, poligono[0]) && !poligono.slice(1).some((b) => dentroAnello(lat, lon, b));
}

/** Aree protette che contengono il punto. */
async function areeProtetteInPunto(punto) {
  const dati = await caricaAreeProtette();
  if (!dati) return [];
  const trovate = [];
  dati.features.forEach((f) => {
    const g = f.geometry;
    const poligoni = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    if (poligoni.some((pol) => dentroPoligono(punto.lat, punto.lng, pol))) trovate.push(f.properties);
  });
  // Una volta sola per nome (lo stesso parco può comparire in due aree)
  return trovate.filter((a, i) => trovate.findIndex((b) => b.nome === a.nome) === i);
}

/** Righe della scheda sulle aree protette, con i link alle regole. */
function righeAreeProtette(aree) {
  if (!aree.length) return "";
  const voci = aree.map((a) => {
    const nome = testoSicuro(a.nome);
    if (a.tipo === "natura2000") {
      return `<a href="https://natura2000.eea.europa.eu/Natura2000/SDF.aspx?site=${encodeURIComponent(a.codice)}" target="_blank" rel="noopener">${nome}</a> (Natura 2000)`;
    }
    const cerca = encodeURIComponent(`${a.nome} regolamento raccolta funghi`);
    return `<a href="https://www.google.com/search?q=${cerca}" target="_blank" rel="noopener">${nome}</a>`;
  });
  return `<div class="area-protetta"><strong>Area protetta:</strong> ${voci.join(", ")}.
    La raccolta può avere regole proprie: verificale sul sito dell'ente prima di andare.</div>`;
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

  let scheda, protette;
  try {
    [scheda, protette] = await Promise.all([
      schedeDellaZona(q.cella.zona_id).then((z) => z[q.cella.id][q.k]),
      areeProtetteInPunto(centro),
    ]);
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
        ${barraFattore("Stagione", voce.fs ? voce.fs[g] : stato.punteggi.specie[k].stagione[g])}
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
        ${etichettaTendenza(tendenza(q.cella, q.k))}
      </div>
      ${righeAreeProtette(protette)}
      <div class="preferito" data-preferito></div>
      <a class="bottone-secondario indicazioni" target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${centro.lat.toFixed(5)},${centro.lng.toFixed(5)}">Indicazioni per arrivare qui</a>
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

  const finestra = L.popup().setLatLng(centro).setContent(html).openOn(mappa);
  const box = document.querySelector(".leaflet-popup [data-preferito]");
  if (box) sezionePreferito(box, q);
  finestra.update();   // la riga dei preferiti allunga la scheda: rifacciamo i conti
}

/**
 * Ogni scheda (quadrato, posto dal web, ricerca) sta tutta dentro la mappa:
 * larga al massimo quanto lo schermo meno i margini, alta al massimo quanto
 * la mappa meno la punta della scheda. Se il testo è più lungo, scorre.
 */
function adattaScheda(scheda) {
  const { x, y } = mappa.getSize();
  const o = scheda.options;
  o.maxWidth = Math.min(300, x - 60);
  o.minWidth = Math.min(o.minWidth || 50, o.maxWidth);
  o.maxHeight = Math.max(160, y - 70);
  o.autoPanPaddingTopLeft = [12, 12];
  o.autoPanPaddingBottomRight = [12, 12];
  scheda.update();
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

      document.getElementById("messaggio").hidden = true;
      if (stato.selezionando) impostaModalita(false);
      stato.posizione = punto;
      stato.vicinoMostrato = 0;
      aggiornaVicini();
      // Inquadra te e i tre posti
      const limiti = L.latLngBounds([punto, ...stato.vicini.map((v) => v.centro)]);
      mappa.fitBounds(limiti, { padding: [40, 40], maxZoom: 14 });
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
// I 3 posti migliori vicino a te
// ---------------------------------------------------------------------------

/** Distanza in km fra due punti (formula dell'emisenoverso). */
function distanzaKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Direzione da a verso b, come "nord-est". */
function direzione(a, b) {
  const y = b.lat - a.lat, x = (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180);
  const nomi = ["est", "nord-est", "nord", "nord-ovest", "ovest", "sud-ovest", "sud", "sud-est"];
  const angolo = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return nomi[Math.round(angolo / 45) % 8];
}

/**
 * Sceglie i 3 posti (quadrati da 500 m) migliori per punteggio e distanza.
 *   valore = punteggio / (1 + distanza / 15 km)
 * Un posto a 15 km conta la metà di uno uguale vicinissimo. I tre posti
 * distano almeno 1,5 km fra loro, così non sono tre quadrati attaccati.
 */
function calcolaVicini() {
  const candidati = [];
  stato.celle.forEach((cella) => {
    for (let k = 0; k < N * N; k++) {
      if (stato.statiche[cella.id][k * DATI_PER_QUADRATO] === VUOTO) continue;
      const p = punteggioQuadrato(cella, k);
      if (p < 5) continue;
      const R = cella.riga * N + Math.floor(k / N), C = cella.colonna * N + (k % N);
      const centro = L.latLngBounds(confiniQuadrato(cella.area, R, C)).getCenter();
      const d = distanzaKm(stato.posizione, centro);
      candidati.push({ q: { area: cella.area, R, C, cella, k }, centro, punteggio: p, distanza: d,
                       valore: p / (1 + d / DISTANZA_META_KM) });
    }
  });
  candidati.sort((a, b) => b.valore - a.valore);
  const scelti = [];
  for (const c of candidati) {
    if (scelti.every((s) => distanzaKm(s.centro, c.centro) >= DISTANZA_MINIMA_KM)) scelti.push(c);
    if (scelti.length === 3) break;
  }
  return scelti;
}

function preparaVicini() {
  stato.stratoVicini = L.layerGroup().addTo(mappa);
  document.getElementById("vicino-prima").addEventListener("click", () => mostraVicino(stato.vicinoMostrato - 1));
  document.getElementById("vicino-dopo").addEventListener("click", () => mostraVicino(stato.vicinoMostrato + 1));
  document.getElementById("vicino-vai").addEventListener("click", () => {
    const v = stato.vicini[stato.vicinoMostrato];
    if (!v) return;
    mappa.once("moveend", () => apriSchedaQuadrato(v.q));
    mappa.setView(v.centro, 15);
  });
  document.getElementById("vicini-chiudi").addEventListener("click", () => {
    stato.posizione = null;
    stato.vicini = [];
    stato.stratoVicini.clearLayers();
    document.getElementById("vicini").hidden = true;
    document.querySelector(".contenitore-mappa").classList.remove("vicini-aperti");
  });
}

/** Ricalcola i 3 posti (per esempio dopo un cambio di specie o di giorno). */
function aggiornaVicini() {
  stato.vicini = calcolaVicini();
  const riquadro = document.getElementById("vicini");
  riquadro.hidden = false;
  document.querySelector(".contenitore-mappa").classList.add("vicini-aperti");
  mostraVicino(Math.min(stato.vicinoMostrato, Math.max(0, stato.vicini.length - 1)));
}

function mostraVicino(i) {
  const n = stato.vicini.length;
  const testo = document.getElementById("vicino-testo");
  if (!n) {
    stato.stratoVicini.clearLayers();
    testo.innerHTML = "Nessun posto favorevole per le specie e il giorno scelti.";
    ["vicino-prima", "vicino-dopo", "vicino-vai"].forEach((id) => { document.getElementById(id).disabled = true; });
    document.getElementById("vicino-indicazioni").hidden = true;
    return;
  }
  stato.vicinoMostrato = (i + n) % n;   // le frecce girano in tondo
  const v = stato.vicini[stato.vicinoMostrato];
  testo.innerHTML = `
    <span class="posizione-classifica">${stato.vicinoMostrato + 1} di ${n}</span>
    <strong style="color:${colore(v.punteggio)}">${Math.round(v.punteggio)}</strong> ${giudizio(v.punteggio).toLowerCase()}
    ${etichettaTendenza(tendenza(v.q.cella, v.q.k))}
    · ${numero(v.distanza, 1)} km a ${direzione(stato.posizione, v.centro)}
    <span class="luogo">${v.q.cella.zona}</span>`;
  ["vicino-prima", "vicino-dopo"].forEach((id) => { document.getElementById(id).disabled = n < 2; });
  document.getElementById("vicino-vai").disabled = false;
  const link = document.getElementById("vicino-indicazioni");
  link.hidden = false;
  link.href = `https://www.google.com/maps/dir/?api=1&destination=${v.centro.lat.toFixed(5)},${v.centro.lng.toFixed(5)}`;

  // Segnaposti numerati sulla mappa, quello mostrato più grande
  stato.stratoVicini.clearLayers();
  stato.vicini.forEach((w, j) => {
    const icona = L.divIcon({
      className: "",
      html: `<div class="segnaposto${j === stato.vicinoMostrato ? " attivo" : ""}">${j + 1}</div>`,
      iconSize: [28, 28], iconAnchor: [14, 14],
    });
    L.marker(w.centro, { icon: icona, keyboard: false })
      .on("click", () => mostraVicino(j))
      .addTo(stato.stratoVicini);
  });
}

// ---------------------------------------------------------------------------
// Migliori posti qui: i 5 quadrati migliori sullo schermo
// ---------------------------------------------------------------------------

const MIGLIORI_QUI = 5;
const DISTANZA_MIGLIORI_KM = 1;   // i 5 posti distano almeno 1 km fra loro

function preparaMiglioriQui() {
  const pannello = document.getElementById("pannello-migliori");
  document.getElementById("migliori-qui").addEventListener("click", () => {
    if (pannello.hidden) mostraMiglioriQui(); else chiudiMiglioriQui();
  });
  document.getElementById("migliori-chiudi").addEventListener("click", chiudiMiglioriQui);
}

function chiudiMiglioriQui() {
  document.getElementById("pannello-migliori").hidden = true;
  document.getElementById("migliori-qui").setAttribute("aria-pressed", "false");
}

function mostraMiglioriQui() {
  const pannello = document.getElementById("pannello-migliori");
  pannello.hidden = false;
  document.getElementById("migliori-qui").setAttribute("aria-pressed", "true");
  document.getElementById("migliori-giorno").textContent = dataBreve(stato.punteggi.giorni[stato.giorno]);

  const candidati = quadratiSulloSchermo()
    .map((q) => ({ q, p: punteggioQuadrato(q.cella, q.k), centro: L.latLngBounds(confiniQuadrato(q.area, q.R, q.C)).getCenter() }))
    .sort((a, b) => b.p - a.p);
  const scelti = [];
  for (const c of candidati) {
    if (c.p < 1) break;
    if (scelti.every((s) => distanzaKm(s.centro, c.centro) >= DISTANZA_MIGLIORI_KM)) scelti.push(c);
    if (scelti.length === MIGLIORI_QUI) break;
  }

  const elenco = document.getElementById("elenco-migliori");
  if (!scelti.length) {
    elenco.innerHTML = `<li class="vuoto">Nessun posto favorevole sullo schermo per le specie e il giorno scelti.</li>`;
    return;
  }
  elenco.innerHTML = scelti.map((c, i) => {
    const distanza = stato.posizione ? ` · ${numero(distanzaKm(stato.posizione, c.centro), 1)} km da te` : "";
    return `<li><button type="button" data-posto="${i}">
        <span class="numero-posto">${i + 1}</span>
        <span class="dettagli-posto">
          <strong style="color:${colore(c.p)}">${Math.round(c.p)}</strong> ${giudizio(c.p).toLowerCase()}
          ${etichettaTendenza(tendenza(c.q.cella, c.q.k))}${distanza}
          <span class="luogo">${c.q.cella.zona}</span>
        </span>
      </button></li>`;
  }).join("");
  elenco.querySelectorAll("button[data-posto]").forEach((b) => {
    b.addEventListener("click", () => {
      const c = scelti[Number(b.dataset.posto)];
      chiudiMiglioriQui();
      mappa.once("moveend", () => apriSchedaQuadrato(c.q));
      mappa.setView(c.centro, Math.max(mappa.getZoom(), 15));
    });
  });
}

// ---------------------------------------------------------------------------
// Ricerca di un posto: è buono o no?
// ---------------------------------------------------------------------------

const RAGGIO_RICERCA_KM = 3;   // si cerca anche il quadrato migliore entro questa distanza
let segnaRicerca = null;

/** I nomi arrivano da un servizio esterno: niente HTML dentro. */
function testoSicuro(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Il quadrato migliore entro `km` da un punto, per il giorno scelto; null se non ce ne sono. */
function migliorEntro(punto, km) {
  let migliore = null;
  stato.celle.forEach((cella) => {
    const centroCella = L.latLng((cella.bbox[0] + cella.bbox[2]) / 2, (cella.bbox[1] + cella.bbox[3]) / 2);
    if (distanzaKm(punto, centroCella) > km + 2.5) return;   // cella troppo lontana
    for (let k = 0; k < N * N; k++) {
      if (stato.statiche[cella.id][k * DATI_PER_QUADRATO] === VUOTO) continue;
      const R = cella.riga * N + Math.floor(k / N), C = cella.colonna * N + (k % N);
      const centro = L.latLngBounds(confiniQuadrato(cella.area, R, C)).getCenter();
      const d = distanzaKm(punto, centro);
      if (d > km) continue;
      const p = punteggioQuadrato(cella, k);
      if (!migliore || p > migliore.punteggio) {
        migliore = { q: { area: cella.area, R, C, cella, k }, centro, punteggio: p, distanza: d };
      }
    }
  });
  return migliore;
}

const ATTESA_SUGGERIMENTI_MS = 350;   // pausa nella scrittura prima di chiedere i suggerimenti
let timerSuggerimenti = null;
let ultimaRicerca = null;             // per annullare le richieste superate

function preparaRicerca() {
  const modulo = document.getElementById("ricerca");
  const campo = document.getElementById("testo-ricerca");
  const elenco = document.getElementById("risultati-ricerca");
  const lente = document.getElementById("apri-ricerca");

  // La lente apre e chiude la barra; la x la chiude e toglie il segnaposto
  lente.addEventListener("click", () => (modulo.hidden ? apriRicerca() : chiudiRicerca()));
  document.getElementById("chiudi-ricerca").addEventListener("click", () => chiudiRicerca(true));

  // Suggerimenti mentre scrivi, dopo 3 lettere e una piccola pausa
  campo.addEventListener("input", () => {
    clearTimeout(timerSuggerimenti);
    const testo = campo.value.trim();
    if (testo.length < 3) { elenco.hidden = true; return; }
    timerSuggerimenti = setTimeout(() => cercaPosto(testo), ATTESA_SUGGERIMENTI_MS);
  });
  // Invio: cerca subito
  modulo.addEventListener("submit", (ev) => {
    ev.preventDefault();
    clearTimeout(timerSuggerimenti);
    const testo = campo.value.trim();
    if (testo.length >= 2) cercaPosto(testo);
  });
  // L'elenco si chiude toccando fuori
  document.addEventListener("click", (ev) => {
    if (!modulo.contains(ev.target) && ev.target !== lente && !lente.contains(ev.target)) elenco.hidden = true;
  });
}

function apriRicerca() {
  document.getElementById("ricerca").hidden = false;
  document.getElementById("apri-ricerca").setAttribute("aria-expanded", "true");
  document.getElementById("testo-ricerca").focus();
}

/** Chiude la barra; con `togliSegnaposto` cancella anche il testo e il segnaposto. */
function chiudiRicerca(togliSegnaposto = false) {
  document.getElementById("ricerca").hidden = true;
  document.getElementById("risultati-ricerca").hidden = true;
  document.getElementById("apri-ricerca").setAttribute("aria-expanded", "false");
  if (togliSegnaposto) {
    document.getElementById("testo-ricerca").value = "";
    togliSegnaRicerca();
  }
}

function togliSegnaRicerca() {
  if (segnaRicerca) { segnaRicerca.remove(); segnaRicerca = null; }
}

/**
 * Cerca il posto con Photon (komoot), un servizio sui dati di OpenStreetMap
 * fatto apposta per i suggerimenti mentre scrivi. Si cerca in Italia,
 * preferendo i posti vicini al centro della mappa.
 */
async function cercaPosto(testo) {
  const elenco = document.getElementById("risultati-ricerca");
  if (elenco.hidden || !elenco.querySelector(".risultato")) {
    elenco.hidden = false;
    elenco.innerHTML = `<li class="nota-ricerca">Cerco "${testoSicuro(testo)}"…</li>`;
  }
  if (ultimaRicerca) ultimaRicerca.abort();   // una richiesta superata non serve più
  ultimaRicerca = new AbortController();
  const centro = mappa.getCenter();
  const parametri = new URLSearchParams({
    q: testo, limit: "5", lang: "default",
    lat: centro.lat.toFixed(3), lon: centro.lng.toFixed(3),
    bbox: "6.6,35.4,18.6,47.1",   // Italia
  });
  let risultati;
  try {
    const risposta = await fetch(`https://photon.komoot.io/api/?${parametri}`, { signal: ultimaRicerca.signal });
    if (!risposta.ok) throw new Error(risposta.status);
    risultati = (await risposta.json()).features.map((f) => {
      const p = f.properties;
      return {
        name: p.name || p.street || testo,
        display_name: [p.name || p.street, p.city || p.county || p.district, p.state].filter(Boolean).join(", "),
        lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      };
    });
  } catch (errore) {
    if (errore.name === "AbortError") return;
    elenco.innerHTML = `<li class="nota-ricerca">La ricerca non risponde. Controlla la connessione e riprova.</li>`;
    return;
  }
  if (document.getElementById("ricerca").hidden) return;   // la barra è stata chiusa nel frattempo
  if (!risultati.length) {
    elenco.innerHTML = `<li class="nota-ricerca">Nessun posto trovato. Prova con un nome diverso.</li>`;
    return;
  }

  const giorno = dataBreve(stato.punteggi.giorni[stato.giorno]);
  const voci = risultati.map((r) => {
    const punto = L.latLng(Number(r.lat), Number(r.lon));
    const qui = quadratoInPunto(punto);
    const migliore = migliorEntro(punto, RAGGIO_RICERCA_KM);
    return { r, punto, qui, pQui: qui ? punteggioQuadrato(qui.cella, qui.k) : null, migliore };
  });

  elenco.innerHTML = voci.map((v, i) => {
    const dove = testoSicuro(v.r.display_name.split(", ").slice(1, 4).join(", "));
    let valutazione;
    if (!v.qui && !v.migliore) {
      valutazione = "Fuori dalle aree coperte da FungoMeter.";
    } else {
      const parti = [];
      if (v.qui) {
        parti.push(`Qui: <strong style="color:${colore(v.pQui)}">${Math.round(v.pQui)}</strong> ${giudizio(v.pQui).toLowerCase()} ` +
                   etichettaTendenza(tendenza(v.qui.cella, v.qui.k)));
      } else {
        parti.push("Il punto esatto è fuori dalle aree coperte.");
      }
      if (v.migliore && (!v.qui || v.migliore.punteggio > v.pQui + 2)) {
        parti.push(`Entro ${RAGGIO_RICERCA_KM} km il migliore: <strong style="color:${colore(v.migliore.punteggio)}">` +
                   `${Math.round(v.migliore.punteggio)}</strong> a ${numero(v.migliore.distanza, 1)} km verso ${direzione(v.punto, v.migliore.centro)}`);
      }
      valutazione = parti.join("<br>");
    }
    const azioni = [];
    if (v.qui) azioni.push(`<button type="button" class="principale" data-azione="qui" data-i="${i}">Vedi il posto</button>`);
    else azioni.push(`<button type="button" class="principale" data-azione="posto" data-i="${i}">Vai sulla mappa</button>`);
    if (v.migliore && (!v.qui || v.migliore.punteggio > v.pQui + 2)) {
      azioni.push(`<button type="button" data-azione="migliore" data-i="${i}">Vai al migliore vicino</button>`);
    }
    return `<li class="risultato">
        <span class="nome-posto">${testoSicuro(v.r.name || v.r.display_name.split(",")[0])}</span>
        <span class="dove">${dove}</span>
        <div class="valutazione">${valutazione}</div>
        <div class="azioni-risultato">${azioni.join("")}</div>
      </li>`;
  }).join("") + `<li class="attribuzione">${giorno} · ricerca Photon, dati © OpenStreetMap</li>`;

  elenco.querySelectorAll("button[data-azione]").forEach((b) => {
    b.addEventListener("click", () => {
      const v = voci[Number(b.dataset.i)];
      elenco.hidden = true;
      document.getElementById("testo-ricerca").blur();
      togliSegnaRicerca();
      const contenuto = document.createElement("div");
      contenuto.className = "segnaposto-ricerca";
      contenuto.innerHTML = `<strong>${testoSicuro(v.r.name || "")}</strong><br>` +
        `<button type="button">Togli segnaposto</button>`;
      contenuto.querySelector("button").addEventListener("click", (e) => {
        L.DomEvent.stopPropagation(e);   // il tocco non deve arrivare alla mappa
        mappa.closePopup(); togliSegnaRicerca();
      });
      segnaRicerca = L.marker(v.punto, { title: v.r.name || "" }).bindPopup(contenuto).addTo(mappa);
      document.getElementById("ricerca").hidden = true;
      document.getElementById("apri-ricerca").setAttribute("aria-expanded", "false");
      if (stato.selezionando) impostaModalita(false);
      const bersaglio = b.dataset.azione === "migliore" ? v.migliore.q : b.dataset.azione === "qui" ? v.qui : null;
      const centro = b.dataset.azione === "migliore" ? v.migliore.centro : v.punto;
      const zoom = Math.max(mappa.getZoom(), 14);
      const giaLi = mappa.getCenter().distanceTo(centro) < 5 && mappa.getZoom() === zoom;
      if (bersaglio && giaLi) apriSchedaQuadrato(bersaglio);
      else if (bersaglio) mappa.once("moveend", () => apriSchedaQuadrato(bersaglio));
      mappa.setView(centro, zoom);
    });
  });
}

// ---------------------------------------------------------------------------
// Posti preferiti (salvati solo nel telefono)
// ---------------------------------------------------------------------------

let preferiti = [];           // [{nome, area, R, C}]
let stratoPreferiti = null;

function chiavePreferito(q) {
  return `${q.area}:${q.R}:${q.C}`;
}

function salvaPreferiti() {
  ricorda("preferiti", JSON.stringify(preferiti));
  disegnaPreferiti();
  if (!document.getElementById("pannello-preferiti").hidden) mostraPreferiti();
}

function preparaPreferiti() {
  try { preferiti = JSON.parse(ricordato("preferiti") || "[]"); } catch (e) { preferiti = []; }
  stratoPreferiti = L.layerGroup().addTo(mappa);
  disegnaPreferiti();
  const pannello = document.getElementById("pannello-preferiti");
  document.getElementById("apri-preferiti").addEventListener("click", () => {
    if (pannello.hidden) mostraPreferiti(); else pannello.hidden = true;
  });
  document.getElementById("preferiti-chiudi").addEventListener("click", () => { pannello.hidden = true; });
}

/** Stelline sulla mappa per i preferiti; toccandole si apre la scheda. */
function disegnaPreferiti() {
  stratoPreferiti.clearLayers();
  preferiti.forEach((f) => {
    const q = quadrato(f.area, f.R, f.C);
    if (!q) return;
    const centro = L.latLngBounds(confiniQuadrato(f.area, f.R, f.C)).getCenter();
    const icona = L.divIcon({ className: "", html: '<div class="stella-preferito">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    L.marker(centro, { icon: icona, title: f.nome, keyboard: false })
      .on("click", () => { if (!stato.selezionando) apriSchedaQuadrato(q); })
      .addTo(stratoPreferiti);
  });
}

/** Nella scheda: "Salva nei preferiti" (con il nome) oppure "Nei preferiti, togli". */
function sezionePreferito(box, q) {
  // Il pulsante viene sostituito durante il tocco: Leaflet non lo trova più
  // dentro la scheda e passerebbe il tocco alla mappa, che riaprirebbe la
  // scheda. Lo fermiamo qui, con l'evento del browser (una volta sola per box).
  if (!box.dataset.fermo) {
    box.addEventListener("click", (e) => e.stopPropagation());
    box.dataset.fermo = "1";
  }
  const chiave = chiavePreferito(q);
  const esistente = preferiti.find((f) => chiavePreferito(f) === chiave);
  if (esistente) {
    box.innerHTML = `<button type="button" class="salvato">★ Nei preferiti: ${testoSicuro(esistente.nome)} (togli)</button>`;
    box.querySelector("button").addEventListener("click", () => {
      preferiti = preferiti.filter((f) => chiavePreferito(f) !== chiave);
      salvaPreferiti();
      sezionePreferito(box, q);
    });
    return;
  }
  box.innerHTML = `<button type="button">☆ Salva nei preferiti</button>`;
  box.querySelector("button").addEventListener("click", () => {
    const proposta = (q.cella.zona.split(/[,:(]/)[0] || "Posto").trim();
    box.innerHTML = `<form><input type="text" maxlength="40" aria-label="Nome del posto" value="${testoSicuro(proposta)}">
      <button type="submit">Salva</button></form>`;
    const campo = box.querySelector("input");
    campo.focus(); campo.select();
    box.querySelector("form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      preferiti.push({ nome: campo.value.trim() || proposta, area: q.area, R: q.R, C: q.C });
      salvaPreferiti();
      sezionePreferito(box, q);
      messaggio("Salvato nei preferiti.");
    });
  });
}

/** Elenco dei preferiti con punteggio di oggi, tendenza e gli 8 giorni. */
function mostraPreferiti() {
  const pannello = document.getElementById("pannello-preferiti");
  const elenco = document.getElementById("elenco-preferiti");
  pannello.hidden = false;
  document.getElementById("preferiti-giorno").textContent = dataBreve(stato.punteggi.giorni[stato.giorno]);
  if (!preferiti.length) {
    elenco.innerHTML = `<li class="vuoto">Ancora nessun preferito. Tocca un quadrato sulla mappa e usa "Salva nei preferiti".</li>`;
    return;
  }
  elenco.innerHTML = preferiti.map((f, i) => {
    const q = quadrato(f.area, f.R, f.C);
    if (!q) return `<li class="vuoto">${testoSicuro(f.nome)}: quadrato non più disponibile <button type="button" class="togli" data-togli="${i}" aria-label="Togli">✕</button></li>`;
    const p = punteggioQuadrato(q.cella, q.k);
    const valori = stato.punteggi.giorni.map((_, g) => punteggioQuadrato(q.cella, q.k, g));
    const migliori = giorniMigliori(valori);
    const centro = L.latLngBounds(confiniQuadrato(f.area, f.R, f.C)).getCenter();
    const distanza = stato.posizione ? ` · ${numero(distanzaKm(stato.posizione, centro), 1)} km` : "";
    const mini = valori.map((v, g) => `<span style="background:${colore(v)}" title="${dataBreve(stato.punteggi.giorni[g])}: ${Math.round(v)}">${migliori.includes(g) ? "★" : Math.round(v)}</span>`).join("");
    return `<li>
        <button type="button" data-vai="${i}">
          <span class="dettagli-posto">
            <strong>${testoSicuro(f.nome)}</strong> ·
            <strong style="color:${colore(p)}">${Math.round(p)}</strong> ${giudizio(p).toLowerCase()}
            ${etichettaTendenza(tendenza(q.cella, q.k))}${distanza}
            <span class="mini-giorni">${mini}</span>
          </span>
        </button>
        <button type="button" class="togli" data-togli="${i}" aria-label="Togli ${testoSicuro(f.nome)}">✕</button>
      </li>`;
  }).join("");
  elenco.querySelectorAll("[data-vai]").forEach((b) => b.addEventListener("click", () => {
    const f = preferiti[Number(b.dataset.vai)];
    const q = quadrato(f.area, f.R, f.C);
    pannello.hidden = true;
    if (stato.selezionando) impostaModalita(false);
    const centro = L.latLngBounds(confiniQuadrato(f.area, f.R, f.C)).getCenter();
    mappa.once("moveend", () => apriSchedaQuadrato(q));
    mappa.setView(centro, Math.max(mappa.getZoom(), 15));
  }));
  elenco.querySelectorAll("[data-togli]").forEach((b) => b.addEventListener("click", () => {
    preferiti.splice(Number(b.dataset.togli), 1);
    salvaPreferiti();
  }));
}

// ---------------------------------------------------------------------------
// Posti segnalati sul web (commenti pubblici di YouTube e Reddit)
// ---------------------------------------------------------------------------

let stratoWeb = null;

function spegniWeb() {
  if (stratoWeb) stratoWeb.remove();
  stratoWeb = null;
}

async function accendiWeb() {
  if (stratoWeb) return;
  {
    let dati;
    try { dati = await caricaJson("data/segnalati_web.json"); } catch (e) {
      messaggio("Non riesco a caricare i posti segnalati sul web.");
      return;
    }
    stratoWeb = L.layerGroup();
    dati.posti.forEach((p) => {
      const forza = Math.sqrt(p.fonti);
      const opzioni = { color: "#e0001b", fillColor: "#ff1a33", weight: 2 };
      // Zone ampie: alone largo e trasparente; posti precisi: cerchio pieno
      const segno = p.tipo === "zona"
        ? L.circle([p.lat, p.lon], { ...opzioni, radius: 1500 + 700 * forza, fillOpacity: 0.12, dashArray: "4 4" })
        : L.circleMarker([p.lat, p.lon], { ...opzioni, radius: 5 + 3 * forza, fillOpacity: 0.85, color: "#fff" });
      segno.bindPopup(() => schedaWeb(p));
      stratoWeb.addLayer(segno);
    });
    stratoWeb.addTo(mappa);
    // I testi presi da YouTube vanno riaggiornati almeno ogni 30 giorni
    if (dati.raccolta && (Date.now() - daIso(dati.raccolta)) / 86400000 > 30) {
      messaggio("Attenzione: i posti dal web sono stati raccolti più di un mese fa.", 5000);
      return;
    }
    messaggio(`${dati.posti.length} posti citati sul web. Toccane uno per le fonti.`, 4000);
  }
}

function schedaWeb(p) {
  const specie = Object.keys(p.specie || {});
  const link = p.link.map((l) => `<li><a href="${encodeURI(l.url)}" target="_blank" rel="noopener">${l.piattaforma === "youtube" ? "Video YouTube" : "Discussione Reddit"}</a> del ${testoSicuro(l.data)}</li>`).join("");
  const fonti = [p.youtube ? `${p.youtube} su YouTube` : "", p.reddit ? `${p.reddit} su Reddit` : ""].filter(Boolean).join(", ");
  return `<div class="scheda scheda-web">
      <h3>${testoSicuro(p.nome)}</h3>
      <div class="zona">${p.tipo === "zona" ? "Zona ampia" : "Posto"} citato da ${p.fonti} fonti (${fonti})</div>
      ${specie.length ? `<p>Specie nominate: ${specie.map(testoSicuro).join(", ")}</p>` : ""}
      <p>Ultima citazione: ${testoSicuro(p.ultima)}</p>
      ${(p.estratti || []).map((e) => `<blockquote class="estratto-web">“${testoSicuro(e.testo)}”
        <span>${e.piattaforma === "youtube" ? "YouTube" : "Reddit"}, ${testoSicuro(e.data)} ·
        <a href="${encodeURI(e.url)}" target="_blank" rel="noopener">fonte</a></span></blockquote>`).join("")}
      <ul class="fonti-web">${link}</ul>
      <p class="avviso-web">Trovato nei commenti pubblici che parlano di funghi. Una citazione non garantisce niente: può essere vecchia, sbagliata o negativa. Rispetta proprietà private e regole delle aree protette.</p>
    </div>`;
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
    // updateViaCache "none": il browser chiede sempre al server se sw.js è cambiato
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update())
      .catch((e) => console.warn("Service worker:", e));
  });
  // Quando si attiva una versione nuova dell'app, ricarica la pagina una volta sola
  let ricaricata = false;
  const cera = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!cera || ricaricata) return;   // al primissimo accesso non serve ricaricare
    ricaricata = true;
    window.location.reload();
  });
}

avvia();
