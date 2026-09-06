"""Swappable Garmin data source contract.

Any ingestion backend (garth today, the official Garmin Developer Program API or an aggregator
like Terra/Vital/Spike later) implements this Protocol. Nothing downstream of `ingest_client.py`
needs to know which one is active — see plan section "Garmin integration".
"""
from datetime import date
from typing import Protocol

METRIC_TYPES = (
    "sleep",
    "hrv",
    "resting_hr",
    "body_battery",
    "training_readiness",
    "stress",
    "activities",
)


class GarminSource(Protocol):
    def fetch_metric(self, for_date: date, metric_type: str) -> dict:
        """Return the raw payload for one metric type on one calendar date.

        Must return the provider's raw JSON shape, untouched — normalization happens
        server-side in garminNormalize.ts, never in this worker.
        """
        ...
