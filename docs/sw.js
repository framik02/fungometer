/*
 * Service worker di FungoMeter: rende l'app installabile e usabile offline.
 *
 * - I file dell'app e i dati (data/*.json) si chiedono sempre prima alla rete,
 *   così sono freschi; se manca la rete si usa l'ultima copia salvata.
 * - Leaflet arriva da un indirizzo con la versione fissa (1.9.4): non cambia
 *   mai, quindi si usa la copia salvata.
 * - Le tessere della mappa OpenStreetMap NON si salvano: le regole di
 *   OpenStreetMap chiedono di non scaricarle in massa.
 *
 * Se aggiungi o rinomini un file dell'app, aggiornalo in FILE_APP e aumenta
 * il numero di VERSIONE.
 */

const VERSIONE = "fungometer-v9";

const FILE_APP = [
  "./",
  "index.html",
  "info.html",
  "stile.css",
  "app.js",
  "info.js",
  "manifest.webmanifest",
  "icone/icona-32.png",
  "icone/icona-180.png",
  "icone/icona-192.png",
  "icone/icona-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

// Installazione: salva i file dell'app
self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSIONE).then((cache) => cache.addAll(FILE_APP)).then(() => self.skipWaiting())
  );
});

// Attivazione: cancella le copie delle versioni vecchie
self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n !== VERSIONE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const richiesta = evento.request;
  if (richiesta.method !== "GET") return;
  const url = new URL(richiesta.url);

  // Tessere della mappa: lascia fare al browser
  if (url.hostname.endsWith("tile.openstreetmap.org")) return;

  // Leaflet (versione fissa): prima la copia salvata, poi la rete
  if (url.hostname === "unpkg.com") {
    evento.respondWith(caches.match(richiesta).then((salvata) => salvata || fetch(richiesta)));
    return;
  }

  // File dell'app e dati: prima la rete, poi la copia salvata.
  // "no-cache" fa chiedere sempre al server se il file è cambiato, invece di
  // usare la copia del browser (GitHub Pages la terrebbe per 10 minuti).
  // Se non è cambiato, la risposta del server è minuscola.
  if (url.origin === self.location.origin) {
    evento.respondWith(
      fetch(richiesta.url, { cache: "no-cache", credentials: "same-origin" })
        .then((risposta) => {
          if (!risposta.ok) return risposta;
          const copia = risposta.clone();
          caches.open(VERSIONE).then((cache) => cache.put(richiesta, copia));
          return risposta;
        })
        .catch(() => caches.match(richiesta, { ignoreSearch: true }))
    );
  }
});
