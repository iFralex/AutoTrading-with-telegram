"""
StrategyExecutor — motore AI agent per l'esecuzione di strategie di trading.

Ogni utente può definire una "management_strategy" in testo libero.
Questo modulo la esegue tramite un agente Gemini con function calling, che ha
accesso a tutti gli strumenti MT5 necessari.

Due modalità di esecuzione:
  pre_trade()   — chiamato PRIMA di eseguire nuovi segnali.
                  L'AI può approvare, rifiutare o modificare ogni segnale.
  on_event()    — chiamato DOPO un evento (posizione chiusa, aperta, modificata).
                  L'AI decide quali azioni intraprendere sulle posizioni esistenti.

Sicurezza:
  - MAX_ITERATIONS limita il numero di cicli tool-call per evitare loop infiniti.
  - Ogni esecuzione ha un lock per utente: evita race condition se arrivano
    due eventi contemporaneamente per lo stesso utente.
  - Gli errori nei tool vengono restituiti all'AI come stringa d'errore,
    non rilanciano eccezioni.

Uso:
    executor = StrategyExecutor(api_key="...", mt5_trader=trader)

    # Pre-trade: prima di eseguire segnali
    decisions = await executor.pre_trade(
        user_id="123",
        signals=signals,
        management_strategy="Non operare il venerdì...",
        mt5_login=..., mt5_password=..., mt5_server=...,
        signal_message="BUY XAUUSD @2340...",
    )

    # Post-evento: dopo la chiusura di una posizione
    result = await executor.on_event(
        user_id="123",
        event_type="position_closed",
        event_data={"ticket": 1001, "symbol": "XAUUSD", ...},
        management_strategy="Sposta SL a break even dopo TP1...",
        mt5_login=..., mt5_password=..., mt5_server=...,
    )
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from google import genai
from google.genai import types

from vps.services.signal_processor import TradeSignal
from vps.services.mt5_trader import MT5Trader

if TYPE_CHECKING:
    from vps.services.ai_log_store import AILogStore

logger = logging.getLogger(__name__)

_PRO_MODEL    = os.environ.get("GEMINI_PRO_MODEL", "gemini-2.5-pro-preview-03-25")
MAX_ITERATIONS = 30   # sicurezza: max cicli tool-call per esecuzione


# ══════════════════════════════════════════════════════════════════════════════
# Strutture dati
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class PreTradeDecision:
    signal_index:    int
    approved:        bool
    modified_lots:   float | None = None   # se non None, sostituisce il lot_size originale
    modified_sl:     float | None = None   # se non None, sostituisce lo stop_loss originale
    modified_tp:     float | None = None   # se non None, sostituisce il take_profit originale
    reason:          str          = ""


@dataclass
class StrategyResult:
    event_type:     str
    tool_calls:     list[dict]  = field(default_factory=list)
    final_response: str         = ""
    error:          str | None  = None


# ══════════════════════════════════════════════════════════════════════════════
# Definizioni dei tool (schema JSON per Gemini)
# ══════════════════════════════════════════════════════════════════════════════

def _make_tools(include_pretrade: bool = False) -> list[dict]:
    """
    Costruisce la lista completa di tool definitions da passare a Gemini.
    include_pretrade=True aggiunge i tool approve/reject/modify_signal.
    """
    declarations = [

        # ── Account & mercato ──────────────────────────────────────────────
        {
            "name": "get_account_info",
            "description": (
                "Restituisce le informazioni complete del conto MT5: balance, equity, "
                "margin, free_margin, profit_floating (P&L non realizzato totale), "
                "leverage, currency, login, server."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "get_daily_pnl",
            "description": (
                "Restituisce il P&L realizzato (posizioni chiuse) della giornata corrente "
                "in valuta conto. Esclude depositi e prelievi."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "get_weekly_pnl",
            "description": "Restituisce il P&L realizzato degli ultimi 7 giorni.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "get_monthly_pnl",
            "description": "Restituisce il P&L realizzato degli ultimi 30 giorni.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "get_current_datetime",
            "description": (
                "Restituisce la data e ora UTC corrente: "
                "date (YYYY-MM-DD), time (HH:MM:SS), weekday_name (es. 'Friday'), "
                "weekday_number (0=lunedì…6=domenica), hour, minute, is_weekend."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "get_current_price",
            "description": "Restituisce bid, ask, spread_pips e last per il simbolo specificato.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Es. 'XAUUSD', 'EURUSD'"},
                },
                "required": ["symbol"],
            },
        },
        {
            "name": "get_symbol_info",
            "description": (
                "Restituisce le specifiche del simbolo: pip_value_per_lot, contract_size, "
                "digits, volume_min/max/step, currency_base, currency_profit, spread."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Es. 'XAUUSD'"},
                },
                "required": ["symbol"],
            },
        },
        {
            "name": "calculate_lot_for_risk",
            "description": (
                "Calcola il lot size per rischiare esattamente risk_amount (in valuta conto) "
                "con uno stop loss di sl_pips pips. "
                "Tiene conto del pip value del simbolo e del volume_step del broker."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol":       {"type": "string",  "description": "Simbolo da tradare"},
                    "risk_amount":  {"type": "number",  "description": "Importo da rischiare in valuta conto (es. 50.0)"},
                    "sl_pips":      {"type": "number",  "description": "Distanza dello stop loss in pips"},
                },
                "required": ["symbol", "risk_amount", "sl_pips"],
            },
        },
        {
            "name": "calculate_lot_for_risk_percent",
            "description": (
                "Calcola il lot size per rischiare esattamente risk_percent% dell'equity "
                "con uno stop loss di sl_pips pips."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol":       {"type": "string", "description": "Simbolo da tradare"},
                    "risk_percent": {"type": "number", "description": "Percentuale di equity da rischiare (es. 1.0 per 1%)"},
                    "sl_pips":      {"type": "number", "description": "Distanza dello stop loss in pips"},
                },
                "required": ["symbol", "risk_percent", "sl_pips"],
            },
        },

        # ── Lettura posizioni ──────────────────────────────────────────────
        {
            "name": "get_open_positions",
            "description": (
                "Restituisce tutte le posizioni aperte. Ogni posizione contiene: "
                "ticket, symbol, order_type (BUY/SELL), lots, entry_price, current_price, "
                "sl, tp, profit, pips, open_time, signal_group_id (identifica posizioni "
                "dallo stesso segnale Telegram)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "Filtra per simbolo (opzionale). Se omesso, restituisce tutto.",
                    },
                },
                "required": [],
            },
        },
        {
            "name": "get_pending_orders",
            "description": (
                "Restituisce tutti gli ordini pendenti (limit, stop, stop-limit). "
                "Ogni ordine contiene: ticket, symbol, order_type, lots, price, sl, tp, "
                "created_time, signal_group_id."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Filtra per simbolo (opzionale)."},
                },
                "required": [],
            },
        },
        {
            "name": "get_position_history",
            "description": (
                "Restituisce lo storico dei deal chiusi degli ultimi N giorni. "
                "Ogni deal contiene: ticket, position_id, symbol, order_type, lots, price, "
                "profit, reason (TP/SL/CLIENT/EXPERT), entry (IN/OUT), close_time."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days":   {"type": "integer", "description": "Quanti giorni di storico (default 1)"},
                    "symbol": {"type": "string",  "description": "Filtra per simbolo (opzionale)"},
                },
                "required": [],
            },
        },
        {
            "name": "count_open_positions",
            "description": "Conta le posizioni aperte, opzionalmente filtrate per simbolo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Simbolo (opzionale)"},
                },
                "required": [],
            },
        },
        {
            "name": "count_pending_orders",
            "description": "Conta gli ordini pendenti, opzionalmente filtrati per simbolo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Simbolo (opzionale)"},
                },
                "required": [],
            },
        },

        # ── Gestione posizioni aperte ──────────────────────────────────────
        {
            "name": "move_stop_loss",
            "description": "Sposta lo stop loss di una posizione aperta a un nuovo valore assoluto di prezzo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticket": {"type": "integer", "description": "Ticket della posizione"},
                    "new_sl": {"type": "number",  "description": "Nuovo prezzo dello stop loss (valore assoluto)"},
                },
                "required": ["ticket", "new_sl"],
            },
        },
        {
            "name": "move_take_profit",
            "description": "Sposta il take profit di una posizione aperta a un nuovo valore assoluto di prezzo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticket": {"type": "integer", "description": "Ticket della posizione"},
                    "new_tp": {"type": "number",  "description": "Nuovo prezzo del take profit (valore assoluto)"},
                },
                "required": ["ticket", "new_tp"],
            },
        },
        {
            "name": "set_breakeven",
            "description": (
                "Sposta lo stop loss al prezzo di entry della posizione (break even). "
                "offset_pips aggiunge una distanza di sicurezza in pips oltre il break even "
                "(es. offset_pips=2 garantisce almeno 2 pips di profitto nel peggiore dei casi)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ticket":       {"type": "integer", "description": "Ticket della posizione"},
                    "offset_pips":  {"type": "number",  "description": "Pips oltre il break even (default 0)"},
                },
                "required": ["ticket"],
            },
        },
        {
            "name": "close_position",
            "description": (
                "Chiude una posizione aperta. Se lots è specificato, è una chiusura parziale; "
                "se omesso, chiude l'intera posizione."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ticket": {"type": "integer", "description": "Ticket della posizione"},
                    "lots":   {"type": "number",  "description": "Lotti da chiudere (ometti per chiusura totale)"},
                },
                "required": ["ticket"],
            },
        },
        {
            "name": "close_all_positions",
            "description": "Chiude tutte le posizioni aperte, opzionalmente filtrate per simbolo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Simbolo da chiudere (opzionale; ometti per chiudere tutto)"},
                },
                "required": [],
            },
        },

        # ── Gestione ordini pendenti ───────────────────────────────────────
        {
            "name": "cancel_pending_order",
            "description": "Cancella un ordine pendente (limit, stop o stop-limit).",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticket": {"type": "integer", "description": "Ticket dell'ordine pendente"},
                },
                "required": ["ticket"],
            },
        },
        {
            "name": "cancel_all_pending_orders",
            "description": "Cancella tutti gli ordini pendenti, opzionalmente filtrati per simbolo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Simbolo (opzionale)"},
                },
                "required": [],
            },
        },
        {
            "name": "modify_pending_order",
            "description": (
                "Modifica il prezzo di entrata, lo stop loss e/o il take profit di un ordine pendente. "
                "I parametri omessi lasciano invariato il valore attuale."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ticket":    {"type": "integer", "description": "Ticket dell'ordine"},
                    "new_price": {"type": "number",  "description": "Nuovo prezzo di entrata (opzionale)"},
                    "new_sl":    {"type": "number",  "description": "Nuovo stop loss (opzionale)"},
                    "new_tp":    {"type": "number",  "description": "Nuovo take profit (opzionale)"},
                },
                "required": ["ticket"],
            },
        },

        # ── Apertura nuove posizioni/ordini ────────────────────────────────
        {
            "name": "open_market_order",
            "description": (
                "Apre un nuovo ordine a mercato. Da usare solo se la strategia prevede "
                "esplicitamente l'apertura di nuove posizioni (es. hedging, scaling)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol":     {"type": "string",  "description": "Es. 'XAUUSD'"},
                    "order_type": {"type": "string",  "description": "'BUY' o 'SELL'"},
                    "lots":       {"type": "number",  "description": "Volume in lotti"},
                    "sl":         {"type": "number",  "description": "Stop loss (opzionale)"},
                    "tp":         {"type": "number",  "description": "Take profit (opzionale)"},
                },
                "required": ["symbol", "order_type", "lots"],
            },
        },
        {
            "name": "place_pending_order",
            "description": (
                "Piazza un nuovo ordine pendente a un prezzo specifico."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol":     {"type": "string",  "description": "Es. 'XAUUSD'"},
                    "order_type": {"type": "string",  "description": "'BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP'"},
                    "price":      {"type": "number",  "description": "Prezzo di entrata"},
                    "lots":       {"type": "number",  "description": "Volume in lotti"},
                    "sl":         {"type": "number",  "description": "Stop loss (opzionale)"},
                    "tp":         {"type": "number",  "description": "Take profit (opzionale)"},
                },
                "required": ["symbol", "order_type", "price", "lots"],
            },
        },
    ]

    if include_pretrade:
        declarations += [
            {
                "name": "approve_signal",
                "description": (
                    "Approva il segnale con l'indice specificato: verrà eseguito normalmente. "
                    "Se non viene chiamato nessun tool per un segnale, viene approvato di default."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "signal_index": {"type": "integer", "description": "Indice del segnale (0-based)"},
                        "reason":       {"type": "string",  "description": "Motivazione (opzionale)"},
                    },
                    "required": ["signal_index"],
                },
            },
            {
                "name": "reject_signal",
                "description": (
                    "Rifiuta il segnale con l'indice specificato: NON verrà eseguito."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "signal_index": {"type": "integer", "description": "Indice del segnale (0-based)"},
                        "reason":       {"type": "string",  "description": "Motivazione obbligatoria"},
                    },
                    "required": ["signal_index", "reason"],
                },
            },
            {
                "name": "modify_signal",
                "description": (
                    "Approva il segnale ma modifica uno o più parametri prima dell'esecuzione: "
                    "lot size, stop loss e/o take profit."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "signal_index": {"type": "integer", "description": "Indice del segnale (0-based)"},
                        "new_lots":     {"type": "number",  "description": "Nuovo lot size (opzionale)"},
                        "new_sl":       {"type": "number",  "description": "Nuovo stop loss (opzionale)"},
                        "new_tp":       {"type": "number",  "description": "Nuovo take profit (opzionale)"},
                        "reason":       {"type": "string",  "description": "Motivazione (opzionale)"},
                    },
                    "required": ["signal_index"],
                },
            },
        ]

    return [{"function_declarations": declarations}]


# ══════════════════════════════════════════════════════════════════════════════
# Contesto di esecuzione — wrappa MT5Trader con le credenziali dell'utente
# ══════════════════════════════════════════════════════════════════════════════

class _ExecCtx:
    """
    Fornisce tutti i metodi MT5 in forma async agli handler dei tool.
    Istanziato una volta per ogni chiamata pre_trade() / on_event().
    """
    def __init__(
        self,
        trader: MT5Trader,
        user_id: str,
        login: int,
        password: str,
        server: str,
    ) -> None:
        self.trader   = trader
        self.user_id  = user_id
        self.login    = login
        self.password = password
        self.server   = server

    # shortcuts
    def _creds(self):
        return self.user_id, self.login, self.password, self.server


# ══════════════════════════════════════════════════════════════════════════════
# Classe principale
# ══════════════════════════════════════════════════════════════════════════════

class StrategyExecutor:
    """
    Agente AI che esegue strategie di trading tramite Gemini function calling.

    Thread-safety: per ogni user_id esiste un asyncio.Lock che impedisce
    esecuzioni concorrenti (evita che due eventi simultanei mandino ordini
    conflittuali su MT5).
    """

    def __init__(self, api_key: str, mt5_trader: MT5Trader) -> None:
        self._client     = genai.Client(api_key=api_key)
        self._trader     = mt5_trader
        self._user_locks: dict[str, asyncio.Lock] = {}
        self._ai_logs:    AILogStore | None = None
        logger.info("StrategyExecutor inizializzato (model=%s)", _PRO_MODEL)

    def set_ai_log_store(self, store: AILogStore) -> None:
        """Inietta il log store per tracciare ogni chiamata Gemini."""
        self._ai_logs = store

    def _get_lock(self, user_id: str) -> asyncio.Lock:
        if user_id not in self._user_locks:
            self._user_locks[user_id] = asyncio.Lock()
        return self._user_locks[user_id]

    # ── API pubblica ──────────────────────────────────────────────────────────

    async def pre_trade(
        self,
        user_id: str,
        signals: list[TradeSignal],
        management_strategy: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        signal_message: str = "",
    ) -> list[PreTradeDecision]:
        """
        Valuta i segnali in arrivo secondo la strategia dell'utente.
        Ritorna una lista di PreTradeDecision (una per segnale).
        Segnali non menzionati dall'AI vengono approvati di default.
        """
        if not management_strategy.strip() or not signals:
            return [PreTradeDecision(i, approved=True) for i in range(len(signals))]

        signals_text = "\n".join(
            f"  [{i}] {s.order_type} {s.symbol}"
            f" entry={s.entry_price} SL={s.stop_loss} TP={s.take_profit}"
            f" lots={s.lot_size} mode={s.order_mode}"
            for i, s in enumerate(signals)
        )
        event_prompt = (
            "EVENTO: Nuovi segnali di trading ricevuti. Devi valutarli TUTTI.\n\n"
            f"Messaggio sorgente:\n{signal_message}\n\n"
            f"Segnali da valutare:\n{signals_text}\n\n"
            "Per ogni segnale chiama approve_signal, reject_signal o modify_signal.\n"
            "Se non chiami nessun tool per un segnale, verrà approvato di default.\n"
            "Usa i tool di lettura (get_account_info, get_daily_pnl, ecc.) se la tua "
            "strategia richiede informazioni aggiuntive per decidere."
        )

        ctx       = _ExecCtx(self._trader, user_id, mt5_login, mt5_password, mt5_server)
        decisions: dict[int, PreTradeDecision] = {}

        async with self._get_lock(user_id):
            result = await self._run_agent(
                management_strategy=management_strategy,
                event_prompt=event_prompt,
                ctx=ctx,
                include_pretrade_tools=True,
                pretrade_decisions=decisions,
                call_type="strategy_pretrade",
            )

        # Segnali non gestiti → approvati di default
        all_decisions = [
            decisions.get(i, PreTradeDecision(i, approved=True))
            for i in range(len(signals))
        ]

        logger.info(
            "pre_trade utente %s: %d/%d approvati, %d rifiutati, %d modificati",
            user_id,
            sum(1 for d in all_decisions if d.approved and d.modified_lots is None
                                        and d.modified_sl is None and d.modified_tp is None),
            len(all_decisions),
            sum(1 for d in all_decisions if not d.approved),
            sum(1 for d in all_decisions if d.approved and (
                d.modified_lots is not None or d.modified_sl is not None or d.modified_tp is not None)),
        )
        return all_decisions

    async def on_event(
        self,
        user_id: str,
        event_type: str,
        event_data: dict,
        management_strategy: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
    ) -> StrategyResult:
        """
        Reagisce a un evento MT5 (posizione chiusa/aperta/modificata).
        L'AI legge la strategia, raccoglie i dati necessari e agisce.
        """
        if not management_strategy.strip():
            return StrategyResult(event_type=event_type, final_response="Nessuna strategia configurata.")

        event_prompt = _format_event_prompt(event_type, event_data)
        ctx          = _ExecCtx(self._trader, user_id, mt5_login, mt5_password, mt5_server)

        async with self._get_lock(user_id):
            result = await self._run_agent(
                management_strategy=management_strategy,
                event_prompt=event_prompt,
                ctx=ctx,
                include_pretrade_tools=False,
                pretrade_decisions=None,
            )

        result.event_type = event_type
        return result

    # ── Agent loop ────────────────────────────────────────────────────────────

    async def _run_agent(
        self,
        management_strategy: str,
        event_prompt: str,
        ctx: _ExecCtx,
        include_pretrade_tools: bool,
        pretrade_decisions: dict[int, PreTradeDecision] | None,
        call_type: str = "strategy_event",
    ) -> StrategyResult:
        """
        Ciclo principale: invia il prompt a Gemini, esegue i tool call in loop
        finché l'AI non produce una risposta finale (senza function call).
        """
        from vps.services.ai_log_store import make_timer
        tools     = _make_tools(include_pretrade=include_pretrade_tools)
        tool_log: list[dict] = []

        system_prompt = _build_system_prompt(management_strategy)
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=tools,  # type: ignore[arg-type]
        )
        chat = self._client.aio.chats.create(model=_PRO_MODEL, config=config)

        timer = make_timer()
        total_prompt_tokens:     int = 0
        total_completion_tokens: int = 0
        error_str: str | None        = None
        final_text: str              = ""

        def _accumulate_tokens(resp: Any) -> None:
            nonlocal total_prompt_tokens, total_completion_tokens
            meta = getattr(resp, "usage_metadata", None)
            if meta:
                total_prompt_tokens     += getattr(meta, "prompt_token_count",     0) or 0
                total_completion_tokens += getattr(meta, "candidates_token_count", 0) or 0

        try:
            try:
                response = await chat.send_message(event_prompt)
            except Exception as exc:
                logger.error("StrategyExecutor: errore chiamata Gemini iniziale: %s", exc)
                error_str = str(exc)
                return StrategyResult(event_type="", error=error_str)

            _accumulate_tokens(response)

            for iteration in range(MAX_ITERATIONS):
                # Raccogli tutti i function call della risposta corrente
                fn_calls = response.function_calls or []

                if not fn_calls:
                    # L'AI ha finito — raccoglie il testo finale
                    final_text = response.text or ""
                    logger.info(
                        "StrategyExecutor utente %s: completato in %d iterazioni, %d tool call",
                        ctx.user_id, iteration + 1, len(tool_log),
                    )
                    return StrategyResult(
                        event_type="",
                        tool_calls=tool_log,
                        final_response=final_text.strip(),
                    )

                # Esegui i tool call e prepara le risposte
                fn_response_parts = []
                for fc in fn_calls:
                    name = fc.name
                    args = dict(fc.args)
                    logger.debug("StrategyExecutor: tool call %s(%s)", name, args)

                    result_data = await self._dispatch(
                        name, args, ctx, pretrade_decisions
                    )

                    tool_log.append({"name": name, "args": args, "result": result_data})

                    fn_response_parts.append(
                        types.Part.from_function_response(
                            name=name,
                            response={"result": json.dumps(result_data, default=str)},
                        )
                    )

                # Manda i risultati dei tool back all'AI
                try:
                    response = await chat.send_message(fn_response_parts)
                except Exception as exc:
                    logger.error("StrategyExecutor: errore Gemini iterazione %d: %s", iteration, exc)
                    error_str = str(exc)
                    return StrategyResult(
                        event_type="",
                        tool_calls=tool_log,
                        error=error_str,
                    )

                _accumulate_tokens(response)

            # Raggiunto MAX_ITERATIONS senza risposta finale
            logger.warning(
                "StrategyExecutor utente %s: raggiunto MAX_ITERATIONS (%d)",
                ctx.user_id, MAX_ITERATIONS,
            )
            error_str = f"MAX_ITERATIONS ({MAX_ITERATIONS}) raggiunte senza risposta finale"
            return StrategyResult(
                event_type="",
                tool_calls=tool_log,
                error=error_str,
            )

        finally:
            if self._ai_logs is not None:
                latency = timer.elapsed_ms()
                try:
                    await self._ai_logs.insert(
                        call_type         = call_type,
                        model             = _PRO_MODEL,
                        user_id           = ctx.user_id,
                        prompt_tokens     = total_prompt_tokens     or None,
                        completion_tokens = total_completion_tokens or None,
                        latency_ms        = latency,
                        error             = error_str,
                        context           = {
                            "event_prompt_preview":   event_prompt[:200],
                            "iterations":             len(tool_log),
                            "tool_calls_count":       len(tool_log),
                            "final_response_preview": final_text[:300] if final_text else None,
                            "include_pretrade_tools": include_pretrade_tools,
                        },
                    )
                except Exception as log_exc:
                    logger.warning("ai_logs insert (strategy): %s", log_exc)

    # ── Dispatcher tool ───────────────────────────────────────────────────────

    async def _dispatch(
        self,
        name: str,
        args: dict,
        ctx: _ExecCtx,
        decisions: dict[int, PreTradeDecision] | None,
    ) -> Any:
        """
        Mappa il nome del tool alla sua implementazione.
        Errori interni vengono restituiti come {"error": "..."} invece di propagarsi,
        così l'AI può ricevere il messaggio di errore e decidere come procedere.
        """
        u, l, p, s = ctx.user_id, ctx.login, ctx.password, ctx.server
        trader = ctx.trader

        try:

            # ── Account & mercato ──────────────────────────────────────────
            if name == "get_account_info":
                return await trader.get_full_account_info(u, l, p, s)

            if name == "get_daily_pnl":
                now  = datetime.now(timezone.utc)
                from_ = now.replace(hour=0, minute=0, second=0, microsecond=0)
                return {"pnl": await trader.get_pnl_for_period(u, l, p, s, from_, now)}

            if name == "get_weekly_pnl":
                now  = datetime.now(timezone.utc)
                from_ = now - timedelta(days=7)
                return {"pnl": await trader.get_pnl_for_period(u, l, p, s, from_, now)}

            if name == "get_monthly_pnl":
                now  = datetime.now(timezone.utc)
                from_ = now - timedelta(days=30)
                return {"pnl": await trader.get_pnl_for_period(u, l, p, s, from_, now)}

            if name == "get_current_datetime":
                now = datetime.now(timezone.utc)
                return {
                    "date":           now.strftime("%Y-%m-%d"),
                    "time":           now.strftime("%H:%M:%S"),
                    "weekday_name":   now.strftime("%A"),
                    "weekday_number": now.weekday(),   # 0=lunedì, 6=domenica
                    "hour":           now.hour,
                    "minute":         now.minute,
                    "is_weekend":     now.weekday() >= 5,
                    "timezone":       "UTC",
                }

            if name == "get_current_price":
                return await trader.get_symbol_tick(u, l, p, s, args["symbol"])

            if name == "get_symbol_info":
                return await trader.get_symbol_specs(u, l, p, s, args["symbol"])

            if name == "calculate_lot_for_risk":
                sym_info = await trader.get_symbol_specs(u, l, p, s, args["symbol"])
                if "error" in sym_info:
                    return sym_info
                pip_val = sym_info.get("pip_value_per_lot", 1.0)
                if pip_val == 0:
                    return {"error": "pip_value_per_lot è 0, impossibile calcolare"}
                lot = args["risk_amount"] / (args["sl_pips"] * pip_val)
                step = sym_info.get("volume_step", 0.01)
                lot  = max(sym_info.get("volume_min", 0.01),
                           round(lot / step) * step)
                lot  = min(lot, sym_info.get("volume_max", 100.0))
                return {"lots": round(lot, 8)}

            if name == "calculate_lot_for_risk_percent":
                acct     = await trader.get_full_account_info(u, l, p, s)
                if "error" in acct:
                    return acct
                risk_amt = acct["equity"] * args["risk_percent"] / 100.0
                sym_info = await trader.get_symbol_specs(u, l, p, s, args["symbol"])
                if "error" in sym_info:
                    return sym_info
                pip_val = sym_info.get("pip_value_per_lot", 1.0)
                if pip_val == 0:
                    return {"error": "pip_value_per_lot è 0, impossibile calcolare"}
                lot  = risk_amt / (args["sl_pips"] * pip_val)
                step = sym_info.get("volume_step", 0.01)
                lot  = max(sym_info.get("volume_min", 0.01),
                           round(lot / step) * step)
                lot  = min(lot, sym_info.get("volume_max", 100.0))
                return {"lots": round(lot, 8), "risk_amount_used": round(risk_amt, 2)}

            # ── Lettura posizioni ──────────────────────────────────────────
            if name == "get_open_positions":
                return await trader.get_positions(u, l, p, s, symbol=args.get("symbol"))

            if name == "get_pending_orders":
                return await trader.get_pending_orders_list(u, l, p, s, symbol=args.get("symbol"))

            if name == "get_position_history":
                return await trader.get_closed_deals(
                    u, l, p, s,
                    days=int(args.get("days", 1)),
                    symbol=args.get("symbol"),
                )

            if name == "count_open_positions":
                positions = await trader.get_positions(u, l, p, s, symbol=args.get("symbol"))
                return {"count": len(positions)}

            if name == "count_pending_orders":
                orders = await trader.get_pending_orders_list(u, l, p, s, symbol=args.get("symbol"))
                return {"count": len(orders)}

            # ── Modifica posizioni aperte ──────────────────────────────────
            if name == "move_stop_loss":
                return await trader.modify_position(
                    u, l, p, s,
                    ticket=int(args["ticket"]),
                    new_sl=float(args["new_sl"]),
                )

            if name == "move_take_profit":
                return await trader.modify_position(
                    u, l, p, s,
                    ticket=int(args["ticket"]),
                    new_tp=float(args["new_tp"]),
                )

            if name == "set_breakeven":
                return await trader.set_breakeven(
                    u, l, p, s,
                    ticket=int(args["ticket"]),
                    offset_pips=float(args.get("offset_pips", 0.0)),
                )

            if name == "close_position":
                return await trader.close_position_by_ticket(
                    u, l, p, s,
                    ticket=int(args["ticket"]),
                    lots=float(args["lots"]) if "lots" in args else None,
                )

            if name == "close_all_positions":
                positions = await trader.get_positions(u, l, p, s, symbol=args.get("symbol"))
                results = []
                for pos in positions:
                    r = await trader.close_position_by_ticket(u, l, p, s, ticket=pos["ticket"])
                    results.append({"ticket": pos["ticket"], **r})
                return results

            # ── Gestione ordini pendenti ───────────────────────────────────
            if name == "cancel_pending_order":
                return await trader.cancel_order_by_ticket(u, l, p, s, ticket=int(args["ticket"]))

            if name == "cancel_all_pending_orders":
                orders = await trader.get_pending_orders_list(u, l, p, s, symbol=args.get("symbol"))
                results = []
                for o in orders:
                    r = await trader.cancel_order_by_ticket(u, l, p, s, ticket=o["ticket"])
                    results.append({"ticket": o["ticket"], **r})
                return results

            if name == "modify_pending_order":
                return await trader.modify_order_by_ticket(
                    u, l, p, s,
                    ticket=int(args["ticket"]),
                    new_price=float(args["new_price"]) if "new_price" in args else None,
                    new_sl=   float(args["new_sl"])    if "new_sl"    in args else None,
                    new_tp=   float(args["new_tp"])    if "new_tp"    in args else None,
                )

            # ── Apertura nuove posizioni/ordini ────────────────────────────
            if name == "open_market_order":
                return await trader.open_new_market_order(
                    u, l, p, s,
                    symbol=     args["symbol"],
                    order_type= args["order_type"],
                    lots=       float(args["lots"]),
                    sl=         float(args["sl"]) if "sl" in args else None,
                    tp=         float(args["tp"]) if "tp" in args else None,
                )

            if name == "place_pending_order":
                return await trader.place_new_pending_order(
                    u, l, p, s,
                    symbol=     args["symbol"],
                    order_type= args["order_type"],
                    price=      float(args["price"]),
                    lots=       float(args["lots"]),
                    sl=         float(args["sl"]) if "sl" in args else None,
                    tp=         float(args["tp"]) if "tp" in args else None,
                )

            # ── Pre-trade decisions ────────────────────────────────────────
            if name == "approve_signal" and decisions is not None:
                idx = int(args["signal_index"])
                decisions[idx] = PreTradeDecision(
                    signal_index=idx,
                    approved=True,
                    reason=str(args.get("reason", "")),
                )
                return {"status": "approved", "signal_index": idx}

            if name == "reject_signal" and decisions is not None:
                idx = int(args["signal_index"])
                decisions[idx] = PreTradeDecision(
                    signal_index=idx,
                    approved=False,
                    reason=str(args.get("reason", "")),
                )
                return {"status": "rejected", "signal_index": idx}

            if name == "modify_signal" and decisions is not None:
                idx = int(args["signal_index"])
                decisions[idx] = PreTradeDecision(
                    signal_index=idx,
                    approved=True,
                    modified_lots=float(args["new_lots"]) if "new_lots" in args else None,
                    modified_sl=  float(args["new_sl"])   if "new_sl"   in args else None,
                    modified_tp=  float(args["new_tp"])   if "new_tp"   in args else None,
                    reason=str(args.get("reason", "")),
                )
                return {"status": "modified", "signal_index": idx}

            return {"error": f"Tool sconosciuto: {name!r}"}

        except Exception as exc:
            logger.error("StrategyExecutor dispatch %s: %s", name, exc, exc_info=True)
            return {"error": str(exc)}


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

def _build_system_prompt(management_strategy: str) -> str:
    return (
        "Sei un assistente professionale per la gestione di posizioni su MetaTrader 5.\n\n"
        "La tua unica responsabilità è eseguire la seguente strategia dell'utente, "
        "né più né meno:\n\n"
        f"STRATEGIA:\n{management_strategy}\n\n"
        "ISTRUZIONI OPERATIVE:\n"
        "- Usa i tool disponibili per raccogliere le informazioni necessarie prima di agire.\n"
        "- Esegui TUTTE le azioni richieste dalla strategia per l'evento corrente.\n"
        "- Non intraprendere azioni non previste dalla strategia.\n"
        "- Se un tool fallisce, segnalalo nel tuo ragionamento e decidi se riprovare o procedere.\n"
        "- Alla fine, fornisci un breve riepilogo in italiano di ciò che hai fatto o deciso.\n"
        "- Sii preciso, metodico e conciso."
    )


def _format_event_prompt(event_type: str, event_data: dict) -> str:
    """Formatta il contesto dell'evento in linguaggio naturale per l'AI."""

    if event_type == "position_closed":
        p       = event_data
        profit  = p.get("profit") or 0
        reason  = p.get("reason", "SCONOSCIUTO")
        outcome = "IN PROFITTO" if profit >= 0 else "IN PERDITA"
        return (
            f"EVENTO: Posizione chiusa.\n\n"
            f"Dettagli:\n"
            f"  Ticket:           #{p.get('ticket')}\n"
            f"  Simbolo:          {p.get('symbol')}\n"
            f"  Direzione:        {p.get('order_type')}\n"
            f"  Prezzo apertura:  {p.get('entry_price')}\n"
            f"  Prezzo chiusura:  {p.get('close_price')}\n"
            f"  Lotti:            {p.get('lots')}\n"
            f"  Profitto:         {profit} {p.get('currency', '')}\n"
            f"  Motivo chiusura:  {reason}  ({outcome})\n"
            f"  Signal group ID:  {p.get('signal_group_id', 'N/D')}\n"
            f"  Ora chiusura:     {p.get('close_time')}\n\n"
            "Esegui la strategia in risposta a questo evento. "
            "Usa get_open_positions per vedere le posizioni ancora aperte."
        )

    if event_type == "position_opened":
        p = event_data
        return (
            f"EVENTO: Nuova posizione aperta.\n\n"
            f"Dettagli:\n"
            f"  Ticket:           #{p.get('ticket')}\n"
            f"  Simbolo:          {p.get('symbol')}\n"
            f"  Direzione:        {p.get('order_type')}\n"
            f"  Prezzo apertura:  {p.get('entry_price')}\n"
            f"  Lotti:            {p.get('lots')}\n"
            f"  Stop Loss:        {p.get('sl')}\n"
            f"  Take Profit:      {p.get('tp')}\n"
            f"  Signal group ID:  {p.get('signal_group_id', 'N/D')}\n\n"
            "Esegui la strategia in risposta a questo evento."
        )

    if event_type == "position_modified":
        p = event_data
        return (
            f"EVENTO: Posizione modificata esternamente.\n\n"
            f"Dettagli:\n"
            f"  Ticket:     #{p.get('ticket')}\n"
            f"  Simbolo:    {p.get('symbol')}\n"
            f"  Vecchio SL: {p.get('old_sl')} → Nuovo SL: {p.get('new_sl')}\n"
            f"  Vecchio TP: {p.get('old_tp')} → Nuovo TP: {p.get('new_tp')}\n\n"
            "Esegui la strategia in risposta a questo evento."
        )

    # Evento generico
    return (
        f"EVENTO: {event_type}\n\n"
        f"Dati evento:\n{json.dumps(event_data, indent=2, default=str)}\n\n"
        "Esegui la strategia in risposta a questo evento."
    )
