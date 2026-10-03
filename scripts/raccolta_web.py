"""Raccoglie da YouTube e Reddit i commenti che citano posti per funghi.

Gira solo sul tuo PC, mai su GitHub Actions: usa le chiavi YouTube del
progetto youtube-sentiment-pipeline (file .env, variabile YT_API_KEYS), che
non devono finire nel repository pubblico.

    python scripts/raccolta_web.py youtube     # ricerche e commenti YouTube (API ufficiale)
    python scripts/raccolta_web.py reddit      # post e commenti Reddit (archivio Arctic Shift)

Tutto ciò che si scarica resta in data/raw/web/ (escluso da git): i commenti
grezzi contengono i nomi degli utenti. L'estrazione dei posti, che produce il
file pubblico senza nomi né testi, sta in scripts/consigliati_web.py.

La raccolta salva i progressi dopo ogni ricerca: se si interrompe, rilanciando
riparte da dove era arrivata.
"""

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

import requests

RADICE = Path(__file__).resolve().parent.parent
CARTELLA = RADICE / "data" / "raw" / "web"
ENV_YOUTUBE = Path(r"C:\dev\Progetti\youtube-sentiment-pipeline\.env")

# Zone e posti noti delle nostre aree, per le ricerche
ZONE = [
    "Monte Subasio", "Colfiorito", "Monti Martani", "Monte Cucco", "Gualdo Tadino", "Nocera Umbra",
    "Valnerina", "Monteluco Spoleto", "Norcia", "Castelluccio", "Forca Canapine", "Monti Sibillini",
    "Sellano", "Castelli Romani", "Rocca di Papa", "Monte Cavo", "Monti della Tolfa", "Allumiere",
    "Manziana", "Monti Cimini", "Lago di Vico", "Soriano nel Cimino", "Monti Sabini", "Monti Lucretili",
    "Monti Simbruini", "Monte Livata", "Subiaco", "Filettino", "Monti Lepini", "Carpineto Romano",
    "Terminillo", "Leonessa",
]
# Le zone da funghi più note del resto d'Italia
ZONE_ITALIA = [
    "Abetone", "Agordino", "Albareto", "Alto Molise", "Altopiano di Asiago", "Asiago", "Aspromonte",
    "Barbagia", "Bocca Trabaria", "Borgotaro", "Cadore", "Camigliatello", "Cansiglio", "Capracotta", "Carnia",
    "Casentino", "Cilento", "Colline Metallifere", "Corno alle Scale", "Etna", "Ficuzza", "Foresta Umbra",
    "Foreste Casentinesi", "Gallipoli Cognato", "Garfagnana", "Gargano", "Gennargentu", "Gran Sasso",
    "Laceno", "Lagorai", "Lessinia", "Limbara", "Lunigiana", "Madonie", "Maiella", "Marganai", "Matese",
    "Monte Amiata", "Monte Baldo", "Monte Catria", "Monte Cimone", "Monte Nerone", "Monte Peglia",
    "Monte Terminio", "Monte Velino", "Monte Vulture", "Montefeltro", "Monti Aurunci", "Monti Ernici",
    "Monti Picentini", "Monti della Laga", "Montiferru", "Mugello", "Nebrodi", "Oltrepò Pavese",
    "Parco d'Abruzzo", "Partenio", "Peloritani", "Pescasseroli", "Pollino", "Pratomagno", "Roccaraso",
    "Sassello", "Serre Calabresi", "Sila", "Sirino", "Supramonte", "Tarvisio", "Val Brembana", "Val Pusteria",
    "Val Rendena", "Val Resia", "Val Seriana", "Val Taro", "Val Trebbia", "Val d'Aveto", "Val di Fiemme",
    "Val di Non", "Val di Sole", "Val di Vara", "Valcamonica", "Vallo di Diano", "Valtellina",
]
REGIONI = ["Piemonte", "Lombardia", "Trentino", "Alto Adige", "Veneto", "Friuli", "Liguria", "Emilia",
           "Toscana", "Marche", "Abruzzo", "Molise", "Campania", "Puglia", "Basilicata", "Calabria",
           "Sicilia", "Sardegna", "Valle d'Aosta"]
GENERICHE = [
    "porcini Umbria", "funghi Umbria", "porcini Lazio", "funghi Lazio", "ovoli Lazio", "ovoli Umbria",
    "mazze di tamburo Umbria", "trombette dei morti Umbria", "prugnoli Sibillini", "galletti Umbria",
    "chiodini Lazio", "funghi provincia di Roma", "funghi Viterbo", "funghi Rieti", "funghi Perugia",
]

# Reddit: subreddit e parole chiave
SUBREDDIT = ["italy", "Italia", "Umbria", "rome", "Roma", "funghi", "foraging", "mycology",
             "Perugia", "lazio", "Mushrooms",
             # Regioni e città, per tutta Italia
             "Toscana", "firenze", "Marche", "Abruzzo", "Piemonte", "torino", "Lombardia", "milano",
             "Trentino", "AltoAdige", "Veneto", "FriuliVeneziaGiulia", "Liguria", "genova", "EmiliaRomagna",
             "bologna", "Campania", "napoli", "Calabria", "Puglia", "basilicata", "sicilia", "sardegna"]
CHIAVI_REDDIT = ["porcini", "funghi", "ovoli", "galletti", "finferli", "mazze di tamburo",
                 "chiodini", "trombette", "spugnole", "prugnoli", "boletus", "foraging Italy"]
DA = "2015-01-01"


def scrivi(nome, dati):
    CARTELLA.mkdir(parents=True, exist_ok=True)
    (CARTELLA / nome).write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")


def leggi(nome, predefinito):
    p = CARTELLA / nome
    if not p.exists():
        return predefinito
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except ValueError:
        return predefinito


def log(m):
    print(f"[{dt.datetime.now():%H:%M:%S}] {m}", flush=True)


# ---------------------------------------------------------------------------
# YouTube (API ufficiale: search.list costa 100 unità, commentThreads 1)
# ---------------------------------------------------------------------------

def chiavi_youtube():
    for riga in ENV_YOUTUBE.read_text(encoding="utf-8", errors="ignore").splitlines():
        if riga.startswith("YT_API_KEYS"):
            return [c.strip() for c in riga.split("=", 1)[1].strip().strip('"').split(",") if c.strip()]
    sys.exit("Nessuna chiave YT_API_KEYS nel .env di youtube-sentiment-pipeline")


class YouTube:
    def __init__(self):
        self.chiavi = chiavi_youtube()
        self.indice = 0

    def get(self, risorsa, **parametri):
        """Una chiamata; se una chiave finisce la quota passa alla successiva.

        429 = troppe ricerche al minuto: si aspetta un minuto e si riprova.
        Restituisce None solo se la risorsa non c'è (commenti disattivati, video tolto)."""
        attese_429 = 0
        while self.indice < len(self.chiavi):
            parametri["key"] = self.chiavi[self.indice]
            r = requests.get(f"https://www.googleapis.com/youtube/v3/{risorsa}", params=parametri, timeout=60)
            if r.status_code == 403 and "quota" in r.text.lower():
                log(f"quota finita per la chiave {self.indice + 1}, passo alla successiva")
                self.indice += 1
                continue
            if r.status_code in (403, 429) and "per day" in r.text:
                # Limite giornaliero (anche di sole ricerche): si passa alla chiave dopo
                log(f"limite giornaliero per la chiave {self.indice + 1}, passo alla successiva")
                self.indice += 1
                attese_429 = 0
                continue
            if r.status_code == 429 and attese_429 < 10:
                attese_429 += 1
                log(f"  {risorsa}: troppe richieste al minuto, aspetto 60 s")
                time.sleep(60)
                continue
            if r.status_code == 403 and "commentsDisabled" in r.text:
                return None
            if r.status_code >= 400:
                log(f"  {risorsa}: HTTP {r.status_code} {r.text[:120]}")
                return None
            return r.json()
        sys.exit("Quota esaurita su tutte le chiavi: riprova domani, la raccolta riparte da qui.")


def raccogli_youtube():
    yt = YouTube()
    video = leggi("youtube_video.json", {})
    fatte = set(leggi("youtube_ricerche_fatte.json", []))
    ricerche = ([f"{specie} {zona}" for zona in ZONE for specie in ("funghi", "porcini")] + GENERICHE
                + [f"{specie} {zona}" for zona in ZONE_ITALIA for specie in ("funghi", "porcini")]
                + [f"{specie} {regione}" for regione in REGIONI for specie in ("funghi", "porcini")])
    for q in ricerche:
        if q in fatte:
            continue
        risposta = yt.get("search", part="snippet", q=q, type="video", maxResults=50,
                          regionCode="IT", relevanceLanguage="it", publishedAfter=f"{DA}T00:00:00Z")
        if risposta is None:   # ricerca non riuscita: resta da fare al prossimo giro
            continue
        for el in (risposta or {}).get("items", []):
            vid = el["id"]["videoId"]
            if vid not in video:
                s = el["snippet"]
                video[vid] = {"titolo": s["title"], "descrizione": s.get("description", ""),
                              "data": s["publishedAt"][:10], "ricerca": q}
        fatte.add(q)
        scrivi("youtube_video.json", video)
        scrivi("youtube_ricerche_fatte.json", sorted(fatte))
        log(f"ricerca '{q}': {len(video)} video in tutto")

    # Commenti: fino a 300 per video (3 pagine da 100)
    commenti = leggi("youtube_commenti.json", {})
    for n, (vid, info) in enumerate(video.items(), start=1):
        if vid in commenti:
            continue
        righe, pagina = [], None
        for _ in range(3):
            p = dict(part="snippet", videoId=vid, maxResults=100, textFormat="plainText", order="relevance")
            if pagina:
                p["pageToken"] = pagina
            r = yt.get("commentThreads", **p)
            if not r:
                break
            for el in r.get("items", []):
                c = el["snippet"]["topLevelComment"]["snippet"]
                righe.append({"testo": c.get("textDisplay", ""), "data": c.get("publishedAt", "")[:10],
                              "autore": c.get("authorDisplayName", "")})
            pagina = r.get("nextPageToken")
            if not pagina:
                break
        commenti[vid] = righe
        if n % 20 == 0 or n == len(video):
            scrivi("youtube_commenti.json", commenti)
            log(f"commenti: {n}/{len(video)} video, {sum(len(v) for v in commenti.values())} commenti")
    scrivi("youtube_commenti.json", commenti)


# ---------------------------------------------------------------------------
# Reddit (archivio Arctic Shift: niente login; 422 = motore occupato, si aspetta)
# ---------------------------------------------------------------------------

BASE_REDDIT = "https://arctic-shift.photon-reddit.com/api"
ATTESE = [8, 16, 24, 32, 40]   # misurate nel progetto youtube-sentiment-pipeline
PAUSA = 0.8


def get_reddit(percorso, **p):
    for attesa in ATTESE + [None]:
        try:
            r = requests.get(f"{BASE_REDDIT}/{percorso}", params=p, timeout=90,
                             headers={"User-Agent": "fungometer-ricerca/0.1 (progetto personale, non commerciale)"})
            if r.status_code == 200:
                return r.json().get("data") or []
            if r.status_code not in (422, 429, 500, 502, 503):
                log(f"  HTTP {r.status_code} {p}")
                return []
        except requests.RequestException:
            pass
        if attesa is None:
            break
        time.sleep(attesa)
    log(f"  persa dopo tutti i tentativi: {p}")
    return None   # None, non lista vuota: la ricerca va rifatta al prossimo giro


def raccogli_reddit():
    post = leggi("reddit_post.json", {})
    fatte = set(leggi("reddit_ricerche_fatte.json", []))
    for sub in SUBREDDIT:
        for chiave in CHIAVI_REDDIT:
            if f"{sub}|{chiave}" in fatte:
                continue
            cursore, persa = DA, False
            for _ in range(10):   # al massimo 1000 post per coppia
                righe = get_reddit("posts/search", subreddit=sub, query=chiave, limit=100, after=cursore)
                if righe is None:
                    persa = True
                    break
                for r in righe:
                    if r.get("id") and r["id"] not in post:
                        post[r["id"]] = {"titolo": r.get("title", ""), "testo": r.get("selftext", ""),
                                         "sub": sub, "data": dt.datetime.utcfromtimestamp(r.get("created_utc", 0)).date().isoformat(),
                                         "commenti": r.get("num_comments", 0), "url": f"https://www.reddit.com{r.get('permalink', '')}"}
                if len(righe) < 100:
                    break
                cursore = dt.datetime.utcfromtimestamp(max(r.get("created_utc", 0) for r in righe) + 1).isoformat()
                time.sleep(PAUSA)
            if not persa:   # le ricerche perse restano da fare
                fatte.add(f"{sub}|{chiave}")
            scrivi("reddit_post.json", post)
            scrivi("reddit_ricerche_fatte.json", sorted(fatte))
            time.sleep(PAUSA)
        log(f"r/{sub}: {len(post)} post in tutto")

    commenti = leggi("reddit_commenti.json", {})
    da_fare = [pid for pid, p in post.items() if pid not in commenti and p["commenti"]]
    for n, pid in enumerate(da_fare, start=1):
        righe = get_reddit("comments/search", link_id=pid, limit=100)
        if righe is None:   # riprova al prossimo giro
            continue
        commenti[pid] = [{"testo": c.get("body", ""), "autore": c.get("author", ""),
                          "data": dt.datetime.utcfromtimestamp(c.get("created_utc", 0)).date().isoformat()}
                         for c in righe]
        if n % 25 == 0 or n == len(da_fare):
            scrivi("reddit_commenti.json", commenti)
            log(f"commenti: {n}/{len(da_fare)} post")
        time.sleep(PAUSA)
    scrivi("reddit_commenti.json", commenti)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Raccolta dei commenti da YouTube e Reddit")
    parser.add_argument("fonte", choices=["youtube", "reddit"])
    args = parser.parse_args()
    raccogli_youtube() if args.fonte == "youtube" else raccogli_reddit()
