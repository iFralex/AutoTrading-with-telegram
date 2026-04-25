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

import asyncio
import json
import logging
import os
import random
from dataclasses import dataclass
from typing import TYPE_CHECKING

from google import genai

if TYPE_CHECKING:
    from vps.services.ai_log_store import AILogStore

logger   = logging.getLogger(__name__)
_ai_log  = logging.getLogger("ai_calls")

# ── Flex tier retry ───────────────────────────────────────────────────────────

_FLEX_CONFIG = {
    "service_tier": "flex",
    "http_options": {"timeout": 900_000},
}
_FLEX_MAX_RETRIES = 8
_FLEX_BASE_DELAY  = 5.0    # secondi
_FLEX_MAX_DELAY   = 300.0  # 5 minuti


async def flex_retry(coro_factory, max_retries: int = _FLEX_MAX_RETRIES):
    """Esegue coro_factory() con backoff esponenziale su 429/503 Gemini Flex."""
    for attempt in range(max_retries):
        try:
            return await coro_factory()
        except Exception as exc:
            s = str(exc).lower()
            code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            retryable = (
                code in (429, 503)
                or "429" in s or "503" in s
                or "resource exhausted" in s
                or "service unavailable" in s
                or "overloaded" in s
                or "capacity" in s
                or "quota" in s
            )
            if not retryable or attempt >= max_retries - 1:
                raise
            delay = min(_FLEX_BASE_DELAY * (2 ** attempt) + random.uniform(0, 2), _FLEX_MAX_DELAY)
            logger.warning(
                "Gemini Flex: %s (tentativo %d/%d) — attesa %.0fs",
                exc, attempt + 1, max_retries, delay,
            )
            await asyncio.sleep(delay)

FLASH_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash-preview-04-17")
PRO_MODEL   = os.environ.get("GEMINI_PRO_MODEL",   "gemini-2.5-pro-preview-03-25")


# ── Struttura dati ────────────────────────────────────────────────────────────

@dataclass
class TradeSignal:
    symbol:      str                        # es. "XAUUSD"
    order_type:  str                        # "BUY" | "SELL"
    entry_price: float | list[float] | None # None → mercato; float → singolo; [a,b] → range
    stop_loss:   float | None
    take_profit: float | None
    lot_size:    float | None               # None → usa il default dell'utente
    order_mode:  str                        # "MARKET" | "LIMIT" | "STOP"
    prices:      list[float] | None = None  # livelli prezzo che triggerano la management_strategy


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
  "symbol"      : string               — trading instrument, uppercase, no slashes (e.g. "XAUUSD", "EURUSD")
  "order_type"  : string               — "BUY" or "SELL"
  "entry_price" : number|[number,number]|null
                                       — null if market order;
                                         a single number if one entry price is given;
                                         an array of exactly 2 numbers [first, second] if an entry range is given
  "stop_loss"   : number|null
  "take_profit" : number|null          — one value per object
  "lot_size"    : number|null          — explicit lot/volume if stated, else null
  "order_mode"  : string               — "MARKET" if no entry price given, otherwise "LIMIT"
  "prices"      : [number]|null        — price levels at which the management strategy should be
                                         triggered for this specific signal; null if not applicable

Rules:
- If multiple Take Profit levels exist, emit one object per TP
  (same symbol / order_type / entry_price / stop_loss, different take_profit).
- If an entry range is given (e.g. "4652 - 4656"), set entry_price to [4652, 4656]; do NOT average the values.
- If a single entry price is given, set entry_price to that number (not an array).
- Preserve all numeric values exactly as written; do not round or convert.
- "prices": if a management strategy is provided, derive any price levels expressible from
  this signal's entry_price, stop_loss, and take_profit (e.g. "50% between entry and TP"
  → entry + (take_profit - entry) * 0.5). Use the single numeric entry price for the
  computation; if entry_price is a range, use the midpoint. Set to null when no price
  trigger can be derived or no strategy is provided. Do NOT skip a level just because the
  strategy also checks real-time conditions (like account P&L) — the strategy AI will
  evaluate those conditions when the price is actually reached.
{sizing_section}{management_section}{custom_section}
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
        self._client    = genai.Client(api_key=api_key)
        self._ai_logs:  AILogStore | None = None
        logger.info(
            "SignalProcessor inizializzato (flash=%s, pro=%s)",
            FLASH_MODEL, PRO_MODEL,
        )

    def set_ai_log_store(self, store: AILogStore) -> None:
        """Inietta il log store per tracciare ogni chiamata Gemini."""
        self._ai_logs = store

    async def process(
        self,
        message: str,
        sizing_strategy: str | None = None,
        account_info: dict | None = None,
        user_id: str | None = None,
        extraction_instructions: str | None = None,
        management_strategy: str | None = None,
    ) -> list[TradeSignal]:
        """
        Punto di ingresso principale.
        Ritorna una lista (vuota se il messaggio non è un segnale).

        Args:
            message:         Testo del messaggio Telegram.
            sizing_strategy: Strategia di sizing in testo libero dell'utente.
            account_info:    Dict con balance/equity/free_margin/currency/leverage
                             recuperato da MT5 prima della chiamata.
        """
        if not message.strip():
            return []

        # ── Step 1: rilevamento rapido (Flash) ────────────────────────────────
        try:
            is_signal, _, _ = await self._detect(message, user_id=user_id)
        except Exception as exc:
            logger.error("Gemini Flash errore: %s", exc)
            return []

        if not is_signal:
            logger.debug("Messaggio classificato come non-segnale (Flash)")
            return []

        logger.info("Segnale rilevato — parsing con Gemini Pro...")

        # ── Step 2: estrazione strutturata (Pro) ──────────────────────────────
        try:
            signals, _, _ = await self._extract(message, sizing_strategy, account_info, user_id=user_id, extraction_instructions=extraction_instructions, management_strategy=management_strategy)
        except Exception as exc:
            logger.error("Gemini Pro errore: %s", exc)
            return []

        logger.info("Estratti %d segnali", len(signals))
        return signals

    async def detect_signal(self, message: str, user_id: str | None = None) -> bool:
        """
        Solo rilevamento rapido (Flash) — nessuna extraction.
        Utile per decidere se vale la pena aprire MT5 per il contesto sizing.
        """
        if not message.strip():
            return False
        try:
            result, _, _ = await self._detect(message, user_id=user_id)
            return result
        except Exception as exc:
            logger.error("Gemini Flash errore: %s", exc)
            return False

    async def extract_signals(
        self,
        message: str,
        sizing_strategy: str | None = None,
        account_info: dict | None = None,
        user_id: str | None = None,
        extraction_instructions: str | None = None,
        management_strategy: str | None = None,
        flex: bool = False,
    ) -> tuple[list[TradeSignal], int, int]:
        """
        Solo extraction Pro — da usare dopo aver già verificato che il
        messaggio è un segnale (es. con detect_signal()).
        Ritorna (signals, prompt_tokens, completion_tokens).
        """
        try:
            signals, tok_in, tok_out = await self._extract(
                message, sizing_strategy, account_info,
                user_id=user_id,
                extraction_instructions=extraction_instructions,
                management_strategy=management_strategy,
                flex=flex,
            )
        except Exception as exc:
            logger.error("Gemini Pro errore: %s", exc)
            return [], 0, 0
        logger.info("Estratti %d segnali", len(signals))
        return signals, tok_in, tok_out

    # ── Internals ─────────────────────────────────────────────────────────────

    async def _detect(self, message: str, user_id: str | None = None, flex: bool = False) -> tuple[bool, int, int]:
        from vps.services.ai_log_store import make_timer
        prompt = _DETECTION_PROMPT.format(message=message)
        timer  = make_timer()
        error: str | None = None
        resp   = None
        p_tok: int = 0
        c_tok: int = 0
        kwargs = {"config": _FLEX_CONFIG} if flex else {}
        try:
            async def _call():
                return await self._client.aio.models.generate_content(
                    model=FLASH_MODEL,
                    contents=prompt,
                    **kwargs,
                )
            resp = await (flex_retry(_call) if flex else _call())
        except Exception as exc:
            error = str(exc)
            raise
        finally:
            latency     = timer.elapsed_ms()
            meta        = getattr(resp, "usage_metadata", None) if resp else None
            p_tok       = getattr(meta, "prompt_token_count",     0) if meta else 0
            c_tok       = getattr(meta, "candidates_token_count", 0) if meta else 0
            result_text = (resp.text.strip() if resp and resp.text else None)
            if self._ai_logs is not None:
                try:
                    await self._ai_logs.insert(
                        call_type         = "flash_detect",
                        model             = FLASH_MODEL,
                        user_id           = user_id,
                        prompt_tokens     = p_tok or None,
                        completion_tokens = c_tok or None,
                        latency_ms        = latency,
                        error             = error,
                        context           = {
                            "message_preview": message[:200],
                            "response":        result_text,
                            "is_signal":       result_text.upper().startswith("YES") if result_text else None,
                        },
                    )
                except Exception as log_exc:
                    logger.warning("ai_logs insert (flash): %s", log_exc)
            # ── ai_calls.log: input e output completi ─────────────────────────
            _ai_log.debug(
                "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                "[FLASH_DETECT]  user=%-20s  model=%s  latency=%dms  tokens=%s/%s\n"
                "── PROMPT ───────────────────────────────────────────────────────────────────\n"
                "%s\n"
                "── RESPONSE ─────────────────────────────────────────────────────────────────\n"
                "%s\n"
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                user_id or "—", FLASH_MODEL,
                latency if resp is not None or error else 0,
                p_tok, c_tok,
                prompt,
                result_text if result_text is not None else f"(error: {error})",
            )
        return resp.text.strip().upper().startswith("YES"), p_tok, c_tok

    async def _extract(
        self,
        message: str,
        sizing_strategy: str | None,
        account_info: dict | None,
        user_id: str | None = None,
        extraction_instructions: str | None = None,
        management_strategy: str | None = None,
        flex: bool = False,
    ) -> tuple[list[TradeSignal], int, int]:
        from vps.services.ai_log_store import make_timer
        sizing_section      = _build_sizing_section(sizing_strategy, account_info)
        management_section  = _build_management_section(management_strategy)
        custom_section      = _build_custom_section(extraction_instructions)
        prompt = _EXTRACTION_PROMPT.format(
            message=message,
            sizing_section=sizing_section,
            management_section=management_section,
            custom_section=custom_section,
        )
        timer = make_timer()
        error: str | None = None
        resp  = None
        p_tok: int = 0
        c_tok: int = 0
        kwargs = {"config": _FLEX_CONFIG} if flex else {}
        try:
            async def _call():
                return await self._client.aio.models.generate_content(
                    model=PRO_MODEL,
                    contents=prompt,
                    **kwargs,
                )
            resp = await (flex_retry(_call) if flex else _call())
        except Exception as exc:
            error = str(exc)
            raise
        finally:
            latency = timer.elapsed_ms()
            meta    = getattr(resp, "usage_metadata", None) if resp else None
            p_tok   = getattr(meta, "prompt_token_count",     0) if meta else 0
            c_tok   = getattr(meta, "candidates_token_count", 0) if meta else 0
            if self._ai_logs is not None:
                try:
                    await self._ai_logs.insert(
                        call_type         = "pro_extract",
                        model             = PRO_MODEL,
                        user_id           = user_id,
                        prompt_tokens     = p_tok or None,
                        completion_tokens = c_tok or None,
                        latency_ms        = latency,
                        error             = error,
                        context           = {
                            "message_preview":  message[:200],
                            "response_preview": (resp.text[:300] if resp and resp.text else None),
                            "has_sizing":       bool(sizing_strategy),
                            "has_account_info": bool(account_info),
                        },
                    )
                except Exception as log_exc:
                    logger.warning("ai_logs insert (pro): %s", log_exc)
            # ── ai_calls.log: input e output completi ─────────────────────────
            _ai_log.debug(
                "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                "[PRO_EXTRACT]  user=%-20s  model=%s  latency=%dms  tokens=%s/%s\n"
                "── PROMPT ───────────────────────────────────────────────────────────────────\n"
                "%s\n"
                "── RESPONSE ─────────────────────────────────────────────────────────────────\n"
                "%s\n"
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                user_id or "—", PRO_MODEL,
                latency if resp is not None or error else 0,
                p_tok, c_tok,
                prompt,
                (resp.text if resp and resp.text else None) or f"(error: {error})",
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
                return [], p_tok, c_tok
            raw = json.loads(text[start:end])

        signals: list[TradeSignal] = []
        for item in raw:
            try:
                sig = TradeSignal(
                    symbol      = str(item["symbol"]).strip(),
                    order_type  = str(item["order_type"]).upper().strip(),
                    entry_price = _parse_entry(item.get("entry_price")),
                    stop_loss   = _to_float(item.get("stop_loss")),
                    take_profit = _to_float(item.get("take_profit")),
                    lot_size    = _to_float(item.get("lot_size")),
                    order_mode  = str(item.get("order_mode", "LIMIT")).upper(),
                    prices      = _parse_prices(item.get("prices")),
                )
                if sig.symbol and sig.order_type in ("BUY", "SELL"):
                    signals.append(sig)
                else:
                    logger.warning("Segnale ignorato (dati incompleti): %s", item)
            except (KeyError, TypeError, ValueError) as exc:
                logger.warning("Elemento ignorato (%s): %s", exc, item)

        return signals, p_tok, c_tok


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_sizing_section(
    sizing_strategy: str | None,
    account_info: dict | None,
) -> str:
    """
    Costruisce il blocco di testo da iniettare nel prompt Pro con
    la strategia di sizing dell'utente e il contesto del conto.
    Ritorna una stringa vuota se non ci sono informazioni disponibili.
    """
    if not sizing_strategy and not account_info:
        return ""

    lines: list[str] = [
        "",
        "Sizing strategy (apply when determining lot_size):",
    ]

    if sizing_strategy:
        lines.append(f'- User strategy: "{sizing_strategy}"')

    if account_info:
        lines.append("- Current account context:")
        lines.append(
            f"    balance={account_info['balance']} {account_info['currency']}, "
            f"equity={account_info['equity']} {account_info['currency']}, "
            f"free_margin={account_info['free_margin']} {account_info['currency']}, "
            f"leverage=1:{account_info['leverage']}"
        )

    lines += [
        "- Use this information to compute lot_size for each operation.",
        "- If the signal already states an explicit lot/volume, use that value instead.",
        "",
    ]
    return "\n".join(lines)


def _build_management_section(management_strategy: str | None) -> str:
    """
    Costruisce il blocco della management strategy da iniettare nel prompt Pro
    per guidare il calcolo del campo 'prices'.
    """
    if not management_strategy:
        return ""
    lines = [
        "",
        "Management strategy (use ONLY to compute the 'prices' field):",
        f'  "{management_strategy}"',
        "- Analyse the strategy rules and derive any price level that can be computed",
        "  from this signal's entry_price, stop_loss, or take_profit.",
        "- The strategy AI will evaluate all real-time conditions (account P&L, equity,",
        "  number of open positions, etc.) when that price is actually reached.",
        "  Therefore: always emit the computed price level even if the strategy also",
        "  involves conditions that depend on live account data.",
        "- Set 'prices' to null if no price trigger can be derived from the strategy.",
        "",
    ]
    return "\n".join(lines)


def _build_custom_section(extraction_instructions: str | None) -> str:
    """
    Costruisce il blocco di istruzioni custom da iniettare nel prompt Pro.
    Ritorna una stringa vuota se non ci sono istruzioni.
    """
    if not extraction_instructions:
        return ""
    lines = [
        "",
        "Additional extraction instructions (apply to all signals):",
        f'- {extraction_instructions.strip()}',
        "",
    ]
    return "\n".join(lines)


def _parse_entry(v) -> float | list[float] | None:
    """Parsa entry_price: None, numero singolo, o array [a, b]."""
    if v is None:
        return None
    if isinstance(v, list):
        parsed = [_to_float(x) for x in v[:2]]
        if len(parsed) == 2 and all(x is not None for x in parsed):
            return [parsed[0], parsed[1]]  # type: ignore[return-value]
        return None
    return _to_float(v)


def _parse_prices(v) -> list[float] | None:
    """Parsa prices: None o lista non-vuota di float."""
    if not isinstance(v, list) or not v:
        return None
    result = [_to_float(x) for x in v]
    parsed = [x for x in result if x is not None]
    return parsed if parsed else None


def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
