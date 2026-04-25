"""
EconomicCalendarService — calendario eventi ForexFactory (alta volatilità).

Recupera ogni 6h:
  https://nfs.faireconomy.media/ff_calendar_thisweek.json
  https://nfs.faireconomy.media/ff_calendar_nextweek.json

Usa urllib.request (zero dipendenze aggiuntive) con run_in_executor.
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.request
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

_FF_THIS_WEEK = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
_FF_NEXT_WEEK = "https://nfs.faireconomy.media/ff_calendar_nextweek.json"


def _fetch_url_sync(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


def _parse_event_dt(date_str: str, time_str: str) -> datetime | None:
    """Converte data e ora ForexFactory in datetime UTC."""
    if not time_str or time_str.lower() in ("all day", "tentative"):
        return None
    # Formato ISO con offset: "2024-01-05T13:30:00-0500"
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.astimezone(timezone.utc).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    # Formato ForexFactory nativo: date="01-10-2025" time="8:30am"
    try:
        dt = datetime.strptime(f"{date_str} {time_str}", "%m-%d-%Y %I:%M%p")
        # FF pubblica orari Eastern (UTC-5 approssimato)
        return dt.replace(tzinfo=timezone.utc) + timedelta(hours=5)
    except ValueError:
        pass
    return None


class EconomicCalendarService:
    """Scarica e aggiorna il calendario ForexFactory ogni N ore."""

    def __init__(self, refresh_hours: int = 6) -> None:
        self._refresh_hours = refresh_hours
        self._events: list[datetime] = []
        self._last_fetch: datetime | None = None

    async def refresh_if_needed(self) -> None:
        now = datetime.now(timezone.utc)
        if (
            self._last_fetch is not None
            and (now - self._last_fetch).total_seconds() < self._refresh_hours * 3600
        ):
            return
        await self._fetch()

    async def _fetch(self) -> None:
        loop = asyncio.get_event_loop()
        events: list[datetime] = []
        for url in (_FF_THIS_WEEK, _FF_NEXT_WEEK):
            try:
                raw = await loop.run_in_executor(None, _fetch_url_sync, url)
                for ev in json.loads(raw):
                    if str(ev.get("impact", "")).lower() != "high":
                        continue
                    dt = _parse_event_dt(
                        str(ev.get("date", "")),
                        str(ev.get("time", "")),
                    )
                    if dt is not None:
                        events.append(dt)
            except Exception as exc:
                logger.warning("EconomicCalendar: errore fetch %s: %s", url, exc)
        self._events = events
        self._last_fetch = datetime.now(timezone.utc)
        logger.info("EconomicCalendar: %d eventi high-impact caricati", len(events))

    def is_blocked(self, now: datetime, window_minutes: int = 30) -> tuple[bool, str | None]:
        """Ritorna (True, descrizione) se siamo entro window_minutes da un evento high-impact."""
        delta = timedelta(minutes=window_minutes)
        for ev in self._events:
            if abs((ev - now).total_seconds()) <= delta.total_seconds():
                return True, ev.strftime("%Y-%m-%d %H:%M UTC")
        return False, None
