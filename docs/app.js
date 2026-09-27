/*
 * FungoMeter: la logica della mappa.
 *
 * 1. scarica data/celle.json (forma delle celle) e data/punteggi.json (punteggi)
 * 2. disegna una cella colorata per ogni quadrato da 3 km
 * 3. quando ingrandisci, carica le sottocelle da 500 m della zona e le colora
 * 4. ricolora tutto quando cambi specie o giorno, e segna i giorni migliori
 * 5. al tocco su una cella o sottocella mostra la scheda con punteggio e fattori
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
  punteggi: null,       // da punteggi.json
  filtro: "0",          // "0".."4" = una specie; "media" o "migliore" = tutte le specie
  giorno: 0,            // posizione del giorno scelto in punteggi.giorni
  area: null,           // "foligno" o "roma": l'area per i giorni migliori
  rettangoli: {},       // id cella -> rettangolo Leaflet
  sottocelle: {},       // id zona -> dati delle sottocelle (caricati quando servono)
  strato: null,         // gruppo Leaflet con le sottocelle disegnate
  disegnate: {},        // id cella -> elenco di {rettangolo, dati} delle sue sottocelle
  canaloni: null,       // gruppo Leaflet con le immagini dei canaloni
  indiceCanaloni: null, // id zona -> confini dell'immagine
};

// Da questo livello di ingrandimento in su si vedono le sottocelle da 500 m
const ZOOM_SOTTOCELLE = 13;
// I giorni da +5 in poi sono previsioni poco affidabili
const GIORNO_INCERTO = 5;

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

/** Colore di un punteggio: verde (0) > giallo > arancio > rosso (100). */
function colore(punteggio) {
  const tonalita = 120 - 1.2 * punteggio;           // 120 = verde, 0 = rosso
  const luminosita = punteggio > 40 ? 45 : 40;
  return `hsl(${tonalita} 78% ${luminosita}%)`;
}

/** Le celle con punteggio basso sono più trasparenti, così la mappa si legge. */
function opacita(punteggio) {
  return 0.12 + 0.5 * (punteggio / 100);
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

function dataBreve(iso) {
  const d = daIso(iso);
  return `${etichettaGiorno(iso)} ${d.getDate()} ${MESI[d.getMonth()]}`;
}

// ---------------------------------------------------------------------------
// Punteggi: di una specie oppure di tutte (media o la migliore)
// ---------------------------------------------------------------------------

/** È scelta una specie sola? Restituisce la sua posizione, altrimenti null. */
function specieScelta() {
  return /^\d+$/.test(stato.filtro) ? Number(stato.filtro) : null;
}

/** Combina i punteggi delle specie secondo il filtro scelto. */
function combina(valori) {
  if (stato.filtro === "media") return valori.reduce((a, b) => a + b, 0) / valori.length;
  if (stato.filtro === "migliore") return Math.max(...valori);
  return valori[Number(stato.filtro)];
}

/** Punteggio di una cella (media delle sue sottocelle migliori) per un giorno. */
function punteggioCella(idCella, giorno = stato.giorno) {
  const voci = stato.punteggi.celle[idCella].s;
  return combina(voci.map((v) => v.S[giorno]));
}

/**
 * Punteggio di una sottocella per una specie e un giorno: stessa formula del
 * programma Python (fungometer/punteggio.py).
 *   S = 100 x acqua x temperatura x stagione x habitat x quota x terreno
 * Il terreno conta di più quando è secco.
 */
function punteggioSottocellaSpecie(idCella, sotto, k, giorno) {
  const voce = stato.punteggi.celle[idCella].s[k];
  const acqua = voce.fa[giorno] / 100;
  const temperatura = voce.ft[giorno] / 100;
  const stagione = stato.punteggi.specie[k].stagione[giorno] / 100;
  const habitat = sotto[8][k] / 100;
  const quota = sotto[9][k] / 100;
  const effetto = stato.punteggi.regole.effetto_se_bagnato;
  const terreno = 1 - (1 - sotto[7] / 100) * (1 - effetto * acqua);
  return 100 * acqua * temperatura * stagione * habitat * quota * terreno;
}

function punteggioSottocella(idCella, sotto, giorno = stato.giorno) {
  const n = stato.punteggi.specie.length;
  const valori = [];
  for (let k = 0; k < n; k++) valori.push(punteggioSottocellaSpecie(idCella, sotto, k, giorno));
  return combina(valori);
}

/** Confini [sud, ovest, nord, est] della sottocella k (per righe da sud a nord). */
function bboxSottocella(bbox, k) {
  const n = stato.punteggi.regole.sottocelle_per_lato;
  const [sud, ovest, nord, est] = bbox;
  const riga = Math.floor(k / n), colonna = k % n;
  const dlat = (nord - sud) / n, dlon = (est - ovest) / n;
  return [sud + riga * dlat, ovest + colonna * dlon, sud + (riga + 1) * dlat, ovest + (colonna + 1) * dlon];
}

// ---------------------------------------------------------------------------
// Caricamento dei dati
// ---------------------------------------------------------------------------

async function caricaJson(percorso) {
  // "no-cache": chiede sempre al server se c'è una versione nuova
  const risposta = await fetch(percorso, { cache: "no-cache" });
  if (!risposta.ok) throw new Error(`${percorso}: errore ${risposta.status}`);
  return risposta.json();
}

async function avvia() {
  preparaMappa();
  preparaAvvertenze();

  try {
    const [celle, punteggi] = await Promise.all([
      caricaJson("data/celle.json"),
      caricaJson("data/punteggi.json"),
    ]);
    stato.celle = celle;
    celle.forEach((c) => { stato.cellePerId[c.id] = c; });
    stato.punteggi = punteggi;
  } catch (errore) {
    document.getElementById("aggiornamento").textContent =
      "Non riesco a caricare i dati. Controlla la connessione e ricarica la pagina.";
    console.error(errore);
    return;
  }

  mostraAggiornamento();
  preparaFiltro();
  preparaGiorni();
  preparaAree();
  disegnaCelle();
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
// Filtro: una specie, oppure tutte (media o la migliore)
// ---------------------------------------------------------------------------

function preparaFiltro() {
  const select = document.getElementById("scelta-specie");
  stato.punteggi.specie.forEach((sp, i) => {
    select.add(new Option(sp.nome, String(i)));
  });
  const gruppo = document.createElement("optgroup");
  gruppo.label = "Tutte le specie";
  gruppo.appendChild(new Option("Tutte: media", "media"));
  gruppo.appendChild(new Option("Tutte: la specie migliore", "migliore"));
  select.appendChild(gruppo);

  // Ricorda l'ultimo filtro scelto
  const salvato = ricordato("filtro");
  const valido = [...select.options].some((o) => o.value === salvato);
  stato.filtro = valido ? salvato : "0";
  select.value = stato.filtro;

  select.addEventListener("change", () => {
    stato.filtro = select.value;
    ricorda("filtro", stato.filtro);
    ricolora();
  });
}

// ---------------------------------------------------------------------------
// Selettore del giorno (oggi + 7) con i giorni migliori segnati
// ---------------------------------------------------------------------------

function etichettaGiorno(iso) {
  const differenza = Math.round((daIso(iso) - daIso(oggiIso())) / 86400000);
  if (differenza === 0) return "Oggi";
  if (differenza === 1) return "Domani";
  if (differenza === -1) return "Ieri";
  return GIORNI_SETTIMANA[daIso(iso).getDay()];
}

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
 * Indice di un giorno per l'area: media del 10% di celle migliori.
 * (Una media su tutte le celle sarebbe schiacciata da città e campi.)
 */
function indiceGiorno(giorno, celle) {
  const valori = celle.map((c) => punteggioCella(c.id, giorno)).sort((a, b) => b - a);
  const n = Math.max(1, Math.round(valori.length * 0.1));
  return valori.slice(0, n).reduce((a, b) => a + b, 0) / n;
}

/** Scrive l'indice sotto ogni giorno e mette la stella sul migliore. */
function segnaGiorniMigliori() {
  const celle = stato.area ? stato.celle.filter((c) => c.id.startsWith(stato.area + "_")) : stato.celle;
  const indici = stato.punteggi.giorni.map((_, g) => indiceGiorno(g, celle));
  const massimo = Math.max(...indici);
  const minimo = Math.min(...indici);
  const nomeArea = stato.area === "roma" ? "Roma" : stato.area === "foligno" ? "Foligno" : "tutte le aree";
  // La stella ha senso solo se i giorni sono davvero diversi fra loro
  const differenze = massimo >= 10 && massimo - minimo >= 3;

  document.querySelectorAll("#giorni button").forEach((b, i) => {
    const migliore = differenze && indici[i] >= massimo - 1;
    b.classList.toggle("migliore", migliore);
    b.querySelector(".stella").textContent = migliore ? "★" : "";
    b.querySelector(".indice").textContent = Math.round(indici[i]);
    b.title = (migliore ? "Giorno migliore" : "Indice") + ` per ${nomeArea}: ${Math.round(indici[i])}` +
      (i >= GIORNO_INCERTO ? " (previsione incerta)" : "");
  });
  const nota = document.getElementById("nota-giorni");
  const incerto = differenze && indici.slice(GIORNO_INCERTO).some((v) => v >= massimo - 1);
  if (massimo < 10) {
    nota.textContent = `Condizioni sfavorevoli per tutta la settimana a ${nomeArea}`;
  } else if (!differenze) {
    nota.textContent = `Condizioni simili per tutta la settimana a ${nomeArea}`;
  } else {
    nota.textContent = `★ giorno migliore per ${nomeArea}` + (incerto ? " (da +5 giorni la previsione è incerta)" : "");
  }
}

// ---------------------------------------------------------------------------
// Mappa
// ---------------------------------------------------------------------------

function preparaMappa() {
  // preferCanvas: disegna migliaia di rettangoli su un'unica tela, veloce sul telefono
  mappa = L.map("mappa", { preferCanvas: true, zoomControl: true }).setView([42.4, 12.6], 8);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' +
      ' | Meteo <a href="https://open-meteo.com/">Open-Meteo</a>',
  }).addTo(mappa);

  stato.strato = L.layerGroup().addTo(mappa);

  // Con una scheda aperta nascondiamo legenda, pulsanti e zoom:
  // sui telefoni piccoli coprirebbero la scheda.
  const contenitore = document.querySelector(".contenitore-mappa");
  mappa.on("popupopen", () => contenitore.classList.add("scheda-aperta"));
  mappa.on("popupclose", () => contenitore.classList.remove("scheda-aperta"));

  // Quando la mappa si ferma: area corrente e sottocelle da mostrare
  mappa.on("moveend", () => {
    if (!stato.punteggi) return;
    aggiornaAreaDaMappa();
    aggiornaSottocelle();
  });
}

function disegnaCelle() {
  stato.celle.forEach((cella) => {
    const [sud, ovest, nord, est] = cella.bbox;
    const rettangolo = L.rectangle([[sud, ovest], [nord, est]], {
      stroke: true, weight: 0.5, color: "#ffffff", opacity: 0.6, fillOpacity: 0,
    });
    rettangolo.on("click", () => apriSchedaCella(cella, rettangolo));
    rettangolo.addTo(mappa);
    stato.rettangoli[cella.id] = rettangolo;
  });

  // Prima inquadratura: l'ultima area scelta, altrimenti tutte e due
  const area = ricordato("area");
  if (area) vaiAllArea(area); else mappa.fitBounds(limitiDi(stato.celle));
  coloraCelle();
  segnaGiorniMigliori();
}

/** Ricolora celle e sottocelle con filtro e giorno scelti (dopo un cambio di filtro o giorno). */
function ricolora() {
  mappa.closePopup();
  coloraCelle();
  coloraSottocelle();
  segnaGiorniMigliori();
}

/** Colora le celle da 3 km; con le sottocelle visibili le celle restano solo bordi. */
function coloraCelle() {
  const dettaglio = mappa.getZoom() >= ZOOM_SOTTOCELLE;
  stato.celle.forEach((cella) => {
    const p = punteggioCella(cella.id);
    // Con le sottocelle visibili la cella resta solo come bordo
    stato.rettangoli[cella.id].setStyle({
      fillColor: colore(p),
      fillOpacity: dettaglio ? 0 : opacita(p),
      weight: dettaglio ? 1.5 : 0.5,
      color: dettaglio ? "#2b2620" : "#ffffff",
      opacity: dettaglio ? 0.35 : 0.6,
    });
  });
}

function limitiDi(celle) {
  return L.latLngBounds(celle.flatMap((c) => [[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]]));
}

// ---------------------------------------------------------------------------
// Sottocelle da 500 m (solo quando la mappa è ingrandita)
// ---------------------------------------------------------------------------

/** Celle almeno in parte visibili nella mappa. */
function celleVisibili() {
  const vista = mappa.getBounds();
  return stato.celle.filter((c) => vista.intersects([[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]]));
}

async function aggiornaSottocelle() {
  const dettaglio = mappa.getZoom() >= ZOOM_SOTTOCELLE;
  if (!dettaglio) {
    stato.strato.clearLayers();
    stato.disegnate = {};
    coloraCelle();
    return;
  }
  // Carica le zone che servono e non sono ancora arrivate
  const zone = [...new Set(celleVisibili().map((c) => c.zona_id))].filter((z) => !stato.sottocelle[z]);
  if (zone.length) {
    try {
      await Promise.all(zone.map(async (z) => {
        stato.sottocelle[z] = await caricaJson(`data/sottocelle/${z}.json`);
      }));
    } catch (errore) {
      messaggio("Non riesco a caricare il dettaglio di questa zona.");
      console.error(errore);
    }
  }
  sincronizzaSottocelle();
  coloraCelle();
}

/**
 * Disegna le sottocelle delle celle visibili e toglie quelle uscite dalla vista.
 * Le sottocelle già disegnate restano dove sono: così una scheda aperta non
 * si chiude quando la mappa si sposta un poco.
 */
function sincronizzaSottocelle() {
  const visibili = new Set(celleVisibili().map((c) => c.id));
  Object.keys(stato.disegnate).forEach((id) => {
    if (!visibili.has(id)) {
      stato.disegnate[id].forEach((x) => stato.strato.removeLayer(x.rettangolo));
      delete stato.disegnate[id];
    }
  });
  visibili.forEach((id) => {
    if (stato.disegnate[id]) return;
    const cella = stato.cellePerId[id];
    const elenco = (stato.sottocelle[cella.zona_id] || {})[id];
    if (!elenco) return;
    stato.disegnate[id] = [];
    elenco.forEach((sotto, k) => {
      if (!sotto) return;
      const [s, o, n, e] = bboxSottocella(cella.bbox, k);
      const p = punteggioSottocella(id, sotto);
      const r = L.rectangle([[s, o], [n, e]], {
        stroke: true, weight: 0.3, color: "#ffffff", opacity: 0.5,
        fillColor: colore(p), fillOpacity: opacita(p),
      });
      r.on("click", () => apriSchedaSottocella(cella, sotto, r));
      stato.strato.addLayer(r);
      stato.disegnate[id].push({ rettangolo: r, dati: sotto });
    });
  });
}

/** Ricolora le sottocelle già disegnate. */
function coloraSottocelle() {
  Object.entries(stato.disegnate).forEach(([id, elenco]) => {
    elenco.forEach(({ rettangolo, dati }) => {
      const p = punteggioSottocella(id, dati);
      rettangolo.setStyle({ fillColor: colore(p), fillOpacity: opacita(p) });
    });
  });
}

// ---------------------------------------------------------------------------
// Aree: pulsanti Foligno/Roma e area corrente per i giorni migliori
// ---------------------------------------------------------------------------

function preparaAree() {
  document.querySelectorAll(".aree button").forEach((b) => {
    b.addEventListener("click", () => vaiAllArea(b.dataset.area));
  });
}

function vaiAllArea(area) {
  const celle = stato.celle.filter((c) => c.id.startsWith(area + "_"));
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
  segnaGiorniMigliori();
}

/** L'area corrente è quella più vicina al centro della mappa. */
function aggiornaAreaDaMappa() {
  const centro = mappa.getCenter();
  let migliore = null, distanza = Infinity;
  stato.celle.forEach((c) => {
    const d = (c.bbox[0] + c.bbox[2]) / 2 - centro.lat;
    const e = (c.bbox[1] + c.bbox[3]) / 2 - centro.lng;
    const dd = d * d + e * e;
    if (dd < distanza) { distanza = dd; migliore = c.area; }
  });
  if (migliore) impostaArea(migliore);
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
// Schede di cella e sottocella
// ---------------------------------------------------------------------------

function barraFattore(nome, valore) {
  // valore è un intero 0-100
  return `<li><span>${nome}</span><span class="barra"><span style="width:${valore}%"></span></span><span>${(valore / 100).toFixed(2).replace(".", ",")}</span></li>`;
}

function intestazione(titolo, luogo, p) {
  return `
    <h3>${titolo}</h3>
    <div class="zona">${luogo} · ${dataBreve(stato.punteggi.giorni[stato.giorno])}</div>
    <div class="punteggio">
      <span class="numero" style="color:${colore(p)}">${Math.round(p)}</span>
      <span class="giudizio">${giudizio(p)}</span>
    </div>`;
}

function titoloFiltro() {
  const k = specieScelta();
  if (k !== null) return stato.punteggi.specie[k].nome;
  return stato.filtro === "media" ? "Tutte le specie: media" : "Tutte le specie: la migliore";
}

/** Righe con il meteo della cella nel giorno scelto. */
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

/** Punteggio di ogni specie in una cella, dal più alto (per i filtri "tutte"). */
function elencoSpecie(valori) {
  return `<ul class="elenco-specie">` + stato.punteggi.specie
    .map((sp, k) => ({ nome: sp.nome, p: valori[k] }))
    .sort((a, b) => b.p - a.p)
    .map((x) => `<li><span>${x.nome}</span><strong style="color:${colore(x.p)}">${Math.round(x.p)}</strong></li>`)
    .join("") + `</ul>`;
}

/** Giorno migliore per questa cella, con il filtro scelto. */
function giornoMiglioreCella(idCella) {
  let migliore = 0;
  stato.punteggi.giorni.forEach((_, g) => {
    if (punteggioCella(idCella, g) > punteggioCella(idCella, migliore)) migliore = g;
  });
  return migliore;
}

function apriScheda(rettangolo, html) {
  // Altezza massima: la scheda non esce mai dalla mappa, al massimo scorre
  const altezzaMax = Math.max(180, mappa.getSize().y - 100);
  rettangolo.bindPopup(`<div class="scheda">${html}</div>`,
    { maxWidth: 300, maxHeight: altezzaMax, autoPanPadding: [16, 16] }).openPopup();
}

function apriSchedaCella(cella, rettangolo) {
  const g = stato.giorno;
  const p = punteggioCella(cella.id);
  const voci = stato.punteggi.celle[cella.id].s;
  const k = specieScelta();

  const uso = Object.entries(cella.uso).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([codice, perc]) => `${nomeUso(codice)} ${perc}%`).join("<br>");

  const fattori = k !== null
    ? `<ul class="fattori">
        ${barraFattore("Acqua", voci[k].fa[g])}
        ${barraFattore("Temperatura", voci[k].ft[g])}
        ${barraFattore("Stagione", stato.punteggi.specie[k].stagione[g])}
      </ul>`
    : elencoSpecie(voci.map((v) => v.S[g]));

  const gm = giornoMiglioreCella(cella.id);
  const html = `
    ${intestazione(titoloFiltro(), cella.zona, p)}
    <dl>
      ${righeMeteo(cella.id)}
      <dt>Quota</dt><dd>${cella.quota.media} m (da ${cella.quota.min} a ${cella.quota.max})</dd>
      <dt>Ambienti</dt><dd>${uso}</dd>
    </dl>
    ${fattori}
    <p class="nota"><strong>Giorno migliore qui:</strong> ${dataBreve(stato.punteggi.giorni[gm])} (${Math.round(punteggioCella(cella.id, gm))})</p>
    <p class="nota">Il punteggio della cella è la media delle sue parti migliori.
      <a href="#" data-ingrandisci>Ingrandisci</a> per vedere i quadrati da 500 m.
      <a href="info.html">Come si calcola</a></p>`;
  apriScheda(rettangolo, html);

  const link = document.querySelector("[data-ingrandisci]");
  if (link) link.addEventListener("click", (ev) => {
    ev.preventDefault();
    mappa.closePopup();
    mappa.fitBounds([[cella.bbox[0], cella.bbox[1]], [cella.bbox[2], cella.bbox[3]]], { maxZoom: 15 });
  });
}

function apriSchedaSottocella(cella, sotto, rettangolo) {
  const g = stato.giorno;
  const p = punteggioSottocella(cella.id, sotto);
  const k = specieScelta();
  const [quota, pendenza, uso1, perc1, uso2, perc2, canaloni, terreno] = sotto;

  const ambienti = [uso1 && `${nomeUso(uso1)} ${perc1}%`, uso2 && `${nomeUso(uso2)} ${perc2}%`]
    .filter(Boolean).join("<br>");

  let fattori;
  if (k !== null) {
    const voce = stato.punteggi.celle[cella.id].s[k];
    const effetto = stato.punteggi.regole.effetto_se_bagnato;
    const terrenoEff = 100 * (1 - (1 - terreno / 100) * (1 - effetto * voce.fa[g] / 100));
    fattori = `<ul class="fattori">
        ${barraFattore("Acqua", voce.fa[g])}
        ${barraFattore("Temperatura", voce.ft[g])}
        ${barraFattore("Stagione", stato.punteggi.specie[k].stagione[g])}
        ${barraFattore("Habitat", sotto[8][k])}
        ${barraFattore("Quota", sotto[9][k])}
        ${barraFattore("Terreno", Math.round(terrenoEff))}
      </ul>`;
  } else {
    const valori = stato.punteggi.specie.map((_, i) => punteggioSottocellaSpecie(cella.id, sotto, i, g));
    fattori = elencoSpecie(valori);
  }

  const html = `
    ${intestazione(titoloFiltro(), `${cella.zona}, quadrato da 500 m`, p)}
    <dl>
      <dt>Ambienti</dt><dd>${ambienti || "n.d."}</dd>
      <dt>Quota</dt><dd>circa ${quota} m</dd>
      <dt>Terreno</dt><dd>pendenza media ${pendenza}°${canaloni ? `, canaloni ${canaloni}%` : ""}</dd>
      ${righeMeteo(cella.id)}
    </dl>
    ${fattori}
    <p class="nota">Il meteo è quello del quadrato da 3 km che lo contiene. <a href="info.html">Come si calcola</a></p>`;
  apriScheda(rettangolo, html);
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
      const punto = [pos.coords.latitude, pos.coords.longitude];
      if (segnaPosizione) segnaPosizione.remove();
      segnaPosizione = L.layerGroup([
        L.circle(punto, { radius: pos.coords.accuracy, color: "#1a73e8", weight: 1, fillOpacity: 0.1 }),
        L.circleMarker(punto, { radius: 7, color: "#fff", weight: 2, fillColor: "#1a73e8", fillOpacity: 1 }),
      ]).addTo(mappa);

      const cella = stato.celle.find((c) =>
        punto[0] >= c.bbox[0] && punto[0] <= c.bbox[2] && punto[1] >= c.bbox[1] && punto[1] <= c.bbox[3]);
      if (!cella) {
        mappa.setView(punto, 12);
        messaggio("Sei fuori dalle aree coperte da FungoMeter.");
        return;
      }
      document.getElementById("messaggio").hidden = true;
      // Ingrandisce fino alle sottocelle; quando sono caricate apre quella dove sei
      mappa.once("moveend", async () => {
        await aggiornaSottocelle();
        const elenco = (stato.sottocelle[cella.zona_id] || {})[cella.id] || [];
        const k = elenco.findIndex((s, i) => {
          if (!s) return false;
          const [sud, ovest, nord, est] = bboxSottocella(cella.bbox, i);
          return punto[0] >= sud && punto[0] <= nord && punto[1] >= ovest && punto[1] <= est;
        });
        if (k >= 0) {
          const [sud, ovest, nord, est] = bboxSottocella(cella.bbox, k);
          const r = L.rectangle([[sud, ovest], [nord, est]], { opacity: 0, fillOpacity: 0 });
          stato.strato.addLayer(r);
          apriSchedaSottocella(cella, elenco[k], r);
        } else {
          apriSchedaCella(cella, stato.rettangoli[cella.id]);
        }
      });
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
