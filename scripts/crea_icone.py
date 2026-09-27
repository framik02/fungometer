"""Disegna le icone dell'app (un porcino stilizzato) in docs/icone/.

    python scripts/crea_icone.py

Serve Pillow (pip install pillow). Le icone sono già nel repository:
questo script serve solo se vuoi ridisegnarle.
"""

from pathlib import Path

from PIL import Image, ImageDraw

CARTELLA = Path(__file__).resolve().parent.parent / "docs" / "icone"
VERDE = (47, 74, 42)
CAPPELLO = (122, 74, 38)
CAPPELLO_LUCE = (150, 96, 52)
GAMBO = (238, 226, 200)
GAMBO_OMBRA = (214, 198, 166)


def disegna(lato, margine_sicuro=0.0, angoli=True):
    """Disegna l'icona grande 4 volte e la rimpicciolisce: bordi più morbidi."""
    grande = lato * 4
    img = Image.new("RGBA", (grande, grande), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    raggio = int(grande * 0.22) if angoli else 0
    d.rounded_rectangle([0, 0, grande - 1, grande - 1], radius=raggio, fill=VERDE)

    # Area utile: per l'icona "maskable" il disegno sta nel cerchio centrale
    m = grande * margine_sicuro
    u = grande - 2 * m

    def box(x0, y0, x1, y1):
        return [m + x0 * u, m + y0 * u, m + x1 * u, m + y1 * u]

    # Gambo panciuto
    d.ellipse(box(0.33, 0.42, 0.67, 0.86), fill=GAMBO)
    d.ellipse(box(0.36, 0.44, 0.50, 0.84), fill=GAMBO_OMBRA)
    d.ellipse(box(0.37, 0.43, 0.63, 0.84), fill=GAMBO)
    # Cappello a cupola
    d.chord(box(0.16, 0.18, 0.84, 0.66), start=180, end=360, fill=CAPPELLO)
    d.rounded_rectangle(box(0.16, 0.40, 0.84, 0.49), radius=int(u * 0.045), fill=CAPPELLO)
    # Riflesso sul cappello
    d.chord(box(0.26, 0.24, 0.58, 0.46), start=200, end=300, fill=CAPPELLO_LUCE)

    return img.resize((lato, lato), Image.LANCZOS)


def main():
    CARTELLA.mkdir(parents=True, exist_ok=True)
    for lato in (32, 180, 192, 512):
        disegna(lato).save(CARTELLA / f"icona-{lato}.png")
    # "Maskable": Android la ritaglia a cerchio o goccia, quindi fondo pieno e disegno più piccolo
    disegna(512, margine_sicuro=0.12, angoli=False).save(CARTELLA / "icona-maskable-512.png")
    print("Icone scritte in", CARTELLA)


if __name__ == "__main__":
    main()
