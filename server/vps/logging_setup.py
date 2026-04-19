"""
Configurazione centralizzata del logging per il Trading Bot.

File prodotti in {TRADING_BOT_DIR}/logs/:
  bot.log          — riepilogo generale (INFO+, tutti i moduli)
  errors.log       — solo WARNING/ERROR/CRITICAL da tutti i moduli
  signals.log      — pipeline segnali (Flash/Pro, signal_processor + app)
  mt5.log          — operazioni MT5 (esecuzione ordini, connessione, barre)
  strategy.log     — StrategyExecutor (agent loop, tool call, decisioni)
  backtest.log     — BacktestEngine e routes backtest
  ai_calls.log     — chiamate Gemini complete (prompt + risposta + token)
  users/{uid}.log  — tutti gli eventi per utente (richiede extra user_id)
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

_MAIN_FMT = "%(asctime)s  %(levelname)-8s  %(name)-38s  %(message)s"
_DATE_FMT = "%Y-%m-%d %H:%M:%S"

# ── Separatori per ai_calls.log ───────────────────────────────────────────────
AI_SEP  = "━" * 80
AI_LINE = "─" * 76


# ── Handler per-utente ────────────────────────────────────────────────────────

class _PerUserHandler(logging.Handler):
    """
    Instrada i record di log al file logs/users/{user_id}.log.
    Il routing avviene tramite il campo 'user_id' nell'attributo extra del record
    (si imposta con logging.LoggerAdapter o extra={"user_id": ...}).
    """

    def __init__(self, log_dir: Path) -> None:
        super().__init__()
        self._dir = log_dir / "users"
        self._dir.mkdir(exist_ok=True)
        self._fh: dict[str, logging.FileHandler] = {}
        self._fmt = logging.Formatter(_MAIN_FMT, datefmt=_DATE_FMT)

    def _handler(self, uid: str) -> logging.FileHandler:
        if uid not in self._fh:
            h = logging.FileHandler(self._dir / f"{uid}.log", encoding="utf-8")
            h.setFormatter(self._fmt)
            self._fh[uid] = h
        return self._fh[uid]

    def emit(self, record: logging.LogRecord) -> None:
        uid = getattr(record, "user_id", None)
        if not uid:
            return
        try:
            self._handler(uid).emit(record)
        except Exception:
            self.handleError(record)


# ── Filtro per nome logger ────────────────────────────────────────────────────

class _NameFilter(logging.Filter):
    def __init__(self, *substrings: str) -> None:
        super().__init__()
        self._subs = substrings

    def filter(self, record: logging.LogRecord) -> bool:
        return any(s in record.name for s in self._subs)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_fh(
    path: Path,
    level: int = logging.DEBUG,
    filt: logging.Filter | None = None,
) -> logging.FileHandler:
    h = logging.FileHandler(path, encoding="utf-8")
    h.setLevel(level)
    h.setFormatter(logging.Formatter(_MAIN_FMT, datefmt=_DATE_FMT))
    if filt:
        h.addFilter(filt)
    return h


# ── Punto di ingresso ─────────────────────────────────────────────────────────

def setup_logging(log_dir: Path) -> None:
    """
    Inizializza tutti i log handler. Da chiamare una sola volta all'avvio,
    prima di qualsiasi import che usi logging.getLogger(__name__).
    """
    log_dir.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.handlers.clear()

    # ── Console: INFO, formato compatto ──────────────────────────────────────
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(message)s", datefmt=_DATE_FMT,
    ))
    root.addHandler(console)

    # ── bot.log: riepilogo generale INFO+ ─────────────────────────────────────
    root.addHandler(_make_fh(log_dir / "bot.log", level=logging.INFO))

    # ── errors.log: WARNING+ da tutti ────────────────────────────────────────
    root.addHandler(_make_fh(log_dir / "errors.log", level=logging.WARNING))

    # ── signals.log: pipeline segnali (signal_processor + flusso app) ────────
    root.addHandler(_make_fh(
        log_dir / "signals.log",
        level=logging.DEBUG,
        filt=_NameFilter("signal_processor", "vps.api.app"),
    ))

    # ── mt5.log: tutto ciò che riguarda MT5 ──────────────────────────────────
    root.addHandler(_make_fh(
        log_dir / "mt5.log",
        level=logging.DEBUG,
        filt=_NameFilter("mt5_trader", "mt5_position_watcher", "mt5_range_watcher"),
    ))

    # ── strategy.log: StrategyExecutor ───────────────────────────────────────
    root.addHandler(_make_fh(
        log_dir / "strategy.log",
        level=logging.DEBUG,
        filt=_NameFilter("strategy_executor"),
    ))

    # ── backtest.log: BacktestEngine + routes ─────────────────────────────────
    root.addHandler(_make_fh(
        log_dir / "backtest.log",
        level=logging.DEBUG,
        filt=_NameFilter("backtest"),
    ))

    # ── ai_calls.log: logger dedicato "ai_calls", NON propaga al root ─────────
    ai_log = logging.getLogger("ai_calls")
    ai_log.propagate = False
    ai_log.setLevel(logging.DEBUG)
    ai_log.handlers.clear()
    ai_fh = logging.FileHandler(log_dir / "ai_calls.log", encoding="utf-8")
    ai_fh.setLevel(logging.DEBUG)
    ai_fh.setFormatter(logging.Formatter(
        "%(asctime)s\n%(message)s\n", datefmt=_DATE_FMT,
    ))
    ai_log.addHandler(ai_fh)

    # ── users/{uid}.log: per-utente (tutto DEBUG+) ───────────────────────────
    root.addHandler(_PerUserHandler(log_dir))
