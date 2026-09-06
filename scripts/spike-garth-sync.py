"""Phase 0b spike: run this daily, unattended, for 2-3 weeks BEFORE building anything on top of
garth. No database writes at all — dumps raw JSON to disk so the real field shapes/nullability
can be inspected by hand, and so we can confirm garth's session survives unattended for weeks
without manual re-auth (see plan phase 0b definition of done).

Usage:
    cd python-worker && pip install -r requirements.txt
    GARMIN_EMAIL=... GARMIN_PASSWORD=... python ../scripts/spike-garth-sync.py

Schedule it once a day (cron/Task Scheduler) and let it run untouched for 2-3 weeks.
"""
import json
import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python-worker"))

from garmin_sync.garth_source import GarthSource  # noqa: E402
from garmin_sync.source import METRIC_TYPES  # noqa: E402

OUTPUT_DIR = Path(__file__).resolve().parent / "spike-garth-sync-output"


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)

    source = GarthSource(
        email=os.environ["GARMIN_EMAIL"],
        password=os.environ["GARMIN_PASSWORD"],
        session_dir=os.environ.get("GARTH_SESSION_DIR", str(OUTPUT_DIR / ".garth_session")),
    )

    today = date.today()
    day_dir = OUTPUT_DIR / today.isoformat()
    day_dir.mkdir(exist_ok=True)

    for metric_type in METRIC_TYPES:
        out_file = day_dir / f"{metric_type}.json"
        try:
            payload = source.fetch_metric(today, metric_type)
            out_file.write_text(json.dumps(payload, indent=2, default=str))
            print(f"[spike] {metric_type}: ok -> {out_file}")
        except Exception as exc:  # noqa: BLE001 - keep going, log the failure for later review
            (day_dir / f"{metric_type}.error.txt").write_text(str(exc))
            print(f"[spike] {metric_type}: FAILED -> {exc}")


if __name__ == "__main__":
    main()
