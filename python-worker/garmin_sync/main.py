"""Entrypoint for the scheduled Garmin sync (phase 3). Run via cron/systemd timer.

Syncs a rolling trailing window (not just "today") to catch metrics that arrive late from
Garmin's backend (e.g. sleep data finalized hours after waking).
"""
import os
from datetime import date, timedelta

from dotenv import load_dotenv

from .garth_source import GarthSource
from .ingest_client import IngestClient
from .source import METRIC_TYPES

TRAILING_WINDOW_DAYS = 3


def main() -> None:
    load_dotenv()

    source = GarthSource(
        email=os.environ["GARMIN_EMAIL"],
        password=os.environ["GARMIN_PASSWORD"],
        session_dir=os.environ.get("GARTH_SESSION_DIR", ".garth_session"),
    )
    ingest = IngestClient(
        base_url=os.environ["APP_BASE_URL"],
        ingest_token=os.environ["INGEST_TOKEN"],
    )

    today = date.today()
    for offset in range(TRAILING_WINDOW_DAYS):
        target_date = today - timedelta(days=offset)
        for metric_type in METRIC_TYPES:
            try:
                payload = source.fetch_metric(target_date, metric_type)
                ingest.send("garth", target_date, metric_type, payload)
            except Exception as exc:  # noqa: BLE001 - one bad metric must not abort the whole run
                print(f"[garmin_sync] failed {metric_type} for {target_date}: {exc}")


if __name__ == "__main__":
    main()
