"""Recupera i bordi scartati dal vecchio filtro sul centro delle celle.

Usa esclusivamente raster già scaricati: --cache-dir è letto, mai modificato.
Il meteo resta ancorato a punti esistenti; nessuna previsione viene inventata.
I file sono pubblicati solo dopo aver verificato tutti i riquadri ricostruiti.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio

import prepara_italia as p
import prepare_static as terrain
from fungometer.italia import celle_riquadro, riquadri


def leggi(path):
    return json.loads(path.read_text(encoding="utf-8"))


def salva(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()
    cache = args.cache_dir.resolve()
    coperte = p.celle_gia_coperte()
    config = p.carica_specie(p.RADICE / "config" / "specie.yaml")
    with rasterio.open(cache / "istat" / "comuni.tif") as f:
        comuni = (f.read(1), f.transform, leggi(cache / "istat" / "comuni.json"))

    def dem_locale(nome, tentativi=3):
        path = cache / "dem" / f"{nome}.tif"
        if not path.exists():
            raise FileNotFoundError(f"DEM mancante: {path}; nessun download automatico")
        return path

    def corine_locale(codice, *bounds):
        with rasterio.open(cache / "corine_italia" / f"{codice}.tif") as f:
            return f.read(1), f.transform

    terrain.scarica_tile = dem_locale
    p.corine_riquadro = corine_locale
    gruppi = leggi(p.RADICE / "data" / "italia_gruppi.json")
    ancore = dict(gruppi)
    pronti, meteo_pronti, rapporto = {}, {}, {}
    for code, sud, ovest in riquadri():
        # Prima selezione veloce: solo riquadri che toccano i rettangoli locali.
        if not np.any((coperte[:, 0] < sud + .5) & (coperte[:, 2] > sud)
                      & (coperte[:, 1] < ovest + .5) & (coperte[:, 3] > ovest)):
            continue
        celle = celle_riquadro(code, sud, ovest)
        ammesse = p.celle_non_coperte(celle, coperte)
        scartate_prima = {c["id"] for c in ammesse if np.any(
            (coperte[:, 0] <= c["lat"]) & (c["lat"] <= coperte[:, 2])
            & (coperte[:, 1] <= c["lon"]) & (c["lon"] <= coperte[:, 3]))}
        if not scartate_prima:
            continue
        # Ripetibile: preferisce una precedente riparazione nel workspace.
        local = p.CARTELLA_INTERMEDI / f"{code}.json"
        originale = leggi(local if local.exists() else cache / "italia" / f"{code}.json")
        presenti = {c["id"] for c in originale["celle"]}
        da_fare = scartate_prima - presenti
        if not da_fare:
            continue
        print(f"{code}: verifico {len(da_fare)} celle di bordo", flush=True)
        nuovi = p.prepara_riquadro(code, sud, ovest, comuni, coperte, config, solo_celle=da_fare)
        meteo = leggi(p.CARTELLA_APP / "meteo" / f"{code}.json")
        riassegnate = []
        for gid in sorted({c["gruppo"] for c in nuovi["celle"]} - meteo.keys()):
            membri = [c for c in nuovi["celle"] if c["gruppo"] == gid]
            lat = sum(c["lat"] for c in membri) / len(membri)
            lon = sum(c["lon"] for c in membri) / len(membri)
            def distanza(c, g):
                return math.hypot((c["lat"] - g["lat"]) * 111.32,
                                  (c["lon"] - g["lon"]) * 111.32 * math.cos(math.radians(c["lat"])))
            origine = min(ancore, key=lambda k: distanza({"lat": lat, "lon": lon}, ancore[k]))
            ancora = ancore[origine]
            km = max(distanza(c, ancora) for c in membri)
            if km > 25:
                raise ValueError(f"Punto meteo troppo lontano per {gid}: {km:.1f} km")
            # Un nuovo gruppo usa un punto reale già disponibile (anche nel
            # riquadro adiacente). Le sue coordinate e quota sono conservate
            # nel registro, così anche gli aggiornamenti successivi coincidono.
            gruppi[gid] = {**ancora, "riquadro": code, "celle": len(membri)}
            sorgente = leggi(p.CARTELLA_APP / "meteo" / f"{ancora['riquadro']}.json")
            meteo[gid] = sorgente[origine]
            riassegnate.append({"gruppo": gid, "punto_origine": origine, "distanza_massima_km": round(km, 2)})
        originale["celle"].extend(nuovi["celle"])
        originale["celle"].sort(key=lambda c: c["id"])
        originale["sottocelle"].update(nuovi["sottocelle"])
        assert all(c["gruppo"] in meteo for c in originale["celle"])
        pronti[code] = originale
        meteo_pronti[code] = meteo
        rapporto[code] = {"esaminate": len(da_fare), "recuperate": len(nuovi["celle"]),
                          "meteo_riusato": riassegnate}

    indice = leggi(p.CARTELLA_APP / "indice.json")
    for code, dati in pronti.items():
        salva(p.CARTELLA_INTERMEDI / f"{code}.json", dati)
        pubblicati = leggi(p.CARTELLA_APP / f"{code}.json")
        schede_path = p.RADICE / "docs" / "data" / "sottocelle" / f"{code}.json"
        schede_prima = leggi(schede_path)
        p.pubblica_riquadro(code, dati, config)
        # La riparazione aggiunge solo celle mancanti, senza ricalcolare quelle
        # già pubblicate con altre versioni delle librerie numeriche.
        ricostruiti = leggi(p.CARTELLA_APP / f"{code}.json")
        per_id = {c["id"]: c for c in ricostruiti["celle"]}
        per_id.update({c["id"]: c for c in pubblicati["celle"]})
        ricostruiti["celle"] = [per_id[k] for k in sorted(per_id)]
        ricostruiti["statiche"].update(pubblicati["statiche"])
        salva(p.CARTELLA_APP / f"{code}.json", ricostruiti)
        schede = leggi(schede_path)
        schede.update(schede_prima)
        salva(schede_path, schede)
        salva(p.CARTELLA_APP / "meteo" / f"{code}.json", meteo_pronti[code])
        indice[code][4] = len(dati["celle"])
    salva(p.CARTELLA_APP / "indice.json", indice)
    salva(p.RADICE / "data" / "italia_gruppi.json", gruppi)
    p.scrivi_habitat()
    from aggiorna_italia import costruisci_panoramica
    punteggi = leggi(p.RADICE / "docs" / "data" / "punteggi.json")
    for area in punteggi.get("aree", []):
        punteggi["celle"].update(leggi(p.RADICE / "docs" / "data" / f"punteggi_{area}.json")["celle"])
    costruisci_panoramica(config, punteggi["giorni"], punteggi["celle"],
                         leggi(p.RADICE / "data" / "celle.json"),
                         leggi(p.RADICE / "docs" / "data" / "statiche.json"))
    # Mantiene il formato del registro per rendere leggibili le sole aggiunte.
    (p.RADICE / "data" / "italia_gruppi.json").write_text(
        json.dumps(gruppi, indent=0), encoding="utf-8")
    salva(p.RADICE / "output" / "riparazione-giunzioni.json", rapporto)
    print(json.dumps(rapporto, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
