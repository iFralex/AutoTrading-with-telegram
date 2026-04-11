from __future__ import annotations

"""
MetaTrader 5 trader.

Wrapper attorno all'API MetaTrader5 per connessione, apertura ordini
e lettura delle posizioni aperte.

Nota: MetaTrader5 è disponibile solo su Windows.
"""

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False

import config


class MT5Trader:
    def __init__(self):
        self.connected = False

    # ── connessione ─────────────────────────────────────────────────────────

    def connect(self) -> tuple[bool, str]:
        if not MT5_AVAILABLE:
            return False, 'Libreria MetaTrader5 non installata (solo Windows)'

        if not mt5.initialize():
            return False, f'initialize() fallito: {mt5.last_error()}'

        if config.MT5_LOGIN:
            ok = mt5.login(config.MT5_LOGIN, password=config.MT5_PASSWORD, server=config.MT5_SERVER)
            if not ok:
                mt5.shutdown()
                return False, f'Login fallito: {mt5.last_error()}'

        info = mt5.account_info()
        if info is None:
            mt5.shutdown()
            return False, 'Impossibile leggere account info'

        self.connected = True
        return True, f'{info.name} | {info.server} | Balance: {info.balance:.2f} {info.currency}'

    def disconnect(self):
        if MT5_AVAILABLE:
            mt5.shutdown()
        self.connected = False

    # ── ordini ──────────────────────────────────────────────────────────────

    def open_buy(self, symbol: str, lot: float, sl: float = 0.0, tp: float = 0.0) -> tuple[bool, str]:
        return self._send_order(symbol, mt5.ORDER_TYPE_BUY, lot, sl, tp)

    def open_sell(self, symbol: str, lot: float, sl: float = 0.0, tp: float = 0.0) -> tuple[bool, str]:
        return self._send_order(symbol, mt5.ORDER_TYPE_SELL, lot, sl, tp)

    def close_position(self, ticket: int) -> tuple[bool, str]:
        if not MT5_AVAILABLE or not self.connected:
            return False, 'Non connesso'

        pos = mt5.positions_get(ticket=ticket)
        if not pos:
            return False, f'Posizione #{ticket} non trovata'

        p = pos[0]
        order_type = mt5.ORDER_TYPE_SELL if p.type == 0 else mt5.ORDER_TYPE_BUY
        tick = mt5.symbol_info_tick(p.symbol)
        price = tick.bid if p.type == 0 else tick.ask

        request = {
            'action':      mt5.TRADE_ACTION_DEAL,
            'symbol':      p.symbol,
            'volume':      p.volume,
            'type':        order_type,
            'position':    ticket,
            'price':       price,
            'deviation':   20,
            'magic':       234000,
            'comment':     'close_telegram_bot',
            'type_time':   mt5.ORDER_TIME_GTC,
            'type_filling': mt5.ORDER_FILLING_IOC,
        }
        result = mt5.order_send(request)
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return False, f'Chiusura fallita: {result.comment}'
        return True, f'Posizione #{ticket} chiusa'

    # ── info ────────────────────────────────────────────────────────────────

    def get_positions(self) -> list[dict]:
        if not MT5_AVAILABLE or not self.connected:
            return []
        positions = mt5.positions_get() or []
        return [
            {
                'ticket':     p.ticket,
                'symbol':     p.symbol,
                'type':       'BUY' if p.type == 0 else 'SELL',
                'volume':     p.volume,
                'price_open': p.price_open,
                'price_cur':  p.price_current,
                'profit':     round(p.profit, 2),
            }
            for p in positions
        ]

    def get_account_summary(self) -> dict | None:
        if not MT5_AVAILABLE or not self.connected:
            return None
        info = mt5.account_info()
        if info is None:
            return None
        return {
            'balance':  info.balance,
            'equity':   info.equity,
            'margin':   info.margin,
            'free':     info.margin_free,
            'currency': info.currency,
        }

    # ── private ─────────────────────────────────────────────────────────────

    def _send_order(self, symbol: str, order_type, lot: float, sl: float, tp: float) -> tuple[bool, str]:
        if not MT5_AVAILABLE or not self.connected:
            return False, 'Non connesso a MT5'

        sym_info = mt5.symbol_info(symbol)
        if sym_info is None:
            return False, f'Simbolo "{symbol}" non trovato'
        if not sym_info.visible:
            mt5.symbol_select(symbol, True)

        tick = mt5.symbol_info_tick(symbol)
        price = tick.ask if order_type == mt5.ORDER_TYPE_BUY else tick.bid

        request = {
            'action':      mt5.TRADE_ACTION_DEAL,
            'symbol':      symbol,
            'volume':      float(lot),
            'type':        order_type,
            'price':       price,
            'sl':          sl,
            'tp':          tp,
            'deviation':   20,
            'magic':       234000,
            'comment':     'telegram_bot',
            'type_time':   mt5.ORDER_TIME_GTC,
            'type_filling': mt5.ORDER_FILLING_IOC,
        }

        result = mt5.order_send(request)
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return False, f'Ordine fallito [{result.retcode}]: {result.comment}'
        return True, f'Ordine aperto: ticket #{result.order} @ {price}'
