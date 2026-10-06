/*
 * Pagina Info: riempie la tabella delle specie leggendo data/punteggi.json,
 * così resta sempre uguale a config/specie.yaml senza doverla riscrivere.
 */

"use strict";

const NOMI_MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
  "agosto", "settembre", "ottobre", "novembre", "dicembre"];

/** Da [6, 7, 8, 9] a "giugno-settembre". */
function intervalloMesi(mesi) {
  if (!mesi.length) return "";
  const ordinati = [...mesi].sort((a, b) => a - b);
  const primo = NOMI_MESI[ordinati[0] - 1];
  const ultimo = NOMI_MESI[ordinati[ordinati.length - 1] - 1];
  return primo === ultimo ? primo : `${primo}-${ultimo}`;
}

async function riempiTabella() {
  const corpo = document.getElementById("tabella-specie");
  try {
    const risposta = await fetch("/api/species", { cache: "no-cache" });
    const dati = await risposta.json();

    corpo.innerHTML = dati.specie.map((sp) => {
      const margine = sp.mesi_margine.length
        ? `<br><em>margine: ${sp.mesi_margine.map((m) => NOMI_MESI[m - 1]).join(", ")}</em>`
        : "";
      return `<tr>
        <td><strong>${sp.nome}</strong><br><em>${sp.latino}</em></td>
        <td>${sp.ambiente}</td>
        <td>${intervalloMesi(sp.mesi_centrali)}${margine}</td>
        <td>${sp.quota[0]}-${sp.quota[1]} m</td>
        <td>almeno ${sp.pioggia_mm} mm</td>
        <td>${sp.temperatura[0]}-${sp.temperatura[1]} °C${sp.temperatura_ottimale ? `<br><em>ottimo ${sp.temperatura_ottimale} °C</em>` : ""}</td>
      </tr>`;
    }).join("");

    // Regole comuni (giorni di pioggia, ritardo, giorni di temperatura)
    if (dati.regole) {
      document.querySelectorAll("[data-regola]").forEach((el) => {
        const valore = dati.regole[el.dataset.regola];
        if (valore !== undefined) el.textContent = valore;
      });
    }
  } catch (errore) {
    corpo.innerHTML = '<tr><td colspan="6">Non riesco a caricare i dati delle specie.</td></tr>';
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

riempiTabella();
