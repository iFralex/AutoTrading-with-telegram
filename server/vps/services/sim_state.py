"""
sim_state.py — Shared simulation utilities for stateful AI walk-forward.

Extracted from server/vps/api/routes/setup.py so that both:
  - setup.py (interactive /api/setup/simulate-full)
  - backtest_engine.py (batch backtesting)
can fire real AI events against a mutable _SimState.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


# ── P&L helper ────────────────────────────────────────────────────────────────

def _contract_size(symbol: str, symbol_specs: dict | None = None) -> float:
    if symbol_specs and "contract_size" in symbol_specs:
        return float(symbol_specs["contract_size"])
    sym = symbol.upper()
    if "XAU" in sym:
        return 100.0
    if "XAG" in sym:
        return 5000.0
    if "BTC" in sym or "ETH" in sym:
        return 1.0
    return 100_000.0


def _calc_pnl(order_type: str, open_price: float, close_price: float, lot: float,
              symbol: str = "", symbol_specs: dict | None = None) -> float:
    diff = (close_price - open_price) if order_type == "BUY" else (open_price - close_price)
    return diff * lot * _contract_size(symbol, symbol_specs)


# ── _SimState ─────────────────────────────────────────────────────────────────

class _SimState:
    """Mutable account state for the full stateful walk-forward simulation."""

    def __init__(self, mock_state: dict) -> None:
        self.balance      = float(mock_state.get("balance",     10_000))
        self.equity       = float(mock_state.get("equity",      self.balance))
        self.free_margin  = float(mock_state.get("free_margin", self.equity))
        self.leverage     = int(mock_state.get("leverage",   100))
        self.currency     = str(mock_state.get("currency",  "USD"))
        self._daily_pnl   = float(mock_state.get("daily_pnl",   0))
        self._weekly_pnl  = float(mock_state.get("weekly_pnl",  0))
        self._monthly_pnl = float(mock_state.get("monthly_pnl", 0))
        self.open_positions: list[dict] = list(mock_state.get("open_positions",  []))
        self.pending_orders: list[dict] = list(mock_state.get("pending_orders",  []))
        self.prices: dict[str, dict]    = dict(mock_state.get("prices", {}))
        self._next_ticket               = 1000
        # Partial closes recorded by apply_write; consumed and cleared in walk-forward
        self.partial_closes: list[dict] = []

    def alloc_ticket(self) -> int:
        t = self._next_ticket
        self._next_ticket += 1
        return t

    def add_position(self, ticket: int, symbol: str, order_type: str, lots: float,
                     open_price: float, sl: float | None, tp: float | None) -> None:
        self.open_positions.append({
            "ticket": ticket, "symbol": symbol, "order_type": order_type,
            "lots": lots, "open_price": open_price, "sl": sl, "tp": tp, "profit": 0,
        })

    def get_position(self, ticket: int) -> dict | None:
        for p in self.open_positions:
            if p.get("ticket") == ticket:
                return p
        return None

    def remove_position(self, ticket: int) -> dict | None:
        for i, p in enumerate(self.open_positions):
            if p.get("ticket") == ticket:
                return self.open_positions.pop(i)
        return None

    def remove_pending_order(self, ticket: int) -> dict | None:
        for i, o in enumerate(self.pending_orders):
            if o.get("ticket") == ticket:
                return self.pending_orders.pop(i)
        return None

    def update_price(self, symbol: str, price: float) -> None:
        sym = symbol.upper()
        entry = self.prices.setdefault(sym, {})
        entry.update({"bid": price, "ask": price, "last": price})

    def apply_write(self, tool: str, kwargs: dict) -> None:
        if tool == "open_market_order":
            sym = str(kwargs.get("symbol", "")).upper()
            current_price = self.prices.get(sym, {}).get("bid", 0.0)
            ticket = self.alloc_ticket()
            self.add_position(
                ticket=ticket,
                symbol=kwargs.get("symbol", ""),
                order_type=kwargs.get("order_type", "BUY"),
                lots=float(kwargs.get("lots", 0.01)),
                open_price=current_price,
                sl=kwargs.get("sl"),
                tp=kwargs.get("tp"),
            )
        elif tool == "place_pending_order":
            ticket = self.alloc_ticket()
            self.pending_orders.append({
                "ticket": ticket,
                "symbol": kwargs.get("symbol", ""),
                "order_type": kwargs.get("order_type", "BUY_LIMIT"),
                "lots": float(kwargs.get("lots", 0.01)),
                "price": float(kwargs.get("price", 0)),
                "sl": kwargs.get("sl"),
                "tp": kwargs.get("tp"),
            })
        elif tool == "close_position":
            ticket = int(kwargs.get("ticket", 0))
            requested_lots = kwargs.get("lots")
            pos = self.get_position(ticket)
            if pos:
                current_lots = float(pos.get("lots", 0))
                if requested_lots is not None:
                    remaining = round(current_lots - float(requested_lots), 5)
                    if remaining > 0.001:
                        # Genuine partial close — reduce lots, keep position alive
                        self.partial_closes.append({
                            "ticket": ticket, "lots_closed": float(requested_lots),
                        })
                        pos["lots"] = remaining
                    else:
                        self.remove_position(ticket)
                else:
                    self.remove_position(ticket)
        elif tool == "cancel_order":
            self.remove_pending_order(int(kwargs.get("ticket", 0)))
        elif tool == "modify_position":
            pos = self.get_position(int(kwargs.get("ticket", 0)))
            if pos:
                if kwargs.get("new_sl") is not None:
                    pos["sl"] = kwargs["new_sl"]
                if kwargs.get("new_tp") is not None:
                    pos["tp"] = kwargs["new_tp"]
        elif tool == "set_breakeven":
            pos = self.get_position(int(kwargs.get("ticket", 0)))
            if pos:
                offset_pips = float(kwargs.get("offset_pips", 0))
                pip_size = 0.0001  # simplified
                open_price = float(pos.get("open_price", pos.get("entry_price", 0)))
                if pos.get("order_type") == "BUY":
                    pos["sl"] = open_price + offset_pips * pip_size
                else:
                    pos["sl"] = open_price - offset_pips * pip_size


# ── MockMT5Trader ─────────────────────────────────────────────────────────────

class MockMT5Trader:
    """
    Drop-in replacement for MT5Trader used in simulations.

    READ methods return data derived from mock_state.
    WRITE methods record the action in actions_log and return a simulated-ok dict,
    so the real StrategyExecutor._dispatch() logic (including calculate_lot_for_risk)
    runs unchanged while no real MT5 order is ever sent.
    """

    _PRICE_DEFAULTS: dict[str, dict] = {
        "XAUUSD": {"bid": 2340.00, "ask": 2340.50, "spread_pips": 0.5,  "last": 2340.25},
        "XAGUSD": {"bid":   29.50, "ask":   29.51,  "spread_pips": 0.1,  "last":   29.50},
        "EURUSD": {"bid":   1.085, "ask":   1.0851, "spread_pips": 0.1,  "last":   1.085},
        "GBPUSD": {"bid":  1.2650, "ask":   1.2651, "spread_pips": 0.1,  "last":  1.2650},
        "USDJPY": {"bid": 149.50,  "ask":  149.51,  "spread_pips": 0.1,  "last": 149.50},
        "BTCUSD": {"bid": 65000.0, "ask": 65010.0,  "spread_pips": 10.0, "last": 65005.0},
        "ETHUSD": {"bid":  3500.0, "ask":  3502.0,  "spread_pips": 2.0,  "last":  3501.0},
    }

    _SPEC_DEFAULTS: dict[str, dict] = {
        "XAU": {"pip_value_per_lot": 10.0,  "contract_size":  100, "digits": 2,
                "volume_min": 0.01, "volume_max":  50.0, "volume_step": 0.01, "currency_profit": "USD"},
        "XAG": {"pip_value_per_lot": 50.0,  "contract_size": 5000, "digits": 3,
                "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "currency_profit": "USD"},
        "BTC": {"pip_value_per_lot":  1.0,  "contract_size":    1, "digits": 2,
                "volume_min": 0.01, "volume_max":  10.0, "volume_step": 0.01, "currency_profit": "USD"},
        "ETH": {"pip_value_per_lot":  1.0,  "contract_size":    1, "digits": 2,
                "volume_min": 0.01, "volume_max":  50.0, "volume_step": 0.01, "currency_profit": "USD"},
    }
    _SPEC_FOREX = {"pip_value_per_lot": 10.0, "contract_size": 100_000, "digits": 5,
                   "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "currency_profit": "USD"}

    def __init__(self, mock_state: dict, actions_log: list[dict]) -> None:
        self._ms      = mock_state
        self._actions = actions_log
        self._balance     = float(mock_state.get("balance",     10_000))
        self._equity      = float(mock_state.get("equity",      self._balance))
        self._free_margin = float(mock_state.get("free_margin", self._equity))
        self._currency    = str(mock_state.get("currency",  "USD"))
        self._leverage    = int(mock_state.get("leverage",   100))
        self._open_pos    = list(mock_state.get("open_positions",  []))
        self._pending_ord = list(mock_state.get("pending_orders",  []))
        self._daily_pnl   = float(mock_state.get("daily_pnl",   0))
        self._weekly_pnl  = float(mock_state.get("weekly_pnl",  0))
        self._monthly_pnl = float(mock_state.get("monthly_pnl", 0))
        self._prices      = dict(mock_state.get("prices", {}))

    def _rec(self, tool: str, **kwargs) -> dict:
        entry = {"tool": tool, **{k: v for k, v in kwargs.items() if v is not None}}
        self._actions.append(entry)
        return {"ok": True, "simulated": True}

    # ── READ methods ──────────────────────────────────────────────────────────

    async def get_full_account_info(self, user_id, login, password, server):
        return {
            "balance":         self._balance,
            "equity":          self._equity,
            "margin":          self._balance - self._free_margin,
            "free_margin":     self._free_margin,
            "profit_floating": self._equity - self._balance,
            "leverage":        self._leverage,
            "currency":        self._currency,
            "login":           login or 0,
            "server":          self._ms.get("server", "SimBroker-Demo"),
        }

    async def get_pnl_for_period(self, user_id, login, password, server, from_, to):
        from datetime import datetime, timezone
        now   = datetime.now(timezone.utc)
        delta = now - from_
        if delta.total_seconds() <= 86_400:
            return self._daily_pnl
        if delta.total_seconds() <= 7 * 86_400:
            return self._weekly_pnl
        return self._monthly_pnl

    async def get_symbol_tick(self, user_id, login, password, server, symbol: str):
        sym = symbol.upper()
        if sym in self._prices:
            p = self._prices[sym]
            bid = float(p.get("bid", 0))
            ask = float(p.get("ask", bid))
            spread = float(p.get("spread_pips", abs(ask - bid) * 10))
            return {"bid": bid, "ask": ask, "spread_pips": spread, "last": bid}
        default = self._PRICE_DEFAULTS.get(sym)
        if default:
            return dict(default)
        return {"bid": 1.0, "ask": 1.0001, "spread_pips": 0.1, "last": 1.0}

    async def get_symbol_specs(self, user_id, login, password, server, symbol: str):
        sym = symbol.upper()
        for prefix, specs in self._SPEC_DEFAULTS.items():
            if prefix in sym:
                return dict(specs)
        return dict(self._SPEC_FOREX)

    async def get_positions(self, user_id, login, password, server, symbol=None):
        if symbol:
            return [p for p in self._open_pos if str(p.get("symbol", "")).upper() == symbol.upper()]
        return list(self._open_pos)

    async def get_pending_orders_list(self, user_id, login, password, server, symbol=None):
        if symbol:
            return [o for o in self._pending_ord if str(o.get("symbol", "")).upper() == symbol.upper()]
        return list(self._pending_ord)

    async def get_closed_deals(self, user_id, login, password, server, days=1, symbol=None):
        return []

    # ── WRITE methods (record action, return simulated-ok) ────────────────────

    async def modify_position(self, user_id, login, password, server, ticket, new_sl=None, new_tp=None):
        return self._rec("modify_position", ticket=ticket, new_sl=new_sl, new_tp=new_tp)

    async def set_breakeven(self, user_id, login, password, server, ticket, offset_pips=0.0):
        return self._rec("set_breakeven", ticket=ticket, offset_pips=offset_pips)

    async def close_position_by_ticket(self, user_id, login, password, server, ticket, lots=None):
        return self._rec("close_position", ticket=ticket, lots=lots)

    async def cancel_order_by_ticket(self, user_id, login, password, server, ticket):
        return self._rec("cancel_order", ticket=ticket)

    async def modify_order_by_ticket(self, user_id, login, password, server, ticket,
                                     new_price=None, new_sl=None, new_tp=None):
        return self._rec("modify_order", ticket=ticket, new_price=new_price, new_sl=new_sl, new_tp=new_tp)

    async def open_new_market_order(self, user_id, login, password, server,
                                    symbol, order_type, lots, sl=None, tp=None):
        return self._rec("open_market_order", symbol=symbol, order_type=order_type, lots=lots, sl=sl, tp=tp)

    async def place_new_pending_order(self, user_id, login, password, server,
                                      symbol, order_type, price, lots, sl=None, tp=None):
        return self._rec("place_pending_order", symbol=symbol, order_type=order_type,
                         price=price, lots=lots, sl=sl, tp=tp)


# ── StatefulMockMT5Trader ─────────────────────────────────────────────────────

class StatefulMockMT5Trader(MockMT5Trader):
    """Like MockMT5Trader but backed by _SimState — mutates state on every write call."""

    def __init__(self, state: _SimState, actions_log: list[dict]) -> None:
        self._state       = state
        self._actions     = actions_log
        # Point mutable fields at the exact same objects in state (shared by reference)
        self._open_pos    = state.open_positions
        self._pending_ord = state.pending_orders
        self._prices      = state.prices
        # Scalar fields — copy current values
        self._balance     = state.balance
        self._equity      = state.equity
        self._free_margin = state.free_margin
        self._currency    = state.currency
        self._leverage    = state.leverage
        self._daily_pnl   = state._daily_pnl
        self._weekly_pnl  = state._weekly_pnl
        self._monthly_pnl = state._monthly_pnl
        self._ms          = {}  # unused; satisfies parent references

    def _rec(self, tool: str, **kwargs) -> dict:
        self._state.apply_write(tool, kwargs)
        entry = {"tool": tool, **{k: v for k, v in kwargs.items() if v is not None}}
        self._actions.append(entry)
        return {"ok": True, "simulated": True}


# ── fire_ai_event ─────────────────────────────────────────────────────────────

async def fire_ai_event(
    gemini_client,           # google.genai.Client instance
    strategy_executor,       # StrategyExecutor instance (for _dispatch)
    state: _SimState,
    event_type: str,
    event_data: dict,
    management_strategy: str,
    deletion_strategy: str = "",
) -> dict:
    """
    Fire a single AI event against the current _SimState.
    StatefulMockMT5Trader mutates `state` when the AI issues write calls.
    Returns {tool_calls, actions, final_response}.
    """
    from google.genai import types as _types
    from vps.services.strategy_executor import (
        _ExecCtx, PreTradeDecision,
        _build_system_prompt, _format_event_prompt, _make_tools, _compact, _PRO_MODEL,
    )

    strategy = deletion_strategy if event_type == "message_deleted" else management_strategy
    if not strategy:
        return {"tool_calls": [], "actions": [], "final_response": ""}

    actions_log: list[dict] = []
    trader  = StatefulMockMT5Trader(state, actions_log)
    ctx     = _ExecCtx(trader, "sim", 0, "", "sim")
    decisions: dict[int, PreTradeDecision] = {}

    event_prompt = _format_event_prompt(event_type, event_data)
    open_pos = state.open_positions
    if open_pos:
        pos_parts = [
            f"#{p.get('ticket','?')} {p.get('order_type')} {p.get('symbol')}"
            f" lots={p.get('lots')} profit={p.get('profit', 0)}"
            for p in open_pos
        ]
        event_prompt += (
            "\n\nPre-fetched context:\n"
            f"  open_positions ({len(open_pos)}): " + " | ".join(pos_parts)
        )

    system_prompt = _build_system_prompt(strategy)
    tools  = _make_tools(event_type)
    config = _types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=tools,  # type: ignore[arg-type]
    )
    chat = gemini_client.aio.chats.create(model=_PRO_MODEL, config=config)

    try:
        response = await chat.send_message(event_prompt)
    except Exception as exc:
        logger.warning("fire_ai_event (%s): %s", event_type, exc)
        return {"tool_calls": [], "actions": [], "final_response": f"Error: {exc}"}

    tool_calls_log: list[dict] = []
    final_text = ""

    for _ in range(8):
        fn_calls = response.function_calls or []
        if not fn_calls:
            final_text = (response.text or "").strip()
            break
        fn_parts = []
        for fc in fn_calls:
            name = fc.name
            args = dict(fc.args)
            result_data = await strategy_executor._dispatch(name, args, ctx, decisions)
            tool_calls_log.append({"name": name, "args": args, "result": result_data})
            fn_parts.append(_types.Part.from_function_response(
                name=name,
                response={"result": json.dumps(_compact(result_data), separators=(",", ":"), default=str)},
            ))
        try:
            response = await chat.send_message(fn_parts)
        except Exception:
            break

    return {"tool_calls": tool_calls_log, "actions": actions_log, "final_response": final_text}
