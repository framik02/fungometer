"""Manifesto scritto solo dopo un aggiornamento nazionale completo."""
import hashlib
import json
from pathlib import Path


def scrivi_manifesto(radice):
    radice = Path(radice)
    base = radice / 'docs' / 'data'
    dati = json.loads((base / 'punteggi.json').read_text(encoding='utf-8'))
    indice = json.loads((base / 'italia/indice.json').read_text(encoding='utf-8'))
    files = ['punteggi.json', 'italia/indice.json', 'italia/panoramica.json']
    files += [f'punteggi_{area}.json' for area in dati['aree']]
    files += [f'italia/meteo/{tile}.json' for tile in sorted(indice)]
    hashes = {name: hashlib.sha256((base / name).read_bytes()).hexdigest() for name in files}
    manifesto = {'version': 1, 'aggiornato': dati['aggiornato'], 'giorni': dati['giorni'], 'files': hashes}
    destinazione = base / 'release.json'
    temporaneo = base / 'release.json.tmp'
    temporaneo.write_text(json.dumps(manifesto, separators=(',', ':')), encoding='utf-8')
    temporaneo.replace(destinazione)
