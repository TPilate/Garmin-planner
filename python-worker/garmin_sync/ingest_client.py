"""Forwards raw Garmin payloads to the Nitro internal ingest endpoint.

The worker never touches the database directly — see plan "Decisions": Python is schema-blind
by construction. This is the only network call this package makes toward our own app.
"""
from datetime import date

import requests


class IngestClient:
    def __init__(self, base_url: str, ingest_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.ingest_token = ingest_token

    def send(self, source: str, for_date: date, metric_type: str, raw_payload: dict) -> None:
        response = requests.post(
            f"{self.base_url}/api/internal/garmin/ingest",
            json={
                "source": source,
                "date": for_date.isoformat(),
                "metricType": metric_type,
                "rawPayload": raw_payload,
            },
            headers={"Authorization": f"Bearer {self.ingest_token}"},
            timeout=30,
        )
        response.raise_for_status()
