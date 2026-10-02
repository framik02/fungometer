"""Dai commenti raccolti (raccolta_web.py) ai posti segnalati sul web.

    python scripts/consigliati_web.py

1. Costruisce un elenco di toponimi delle nostre aree da GeoNames (paesi,
   frazioni, monti, valli, boschi, parchi, laghi; licenza CC BY 4.0) più i
   nomi delle zone ampie (Castelli Romani, Valnerina...).
2. Tiene solo i testi che parlano di funghi: il commento stesso, oppure il
   video o il post a cui appartiene.
3. Cerca i toponimi nei testi. Scarta i nomi ambigui (omonimi a più di 15 km
   l'uno dall'altro) e quelli che sono anche parole comuni.
4. Per ogni posto conta le fonti diverse (video o discussioni) e le specie
   nominate; tiene i posti con almeno 2 fonti.

Scrive docs/data/segnalati_web.json: nome, coordinate, numero di fonti, specie,
link alle fonti e fino a 3 estratti brevi dei commenti (circa 200 caratteri
intorno al nome del posto), senza nomi utente, link, email, telefoni e menzioni.

Le condizioni dell'API di YouTube chiedono di non tenere i dati dell'API (testi
dei commenti compresi) per più di 30 giorni senza riaggiornarli: la raccolta va
rilanciata almeno una volta al mese. Il file riporta la data della raccolta.
Una citazione non vuol dire che lì si trovino funghi: può anche essere negativa.
"""

import datetime as dt
import html
import json
import math
import re
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

from fungometer.griglia import carica_aree  # noqa: E402

CARTELLA = RADICE / "data" / "raw" / "web"
MIN_FONTI = 1
DISTANZA_AMBIGUA_KM = 15

# Specie e parole che indicano che si parla di funghi
SPECIE = {
    "porcini": r"porcin[io]|boletus|boleti?\b|ceppatell|moreccion",
    "ovoli": r"ovol[io]|amanita caesarea|cocch",
    "galletti": r"gallett[io]|finferl[io]|cantharell|gallinacc",
    "mazze di tamburo": r"mazz[ae] di tamburo|mazze tamburo|macrolepiota|bubbol",
    "trombette": r"trombett[ae] dei morti|craterellus",
    "chiodini": r"chiodin[io]|famigliol[ae]|armillaria",
    "prugnoli": r"prugnol[io]|spinarol[io]|calocybe",
    "spugnole": r"spugnol[ae]|morchell[ae]",
    "sanguinelli": r"sanguinell[io]|lactarius",
    "colombine": r"colombin[ae]|russul[ae]",
}
FUNGHI = re.compile(r"\bfung[hio]|\bfunghett|" + "|".join(SPECIE.values()), re.I)
SPECIE_RE = {k: re.compile(v, re.I) for k, v in SPECIE.items()}

# Testi che parlano di funghi ma non di raccolta: sagre, feste, ricette.
# Se è il titolo del video o del post, si scartano anche tutti i suoi commenti.
RUMORE = re.compile(
    r"\bsagr[ae]\b|\bfest[ae] del fungo|\bfier[ae]\b|ricett|ingredient|\bcucin|salsicc|tagliatell|fettuccin"
    r"|fusilli|risott|primo piatto|\bchef\b|in padella|al forno|trifolat|monte i porcini|ristorant|degustazion"
    r"|lenticchi|\bdieta\b|prodotti tipici|\bmenu\b|\bpizz|bruschett"
    r"|m(?:on)?\.?te\s*\"?\s*(?:i\s+)?porcini|fonte\s+porcini|rifugio\s+porcini|mostra micologic|mostra del fung|mostra mercato|tartuf|\bolio\b|\bpranz|\bcen[ae]\b|#food|\bcibo\b|coltivat",
    re.I)

# Nomi di posto che sono anche parole comuni o troppo generici
COMUNI = set("""
monte colle fonte piano valle bosco poggio casale castello rocca torre villa ponte fiume lago
santa maria san pietro san giovanni san martino sant'angelo madonna stazione chiesa borgo croce
case campo campi prato prati pian piana costa serra fosso forno vigna vigne mola mulino molino
selva macchia cerreto faggeta castagneto pineta lecceta cava cave porta grotta grotte sasso
""".split()) | {"santa maria", "san pietro", "san giovanni", "san martino", "san lorenzo", "san michele",
                "san biagio", "san marco", "san rocco", "san vito", "san paolo", "san felice", "san donato",
                "madonna del monte", "monte rotondo", "valle", "le case", "la torre", "il colle", "la valle",
                "roma", "lazio", "umbria", "italia", "centro", "nord", "sud", "est", "ovest", "pace",
                "vita", "fine", "bella", "belli", "buona", "gola", "piana", "palazzo", "giardino", "monti",
                "appennino", "appennini", "appennino centrale", "apennines", "meloni", "giano",
                "piemonte", "lombardia", "veneto", "liguria", "toscana", "marche", "abruzzo", "molise",
                "campania", "puglia", "calabria", "sicilia", "sardegna", "friuli", "trentino", "emilia",
                "romagna", "basilicata", "valle d'aosta", "europa", "francia", "spagna", "germania"}

# Un nome non può cominciare con un articolo o una preposizione ("la terra", "dei monti")
INIZI_VIETATI = ("il ", "lo ", "la ", "le ", "gli ", "i ", "l'", "del ", "dei ", "della ", "delle ", "degli ",
                 "di ", "da ", "in ", "a ")
ABITANTI_MASSIMI = 20000   # le città non indicano un posto nel bosco

# Zone ampie: nome come lo scrive la gente, coordinate del centro
ZONE_AMPIE = {
    "castelli romani": (41.75, 12.70), "monti della tolfa": (42.15, 11.95), "tolfa": (42.15, 11.93),
    "monti cimini": (42.40, 12.20), "lago di vico": (42.32, 12.17), "monti sabini": (42.27, 12.75),
    "monti lucretili": (42.08, 12.85), "monti simbruini": (41.92, 13.15), "simbruini": (41.92, 13.15),
    "monte livata": (41.95, 13.13), "livata": (41.95, 13.13), "monti lepini": (41.63, 13.08),
    "terminillo": (42.47, 13.00), "subasio": (43.06, 12.68), "monte subasio": (43.06, 12.68),
    "colfiorito": (43.03, 12.89), "monti martani": (42.80, 12.55), "martani": (42.80, 12.55),
    "monte cucco": (43.37, 12.73), "sibillini": (42.85, 13.20), "monti sibillini": (42.85, 13.20),
    "castelluccio": (42.83, 13.21), "forca canapine": (42.76, 13.20), "valnerina": (42.78, 12.88),
    "monteluco": (42.73, 12.76), "monti prenestini": (41.90, 12.93), "manziana": (42.13, 12.13),
    # Resto d'Italia (centro approssimato della zona)
    "valtellina": (46.17, 9.87),
    "val brembana": (45.88, 9.67),
    "val seriana": (45.88, 9.88),
    "valcamonica": (46.05, 10.32),
    "oltrepò pavese": (44.85, 9.2),
    "val di fiemme": (46.29, 11.5),
    "val di sole": (46.33, 10.85),
    "val di non": (46.38, 11.05),
    "val rendena": (46.1, 10.7),
    "lagorai": (46.15, 11.45),
    "val pusteria": (46.78, 12.0),
    "altopiano di asiago": (45.88, 11.5),
    "asiago": (45.88, 11.51),
    "cansiglio": (46.06, 12.4),
    "monte baldo": (45.7, 10.83),
    "lessinia": (45.65, 11.05),
    "cadore": (46.47, 12.35),
    "agordino": (46.28, 12.03),
    "carnia": (46.45, 12.95),
    "tarvisio": (46.5, 13.58),
    "val resia": (46.37, 13.3),
    "val d'aveto": (44.53, 9.38),
    "sassello": (44.48, 8.49),
    "val di vara": (44.28, 9.7),
    "borgotaro": (44.49, 9.77),
    "borgo val di taro": (44.49, 9.77),
    "albareto": (44.45, 9.7),
    "val taro": (44.5, 9.8),
    "val trebbia": (44.75, 9.4),
    "corno alle scale": (44.12, 10.83),
    "monte cimone": (44.19, 10.7),
    "foreste casentinesi": (43.85, 11.8),
    "garfagnana": (44.1, 10.4),
    "lunigiana": (44.3, 9.95),
    "abetone": (44.14, 10.66),
    "monte amiata": (42.88, 11.62),
    "amiata": (42.88, 11.62),
    "casentino": (43.75, 11.8),
    "pratomagno": (43.65, 11.65),
    "colline metallifere": (43.15, 10.95),
    "mugello": (43.97, 11.4),
    "monte catria": (43.47, 12.7),
    "monte nerone": (43.55, 12.52),
    "bocca trabaria": (43.6, 12.25),
    "montefeltro": (43.8, 12.35),
    "monte peglia": (42.83, 12.18),
    "monti ernici": (41.8, 13.4),
    "monti aurunci": (41.33, 13.7),
    "maiella": (42.08, 14.1),
    "majella": (42.08, 14.1),
    "gran sasso": (42.45, 13.6),
    "parco d'abruzzo": (41.8, 13.8),
    "pescasseroli": (41.8, 13.79),
    "roccaraso": (41.85, 14.08),
    "monti della laga": (42.65, 13.4),
    "monte velino": (42.15, 13.38),
    "matese": (41.45, 14.4),
    "capracotta": (41.83, 14.27),
    "alto molise": (41.8, 14.3),
    "monti picentini": (40.78, 14.98),
    "cilento": (40.3, 15.2),
    "monte terminio": (40.85, 14.94),
    "partenio": (40.98, 14.7),
    "laceno": (40.8, 15.1),
    "vallo di diano": (40.4, 15.6),
    "foresta umbra": (41.82, 16.0),
    "gargano": (41.8, 15.9),
    "pollino": (39.92, 16.2),
    "monte vulture": (40.95, 15.63),
    "sirino": (40.13, 15.83),
    "gallipoli cognato": (40.53, 16.12),
    "sila": (39.3, 16.55),
    "camigliatello": (39.34, 16.45),
    "aspromonte": (38.17, 15.92),
    "serre calabresi": (38.55, 16.3),
    "nebrodi": (37.9, 14.6),
    "madonie": (37.85, 14.03),
    "etna": (37.75, 15.0),
    "peloritani": (38.1, 15.4),
    "ficuzza": (37.88, 13.38),
    "gennargentu": (40.02, 9.3),
    "supramonte": (40.2, 9.5),
    "limbara": (40.85, 9.17),
    "montiferru": (40.15, 8.6),
    "marganai": (39.33, 8.6),
    "barbagia": (40.1, 9.2),
}


def senza_accenti(t):
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn").lower()


def distanza_km(a, b):
    r = math.pi / 180
    h = (math.sin((b[0] - a[0]) * r / 2) ** 2
         + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2)
    return 2 * 6371 * math.asin(math.sqrt(h))


def toponimi():
    """{nome normalizzato: (nome, lat, lon, tipo)}, solo dentro le aree coperte e non ambigui.

    Le aree coperte sono le zone di Foligno e Roma più i riquadri d'Italia
    (docs/data/italia/indice.json, scritto da prepara_italia.py)."""
    config = carica_aree(RADICE / "config" / "aree.yaml")
    rettangoli = [(z["sud"] - 0.03, z["nord"] + 0.03, z["ovest"] - 0.03, z["est"] + 0.03)
                  for a in config["aree"].values() for z in a["zone"]]
    indice = RADICE / "docs" / "data" / "italia" / "indice.json"
    if indice.exists():
        rettangoli += [(s, n, o, e) for s, o, n, e, _ in json.loads(indice.read_text(encoding="utf-8")).values()]
    dentro = lambda lat, lon: any(s <= lat <= n and o <= lon <= e for s, n, o, e in rettangoli)

    utili = {"P": None, "T": {"MT", "HLL", "PK", "PASS", "VAL", "MTS", "PLN", "RDGE", "SPUR", "HLLS"},
             "V": {"FRST", "WOODS"}, "L": {"PRK", "RES", "AREA", "LCTY", "RESN"}, "H": {"LK"}}
    candidati = defaultdict(list)
    righe = zipfile.ZipFile(CARTELLA / "IT.zip").read("IT.txt").decode("utf-8").splitlines()
    for riga in righe:
        c = riga.split("\t")
        classe, codice = c[6], c[7]
        if classe not in utili or (utili[classe] and codice not in utili[classe]):
            continue
        lat, lon = float(c[4]), float(c[5])
        # Le città restano nell'elenco per riconoscere gli omonimi (una frazione
        # "Milano" vicino a noi non deve vincere sulla Milano vera), ma non si
        # usano come posti: non indicano un punto nel bosco
        grande = classe == "P" and c[14].isdigit() and int(c[14]) > ABITANTI_MASSIMI
        nomi = {c[1]} | {n for n in c[3].split(",") if n and re.fullmatch(r"[A-Za-zÀ-ÿ' .-]+", n)}
        for nome in nomi:
            chiave = senza_accenti(nome).strip()
            candidati[chiave].append((c[1], lat, lon, "zona" if classe in "LT" and codice in {"MTS", "AREA", "PRK", "VAL"} else "punto",
                                      dentro(lat, lon) and not grande))

    risultato = {}
    for chiave, voci in candidati.items():
        if chiave in COMUNI or len(chiave) < 5 or chiave.startswith(INIZI_VIETATI):
            continue
        # Scarta i nomi ambigui: omonimi lontani fra loro (anche fuori dalle nostre aree,
        # altrimenti "Gualdo" potrebbe essere un altro Gualdo d'Italia)
        lontani = any(distanza_km((a[1], a[2]), (b[1], b[2])) > DISTANZA_AMBIGUA_KM
                      for i, a in enumerate(voci) for b in voci[i + 1:])
        nostre = [v for v in voci if v[4]]
        if lontani or not nostre:
            continue
        nome, lat, lon, tipo, _ = nostre[0]
        risultato[chiave] = (nome, lat, lon, tipo)
    for chiave, (lat, lon) in ZONE_AMPIE.items():
        risultato[chiave] = (chiave.title().replace(" Della ", " della ").replace(" Di ", " di "), lat, lon, "zona")
    return risultato


ESTRATTI_PER_POSTO = 3
LARGHEZZA_ESTRATTO = 110   # caratteri prima e dopo il nome del posto


def ripulisci(testo):
    """Toglie dati personali e rumore da un estratto: link, email, telefoni, @menzioni."""
    testo = re.sub(r"https?://\S+|www\.\S+", "[link]", testo)
    testo = re.sub(r"\S+@\S+\.\w+", "[email]", testo)
    # Telefoni: almeno 9 cifre di fila (con spazi o trattini); i minutaggi "12:34" restano
    testo = re.sub(r"(?<![\d:])(\+?\d(?:[\s.-]?\d){8,})(?![\d:])", "[numero]", testo)
    testo = re.sub(r"@[\w.-]+", "@…", testo)
    return " ".join(testo.split())


def estratto(testo, chiave):
    """Circa 220 caratteri del testo intorno al nome del posto."""
    pulito = ripulisci(html.unescape(testo))
    trovato = re.search(re.escape(chiave), senza_accenti(pulito))
    if not trovato:
        return pulito[:2 * LARGHEZZA_ESTRATTO]
    inizio = max(0, trovato.start() - LARGHEZZA_ESTRATTO)
    fine = min(len(pulito), trovato.end() + LARGHEZZA_ESTRATTO)
    pezzo = pulito[inizio:fine].strip()
    return ("…" if inizio > 0 else "") + pezzo + ("…" if fine < len(pulito) else "")


def testi():
    """Ogni testo con: piattaforma, id della fonte (video o post), link, data, e se il contesto parla di funghi."""
    video = json.loads((CARTELLA / "youtube_video.json").read_text(encoding="utf-8")) if (CARTELLA / "youtube_video.json").exists() else {}
    commenti_yt = json.loads((CARTELLA / "youtube_commenti.json").read_text(encoding="utf-8")) if (CARTELLA / "youtube_commenti.json").exists() else {}
    for vid, v in video.items():
        contesto = html.unescape(f"{v['titolo']} {v['descrizione']}")
        if RUMORE.search(contesto):
            continue   # video su sagre o ricette: niente posti da qui
        url = f"https://www.youtube.com/watch?v={vid}"
        yield ("youtube", vid, url, v["data"], contesto, bool(FUNGHI.search(contesto)))
        for c in commenti_yt.get(vid, []):
            yield ("youtube", vid, url, c["data"], c["testo"], bool(FUNGHI.search(contesto)))
    post = json.loads((CARTELLA / "reddit_post.json").read_text(encoding="utf-8")) if (CARTELLA / "reddit_post.json").exists() else {}
    commenti_rd = json.loads((CARTELLA / "reddit_commenti.json").read_text(encoding="utf-8")) if (CARTELLA / "reddit_commenti.json").exists() else {}
    for pid, p in post.items():
        contesto = html.unescape(f"{p['titolo']} {p['testo']}")
        if RUMORE.search(contesto):
            continue
        yield ("reddit", pid, p["url"], p["data"], contesto, bool(FUNGHI.search(contesto)))
        for c in commenti_rd.get(pid, []):
            yield ("reddit", pid, p["url"], c["data"], c["testo"], bool(FUNGHI.search(contesto)))


def main():
    nomi = toponimi()
    print(f"Toponimi utilizzabili nelle nostre aree: {len(nomi)}")
    # Un'unica espressione regolare con tutti i nomi, dal più lungo (così "monte cucco" vince su "cucco")
    elenco = sorted(nomi, key=len, reverse=True)
    trova = re.compile(r"(?<![a-z])(" + "|".join(re.escape(n) for n in elenco) + r")(?![a-z])")

    # Parole comuni scoperte dai dati: un nome di una sola parola che nei testi
    # compare spesso in minuscolo ("costano", "di norma") non è un toponimo
    # (cioè più spesso in minuscolo che con la maiuscola: "norcia" scritto in
    # minuscolo da qualcuno resta un posto, "costano" no)
    minuscole, maiuscole = Counter(), Counter()
    for *_, testo, _ in testi():
        for parola in re.findall(r"(?<![A-Za-zÀ-ÿ])[A-Za-zÀ-ÿ]{5,}(?![A-Za-zÀ-ÿ])", testo):
            (maiuscole if parola[0].isupper() else minuscole)[senza_accenti(parola)] += 1
    comuni_dai_dati = {n for n in nomi if " " not in n and n not in ZONE_AMPIE
                       and minuscole[n] >= 3 and minuscole[n] > maiuscole[n]}
    for n in comuni_dai_dati:
        del nomi[n]
    print(f"Nomi scartati perché parole comuni nei testi: {len(comuni_dai_dati)}")
    elenco = sorted(nomi, key=len, reverse=True)
    trova = re.compile(r"(?<![a-z])(" + "|".join(re.escape(n) for n in elenco) + r")(?![a-z])")

    posti = defaultdict(lambda: {"fonti": {}, "specie": Counter(), "testi": 0, "estratti": []})
    letti = in_tema = 0
    for piattaforma, fonte, url, data, testo, contesto_funghi in testi():
        letti += 1
        testo = html.unescape(testo)
        if not (contesto_funghi or FUNGHI.search(testo)) or RUMORE.search(testo):
            continue
        in_tema += 1
        normale = senza_accenti(testo)
        trovati = set(trova.findall(normale))
        # Un nome di una sola parola deve comparire con la maiuscola, come un nome
        # proprio: così "costano" o "forma" scritti in minuscolo non contano
        if trovati:
            con_maiuscole = "".join(c for c in unicodedata.normalize("NFD", testo) if unicodedata.category(c) != "Mn")
            trovati = {t for t in trovati
                       if " " in t or t in ZONE_AMPIE
                       or re.search(r"(?<![A-Za-z])" + re.escape(t[:1].upper() + t[1:]) + r"(?![a-z])", con_maiuscole)}
        for chiave in trovati:
            p = posti[chiave]
            p["testi"] += 1
            p["fonti"].setdefault(f"{piattaforma}:{fonte}", (piattaforma, url, data))
            for specie, rx in SPECIE_RE.items():
                if rx.search(testo):
                    p["specie"][specie] += 1
            # Candidato estratto: meglio se il testo stesso parla di funghi
            p["estratti"].append((bool(FUNGHI.search(testo)), data, piattaforma, url, estratto(testo, chiave)))

    uscita = []
    for chiave, p in posti.items():
        if len(p["fonti"]) < MIN_FONTI:
            continue
        nome, lat, lon, tipo = nomi[chiave]
        fonti = sorted(p["fonti"].values(), key=lambda f: f[2], reverse=True)
        uscita.append({
            "nome": nome, "lat": round(lat, 5), "lon": round(lon, 5), "tipo": tipo,
            "fonti": len(fonti), "citazioni": p["testi"],
            "youtube": sum(1 for f in fonti if f[0] == "youtube"),
            "reddit": sum(1 for f in fonti if f[0] == "reddit"),
            "specie": dict(p["specie"].most_common(4)),
            "ultima": fonti[0][2],
            "link": [{"piattaforma": f[0], "url": f[1], "data": f[2]} for f in fonti[:5]],
            "estratti": scegli_estratti(p["estratti"]),
        })
    uscita.sort(key=lambda x: -x["fonti"])
    destinazione = RADICE / "docs" / "data" / "segnalati_web.json"
    destinazione.write_text(json.dumps({"raccolta": dt.date.today().isoformat(), "posti": uscita},
                                       ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Testi letti: {letti}, sui funghi: {in_tema}")
    print(f"Posti con almeno {MIN_FONTI} fonti: {len(uscita)} -> {destinazione.relative_to(RADICE)}")
    for x in uscita[:25]:
        print(f"  {x['fonti']:3d} fonti  {x['nome']:30s} {x['tipo']:5s} {x['specie']}")


def scegli_estratti(candidati):
    """Fino a 3 estratti: prima quelli che parlano di funghi, poi i più recenti,
    al massimo uno per fonte e senza doppioni."""
    scelti, fonti_viste, testi_visti = [], set(), set()
    for funghi, data, piattaforma, url, testo in sorted(candidati, key=lambda c: (c[0], c[1]), reverse=True):
        if url in fonti_viste or testo in testi_visti or len(testo) < 25:
            continue
        scelti.append({"testo": testo, "data": data, "piattaforma": piattaforma, "url": url})
        fonti_viste.add(url); testi_visti.add(testo)
        if len(scelti) == ESTRATTI_PER_POSTO:
            break
    return scelti


if __name__ == "__main__":
    main()
