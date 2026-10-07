"""Regressioni per i buchi tra copertura locale e nazionale."""
import sys
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("rasterio")  # requirements-prepare.txt per la preparazione geografica
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from prepara_italia import celle_non_coperte


def cella(bbox):
    return {"id": "esempio", "bbox": bbox, "lat": (bbox[0] + bbox[2]) / 2,
            "lon": (bbox[1] + bbox[3]) / 2}


def test_centro_coperto_non_significa_intera_cella_coperta():
    c = cella([0, 0, 2, 2])
    assert celle_non_coperte([c], np.array([[0, 0, 1.5, 2]])) == [c]


def test_unione_di_celle_locali_copre_tutta_la_cella():
    assert celle_non_coperte([cella([0, 0, 2, 2])],
                             np.array([[0, 0, 1, 2], [1, 0, 2, 2]])) == []


def test_buco_interno_non_viene_coperto_dal_rettangolo_esterno():
    c = cella([0, 0, 2, 2])
    assert celle_non_coperte([c], np.array([[0, 0, .8, 2], [1.2, 0, 2, 2]])) == [c]


def test_senza_copertura_locale_resta_tutta_la_griglia():
    c = cella([0, 0, 2, 2])
    assert celle_non_coperte([c], np.array([])) == [c]
