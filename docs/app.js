/*
 * FungoMeter: la logica della mappa.
 *
 * 1. scarica data/celle.json (forma delle celle) e data/punteggi.json (punteggi)
 * 2. disegna una cella colorata per ogni quadrato da 3 km
 * 3. ricolora le celle quando cambi specie o giorno
 * 4. al tocco su una cella mostra la scheda con punteggio e fattori
 *
 * JavaScript semplice, senza framework: si legge dall'alto in basso.
 */

"use strict";

// ---------------------------------------------------------------------------
// Stato dell'app: quello che l'utente ha scelto e i dati caricati
// ---------------------------------------------------------------------------

const stato = {
  celle: [],          // da celle.json
  punteggi: null,     // da punteggi.json
  specie: 0,          // posizione della specie scelta in punteggi.specie
  giorno: 0,          // posizione del giorno scelto in punteggi.giorni
  rettangoli: {},     // id cella -> rettangolo Leaflet disegnato
};

let mappa;
let segnaPosizione = null;

// Nomi italiani delle classi Corine Land Cover
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

/** Dati della specie scelta in una cella (null se habitat o quota non adatti). */
function datiSpecie(idCella) {
  return stato.punteggi.celle[idCella].s[stato.specie];
}

/** Punteggio della cella per specie e giorno scelti (0 se non adatta). */
function punteggioCella(idCella) {
  const dati = datiSpecie(idCella);
  return dati ? dati.S[stato.giorno] : 0;
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
    stato.punteggi = punteggi;
  } catch (errore) {
    document.getElementById("aggiornamento").textContent =
      "Non riesco a caricare i dati. Controlla la connessione e ricarica la pagina.";
    console.error(errore);
    return;
  }

  mostraAggiornamento();
  preparaSpecie();
  preparaGiorni();
  preparaAree();
  disegnaCelle();
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
// Selettore della specie
// ---------------------------------------------------------------------------

function preparaSpecie() {
  const select = document.getElementById("scelta-specie");
  stato.punteggi.specie.forEach((sp, i) => {
    const opzione = document.createElement("option");
    opzione.value = i;
    opzione.textContent = sp.nome;
    select.appendChild(opzione);
  });

  // Ricorda l'ultima specie scelta
  const salvata = stato.punteggi.specie.findIndex((sp) => sp.id === ricordato("specie"));
  stato.specie = salvata >= 0 ? salvata : 0;
  select.value = stato.specie;

  select.addEventListener("change", () => {
    stato.specie = Number(select.value);
    ricorda("specie", stato.punteggi.specie[stato.specie].id);
    ricolora();
  });
}

// ---------------------------------------------------------------------------
// Selettore del giorno (oggi + 7)
// ---------------------------------------------------------------------------

function etichettaGiorno(iso) {
  const oggi = oggiIso();
  const differenza = Math.round((daIso(iso) - daIso(oggi)) / 86400000);
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
    bottone.innerHTML = `<span>${etichettaGiorno(iso)}</span><strong>${d.getDate()} ${MESI[d.getMonth()]}</strong>`;
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

// ---------------------------------------------------------------------------
// Mappa
// ---------------------------------------------------------------------------

function preparaMappa() {
  // preferCanvas: disegna le 900 celle su un'unica tela, molto più veloce sul telefono
  mappa = L.map("mappa", { preferCanvas: true, zoomControl: true }).setView([42.4, 12.6], 8);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' +
      ' | Meteo <a href="https://open-meteo.com/">Open-Meteo</a>',
  }).addTo(mappa);
}

function disegnaCelle() {
  stato.celle.forEach((cella) => {
    const [sud, ovest, nord, est] = cella.bbox;
    const rettangolo = L.rectangle([[sud, ovest], [nord, est]], {
      stroke: true,
      weight: 0.5,
      color: "#ffffff",
      opacity: 0.6,
      fillOpacity: 0,
    });
    rettangolo.on("click", () => apriScheda(cella, rettangolo));
    rettangolo.addTo(mappa);
    stato.rettangoli[cella.id] = rettangolo;
  });
  ricolora();

  // Prima inquadratura: l'ultima area scelta, altrimenti tutte e due
  const area = ricordato("area");
  if (area) vaiAllArea(area); else mappa.fitBounds(limitiDi(stato.celle));
}

/** Ricolora tutte le celle con specie e giorno scelti. */
function ricolora() {
  stato.celle.forEach((cella) => {
    const p = punteggioCella(cella.id);
    stato.rettangoli[cella.id].setStyle({ fillColor: colore(p), fillOpacity: opacita(p) });
  });
  mappa.closePopup();
}

function limitiDi(celle) {
  return L.latLngBounds(celle.flatMap((c) => [[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]]));
}

// ---------------------------------------------------------------------------
// Pulsanti delle aree
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
  document.querySelectorAll(".aree button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.area === area ? "true" : "false");
  });
}

// ---------------------------------------------------------------------------
// Scheda della cella
// ---------------------------------------------------------------------------

function barraFattore(nome, valore) {
  // valore è un intero 0-100
  return `<li><span>${nome}</span><span class="barra"><span style="width:${valore}%"></span></span><span>${(valore / 100).toFixed(2).replace(".", ",")}</span></li>`;
}

function numero(valore, decimali = 0) {
  if (valore === null || valore === undefined) return "n.d.";
  return valore.toFixed(decimali).replace(".", ",");
}

function apriScheda(cella, rettangolo) {
  const g = stato.giorno;
  const sp = stato.punteggi.specie[stato.specie];
  const meteo = stato.punteggi.celle[cella.id];
  const dati = datiSpecie(cella.id);
  const p = punteggioCella(cella.id);
  const regole = stato.punteggi.regole || { giorni_pioggia: 14, ritardo_pioggia: 3, giorni_temperatura: 7 };

  // Le classi Corine della cella, dalla più estesa
  const habitat = Object.entries(cella.corine)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([codice, perc]) => `${CORINE[codice] || codice} ${perc}%`)
    .join("<br>");

  const fattori = dati
    ? `<ul class="fattori">
        ${barraFattore("Pioggia", dati.fp[g])}
        ${barraFattore("Temperatura", dati.ft[g])}
        ${barraFattore("Habitat", dati.fh)}
        ${barraFattore("Stagione", sp.stagione[g])}
        ${barraFattore("Quota", dati.fq)}
      </ul>`
    : `<p class="nota">Habitat o quota di questa cella non sono adatti a questa specie: il punteggio è sempre 0.</p>`;

  const html = `
    <div class="scheda">
      <h3>${sp.nome}</h3>
      <div class="zona">${cella.zona} · ${etichettaGiorno(stato.punteggi.giorni[g])} ${daIso(stato.punteggi.giorni[g]).getDate()} ${MESI[daIso(stato.punteggi.giorni[g]).getMonth()]}</div>
      <div class="punteggio">
        <span class="numero" style="color:${colore(p)}">${p}</span>
        <span class="giudizio">${giudizio(p)}</span>
      </div>
      <dl>
        <dt>Pioggia</dt><dd>${numero(meteo.p[g])} mm in ${regole.giorni_pioggia} giorni (soglia ${sp.pioggia_mm} mm)</dd>
        <dt>Temperature</dt><dd>min ${numero(meteo.tn[g], 1)} °C, max ${numero(meteo.tx[g], 1)} °C</dd>
        <dt>Media ${regole.giorni_temperatura} gg</dt><dd>${numero(meteo.tr[g], 1)} °C (ideale ${sp.temperatura[0]}-${sp.temperatura[1]} °C)</dd>
        <dt>Quota</dt><dd>${cella.quota.media} m (da ${cella.quota.min} a ${cella.quota.max})</dd>
        <dt>Habitat</dt><dd>${habitat}</dd>
      </dl>
      ${fattori}
      <p class="nota">La pioggia conta i ${regole.giorni_pioggia} giorni che finiscono ${regole.ritardo_pioggia} giorni prima, perché i funghi escono dopo. <a href="info.html">Come si calcola</a></p>
    </div>`;

  rettangolo.bindPopup(html, { maxWidth: 300, autoPanPadding: [16, 16] }).openPopup();
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
      mappa.setView(punto, 13);

      // In quale cella sei?
      const cella = stato.celle.find((c) =>
        punto[0] >= c.bbox[0] && punto[0] <= c.bbox[2] && punto[1] >= c.bbox[1] && punto[1] <= c.bbox[3]);
      if (cella) {
        apriScheda(cella, stato.rettangoli[cella.id]);
        document.getElementById("messaggio").hidden = true;
      } else {
        messaggio("Sei fuori dalle aree coperte da FungoMeter.");
      }
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
