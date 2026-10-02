"""Lettore minimo di shapefile (poligoni) e della loro tabella .dbf.

Serve a leggere i confini ISTAT di regioni, province e comuni senza
installare librerie in più. Legge solo quello che usano gli script:
poligoni (tipo 5) e campi di testo o numerici.

    for attributi, anelli in leggi_poligoni("Com01012024_g_WGS84"):
        ...   # attributi = {"COMUNE": "Foligno", ...}; anelli = [[(x, y), ...], ...]
"""

import struct
from pathlib import Path


def _leggi_dbf(percorso, codifica="latin-1"):
    """Righe della tabella .dbf come dizionari {campo: valore}."""
    dati = Path(percorso).read_bytes()
    n_righe, lung_intestazione, lung_riga = struct.unpack("<IHH", dati[4:12])
    campi, pos = [], 32
    while dati[pos] != 0x0D:
        nome = dati[pos:pos + 11].split(b"\0")[0].decode("ascii")
        tipo = chr(dati[pos + 11])
        lunghezza = dati[pos + 16]
        campi.append((nome, tipo, lunghezza))
        pos += 32
    righe = []
    for i in range(n_righe):
        inizio = lung_intestazione + i * lung_riga + 1   # il primo byte segna le righe cancellate
        riga, p = {}, inizio
        for nome, tipo, lunghezza in campi:
            testo = dati[p:p + lunghezza].decode(codifica).strip()
            p += lunghezza
            if tipo in "NF":
                try:
                    riga[nome] = float(testo) if "." in testo else int(testo)
                except ValueError:
                    riga[nome] = None
            else:
                riga[nome] = testo
        righe.append(riga)
    return righe


def leggi_poligoni(base, codifica="latin-1"):
    """Coppie (attributi, anelli) per ogni poligono di <base>.shp e <base>.dbf."""
    base = Path(base)
    righe = _leggi_dbf(base.with_suffix(".dbf"), codifica)
    dati = base.with_suffix(".shp").read_bytes()
    pos, n = 100, 0
    risultati = []
    while pos < len(dati):
        _, lung = struct.unpack(">ii", dati[pos:pos + 8])
        contenuto = dati[pos + 8: pos + 8 + 2 * lung]
        pos += 8 + 2 * lung
        tipo = struct.unpack("<i", contenuto[:4])[0]
        anelli = []
        if tipo in (5, 15, 25):   # poligono (anche con Z o M: si leggono solo x e y)
            n_parti, n_punti = struct.unpack("<ii", contenuto[36:44])
            parti = list(struct.unpack(f"<{n_parti}i", contenuto[44:44 + 4 * n_parti])) + [n_punti]
            punti = struct.unpack(f"<{2 * n_punti}d", contenuto[44 + 4 * n_parti: 44 + 4 * n_parti + 16 * n_punti])
            for a, b in zip(parti[:-1], parti[1:]):
                anelli.append([(punti[2 * j], punti[2 * j + 1]) for j in range(a, b)])
        risultati.append((righe[n], anelli))
        n += 1
    return risultati
