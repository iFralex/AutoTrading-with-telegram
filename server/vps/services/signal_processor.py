"""
SignalProcessor — pipeline Gemini per i segnali Telegram.

Step 1 (Flash)  : classifica il messaggio (segnale sì/no) — veloce e economico.
Step 2 (Pro)    : estrae le operazioni strutturate — accurato.

I nomi dei modelli si configurano via env:
  GEMINI_FLASH_MODEL  (default: gemini-2.5-flash-preview)
  GEMINI_PRO_MODEL    (default: gemini-2.5-pro-preview)

Verifica i model-id esatti su: https://ai.google.dev/gemini-api/docs/models
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

import google.generativeai as genai

logger = logging.getLogger(__name__)

FLASH_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash-preview")
PRO_MODEL   = os.environ.get("GEMINI_PRO_MODEL",   "gemini-2.5-pro-preview")


# ── Struttura dati ────────────────────────────────────────────────────────────

@dataclass
class TradeSignal:
    symbol:      str            # es. "XAUUSD"
    order_type:  str            # "BUY" | "SELL"
    entry_price: float | None   # None → ordine a mercato
    stop_loss:   float | None
    take_profit: float | None
    lot_size:    float | None   # None → usa il default dell'utente
    order_mode:  str            # "MARKET" | "LIMIT" | "STOP"


# ── Prompt ────────────────────────────────────────────────────────────────────

_DETECTION_PROMPT = """\
You are monitoring a Telegram trading-signals channel.
Answer with exactly one word — YES or NO.
Is the following message a trading signal that contains an actionable BUY or SELL instruction?

Message:
{message}"""

_EXTRACTION_PROMPT = """\
You are a professional trading signal parser.
Extract every trading operation from the message below.

Return ONLY a valid JSON array (no markdown, no explanation).
Each element must have these exact keys:
  "symbol"      : string  — trading instrument, uppercase, no slashes (e.g. "XAUUSD", "EURUSD")
  "order_type"  : string  — "BUY" or "SELL"
  "entry_price" : number|null — primary entry price; null means market order
  "stop_loss"   : number|null
  "take_profit" : number|null — one value per object
  "lot_size"    : number|null — explicit lot/volume if stated, else null
  "order_mode"  : string  — "MARKET" if no entry price given, otherwise "LIMIT"

Rules:
- If multiple Take Profit levels exist, emit one object per TP
  (same symbol / order_type / entry_price / stop_loss, different take_profit).
- If an entry range is given (e.g. "4656 - 4652"), use the first value as entry_price.
- Preserve all numeric values exactly as written; do not round or convert.

Message:
{message}"""


# ── Classe principale ─────────────────────────────────────────────────────────

class SignalProcessor:
    """
    Uso:
        processor = SignalProcessor(api_key="...")
        signals = await processor.process(message_text)
        # → [] se non è un segnale, altrimenti lista di TradeSignal
    """

    def __init__(self, api_key: str) -> None:
        genai.configure(api_key=api_key)
        self._flash = genai.GenerativeModel(FLASH_MODEL)
        self._pro   = genai.GenerativeModel(PRO_MODEL)
        logger.info(
            "SignalProcessor inizializzato (flash=%s, pro=%s)",
            FLASH_MODEL, PRO_MODEL,
        )

    async def process(self, message: str) -> list[TradeSignal]:
        """
        Punto di ingresso principale.
        Ritorna una lista (vuota se il messaggio non è un segnale).
        """
        if not message.strip():
            return []

        # ── Step 1: rilevamento rapido (Flash) ────────────────────────────────
        try:
            is_signal = await self._detect(message)
        except Exception as exc:
            logger.error("Gemini Flash errore: %s", exc)
            return []

        if not is_signal:
            logger.debug("Messaggio classificato come non-segnale (Flash)")
            return []

        logger.info("Segnale rilevato — parsing con Gemini Pro...")

        # ── Step 2: estrazione strutturata (Pro) ──────────────────────────────
        try:
            signals = await self._extract(message)
        except Exception as exc:
            logger.error("Gemini Pro errore: %s", exc)
            return []

        logger.info("Estratti %d segnali", len(signals))
        return signals

    # ── Internals ─────────────────────────────────────────────────────────────

    async def _detect(self, message: str) -> bool:
        resp = await self._flash.generate_content_async(
            _DETECTION_PROMPT.format(message=message)
        )
        return resp.text.strip().upper().startswith("YES")

    async def _extract(self, message: str) -> list[TradeSignal]:
        resp = await self._pro.generate_content_async(
            _EXTRACTION_PROMPT.format(message=message)
        )
        text = resp.text.strip()

        # Rimuovi eventuale wrapper markdown ```json ... ```
        if text.startswith("```"):
            parts = text.split("```")
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        try:
            raw: list[dict] = json.loads(text)
        except json.JSONDecodeError:
            # Fallback: cerca l'array nel testo
            start = text.find("[")
            end   = text.rfind("]") + 1
            if start == -1 or end == 0:
                logger.error("Gemini Pro output non parsabile:\n%.300s", text)
                return []
            raw = json.loads(text[start:end])

        signals: list[TradeSignal] = []
        for item in raw:
            try:
                sig = TradeSignal(
                    symbol      = str(item["symbol"]).upper().strip(),
                    order_type  = str(item["order_type"]).upper().strip(),
                    entry_price = _to_float(item.get("entry_price")),
                    stop_loss   = _to_float(item.get("stop_loss")),
                    take_profit = _to_float(item.get("take_profit")),
                    lot_size    = _to_float(item.get("lot_size")),
                    order_mode  = str(item.get("order_mode", "LIMIT")).upper(),
                )
                if sig.symbol and sig.order_type in ("BUY", "SELL"):
                    signals.append(sig)
                else:
                    logger.warning("Segnale ignorato (dati incompleti): %s", item)
            except (KeyError, TypeError, ValueError) as exc:
                logger.warning("Elemento ignorato (%s): %s", exc, item)

        return signals


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
