import pytest
from fungometer import meteo

def test_commercial_mode_requires_key(monkeypatch):
    monkeypatch.setenv('COMMERCIAL_MODE', 'true')
    monkeypatch.delenv('OPEN_METEO_API_KEY', raising=False)
    with pytest.raises(RuntimeError, match='licenza commerciale'):
        meteo.scarica_meteo([], past_days=26, forecast_days=8)

@pytest.mark.parametrize('historical', [False, True])
def test_customer_endpoint_and_historical_dates(monkeypatch, historical):
    monkeypatch.setenv('OPEN_METEO_API_KEY', 'test-key-not-real')
    monkeypatch.setattr(meteo, '_aspetta_il_tetto', lambda *_: None)
    calls = []
    def request(url, params):
        calls.append((url, params))
        return [{'daily': {'time': ['2026-10-01'], **{v: [1] for v in meteo.VARIABILI}}}]
    monkeypatch.setattr(meteo, '_chiedi', request)
    kwargs = {'start_date': '2026-10-01', 'end_date': '2026-10-01'} if historical else {'past_days': 26, 'forecast_days': 8}
    dates, data = meteo.scarica_meteo([{'id': 'test', 'lat': 43, 'lon': 12, 'quota': {'media': 600}}], **kwargs)
    assert calls[0][0] == ('https://customer-historical-forecast-api.open-meteo.com/v1/forecast' if historical else 'https://customer-api.open-meteo.com/v1/forecast')
    assert calls[0][1]['apikey'] == 'test-key-not-real'
    assert dates == ['2026-10-01'] and data['test']['pioggia'] == [1]
