"""garth-based implementation of the GarminSource protocol (unofficial Garmin Connect API).

NOTE: the exact garth call per metric type below is a first draft (see plan phase 0b — the
spike script `scripts/spike-garth-sync.py` runs unattended for 2-3 weeks specifically to
confirm these field shapes and nullability against real data before this is relied upon).
"""
from datetime import date

import garth

from .source import METRIC_TYPES


class GarthSource:
    def __init__(self, email: str, password: str, session_dir: str) -> None:
        # garth persists its authenticated session to session_dir so subsequent runs don't
        # need to re-login — critical for an unattended daily cron/systemd timer.
        try:
            garth.resume(session_dir)
        except FileNotFoundError:
            garth.login(email, password)
            garth.save(session_dir)

    def fetch_metric(self, for_date: date, metric_type: str) -> dict:
        if metric_type not in METRIC_TYPES:
            raise ValueError(f"Unknown metric_type: {metric_type}")

        iso_date = for_date.isoformat()
        # Endpoint mapping is a first draft, to be confirmed/adjusted during the phase 0b spike.
        endpoint_by_metric = {
            "sleep": f"/wellness-service/wellness/dailySleepData/{iso_date}",
            "hrv": f"/hrv-service/hrv/{iso_date}",
            "resting_hr": f"/wellness-service/wellness/dailySummaryChart/{iso_date}",
            "body_battery": f"/wellness-service/wellness/bodyBattery/reading/{iso_date}/{iso_date}",
            "training_readiness": f"/metrics-service/metrics/trainingreadiness/{iso_date}",
            "stress": f"/wellness-service/wellness/dailyStress/{iso_date}",
            "activities": "/activitylist-service/activities/search/activities",
        }
        return garth.connectapi(endpoint_by_metric[metric_type])
