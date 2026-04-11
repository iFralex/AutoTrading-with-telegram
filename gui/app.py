from __future__ import annotations

"""
Applicazione principale Telegram → MT5.

Flusso:
  1. Primo avvio / config incompleta  → SetupView (wizard 3 step)
  2. Config completa                  → MainView  (navbar + feed + trading)
"""

import queue
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext

from core.mt5_trader import MT5Trader
from gui.setup_view import SetupView, _config_exists, _session_exists
from gui.widgets import FlatButton
import core.settings_store as settings_store

# ── Palette ───────────────────────────────────────────────────────────────────
BG     = '#0f1117'   # sfondo principale
SURF   = '#161b27'   # navbar, barre
CARD   = '#1e2233'   # card, input
BORDER = '#2a2f45'   # bordi sottili
ACCENT = '#7c3aed'   # viola primario
GREEN  = '#10b981'   # buy / connesso
RED    = '#f43f5e'   # sell / errore
YELLOW = '#f59e0b'   # connessione in corso

FG     = '#f1f5f9'   # testo primario
FG2    = '#94a3b8'   # testo secondario
FG3    = '#475569'   # testo disabilitato

# ── Font (macOS native) ───────────────────────────────────────────────────────
F    = ('Helvetica Neue', 11)
F_SM = ('Helvetica Neue', 10)
F_XS = ('Helvetica Neue', 9)
F_B  = ('Helvetica Neue', 11, 'bold')
F_LG = ('Helvetica Neue', 14, 'bold')
MONO    = ('Menlo', 10)
MONO_SM = ('Menlo', 9)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('Telegram → MT5')
        self.geometry('1240x740')
        self.minsize(900, 600)
        self.configure(bg=BG)

        # stato
        self._group_id, self._group_name = settings_store.get_group()
        self._signal_count = len(settings_store.get_signal_examples())
        self._tg_connected = False

        # servizi
        self._msg_queue: queue.Queue = queue.Queue()
        self._telegram: TelegramListener | None = None
        self._mt5 = MT5Trader()

        if self._needs_setup():
            self._show_setup()
        else:
            self._show_main()

    # ── setup → main ──────────────────────────────────────────────────────────

    def _needs_setup(self) -> bool:
        return (not _config_exists() or not _session_exists()
                or not self._group_id or not self._signal_count)

    def _show_setup(self):
        self.title('Telegram → MT5  ·  Configurazione')
        self._setup_view = SetupView(self, on_complete=self._on_setup_done)
        self._setup_view.pack(fill=tk.BOTH, expand=True)

    def _on_setup_done(self):
        self._group_id, self._group_name = settings_store.get_group()
        self._signal_count = len(settings_store.get_signal_examples())
        self._setup_view.destroy()
        self.title('Telegram → MT5')
        self._show_main()

    # ── build UI principale ───────────────────────────────────────────────────

    def _show_main(self):
        self._build_navbar()
        tk.Frame(self, bg=BORDER, height=1).pack(fill=tk.X)   # divisore
        self._build_content()
        self._poll_messages()

    def _build_navbar(self):
        bar = tk.Frame(self, bg=SURF, height=52)
        bar.pack(fill=tk.X)
        bar.pack_propagate(False)

        # ── logo ──────────────────────────────────────────────────────────────
        tk.Label(bar, text='TG → MT5', bg=SURF, fg=FG,
                 font=F_LG, padx=18).pack(side=tk.LEFT)
        _vbar(bar)

        # ── Telegram ──────────────────────────────────────────────────────────
        tg = tk.Frame(bar, bg=SURF)
        tg.pack(side=tk.LEFT, padx=(12, 2))

        self._tg_dot = tk.Label(tg, text='●', fg=RED, bg=SURF,
                                 font=('Helvetica Neue', 14))
        self._tg_dot.pack(side=tk.LEFT, padx=(0, 6))
        self._tg_lbl = tk.Label(tg, text='Telegram: disconnesso',
                                 fg=FG2, bg=SURF, font=F_SM)
        self._tg_lbl.pack(side=tk.LEFT)

        self._tg_btn = _btn(bar, 'Connetti', self._connect_telegram,
                            bg=ACCENT, fg=FG)
        self._tg_btn.pack(side=tk.LEFT, padx=(6, 2))

        _vbar(bar)

        # ── MT5 ───────────────────────────────────────────────────────────────
        mt5 = tk.Frame(bar, bg=SURF)
        mt5.pack(side=tk.LEFT, padx=(10, 2))

        self._mt5_dot = tk.Label(mt5, text='●', fg=RED, bg=SURF,
                                  font=('Helvetica Neue', 14))
        self._mt5_dot.pack(side=tk.LEFT, padx=(0, 6))
        self._mt5_lbl = tk.Label(mt5, text='MT5: disconnesso',
                                  fg=FG2, bg=SURF, font=F_SM)
        self._mt5_lbl.pack(side=tk.LEFT)

        _btn(bar, 'Connetti MT5', self._connect_mt5,
             bg=CARD, fg=FG2,
             highlight=True).pack(side=tk.LEFT, padx=(6, 0))

        # ── destra: configurazione + utility ──────────────────────────────────
        _btn(bar, '↻  Svuota log', self._clear_log,
             bg=SURF, fg=FG3).pack(side=tk.RIGHT, padx=(0, 14))
        _vbar(bar, side=tk.RIGHT)

        n = self._signal_count
        self._sig_btn = _btn(bar,
                              f'⚡  {n} segnali' if n else '⚡  Segnali',
                              self._open_signal_selector,
                              bg=SURF, fg=FG2 if n else FG3)
        self._sig_btn.pack(side=tk.RIGHT, padx=2)

        short = _trim(self._group_name, 30)
        self._grp_btn = _btn(bar, f'▾  {short}',
                              self._open_group_selector,
                              bg=SURF, fg=FG2)
        self._grp_btn.pack(side=tk.RIGHT, padx=2)
        _vbar(bar, side=tk.RIGHT)

    def _build_content(self):
        paned = tk.PanedWindow(self, orient=tk.HORIZONTAL,
                                bg=BG, sashwidth=6, sashrelief='flat',
                                sashpad=0, handlesize=0)
        paned.pack(fill=tk.BOTH, expand=True)
        self._build_feed_panel(paned)
        self._build_trade_panel(paned)

    # ── feed segnali (sinistra) ───────────────────────────────────────────────

    def _build_feed_panel(self, parent):
        frame = tk.Frame(parent, bg=BG)
        parent.add(frame, minsize=420, width=600)

        # header sezione
        hdr = tk.Frame(frame, bg=BG)
        hdr.pack(fill=tk.X, padx=18, pady=(16, 8))
        tk.Label(hdr, text='Feed segnali', bg=BG, fg=FG,
                 font=F_B).pack(side=tk.LEFT)
        tk.Label(hdr, text='messaggi in tempo reale',
                 bg=BG, fg=FG3, font=F_XS).pack(side=tk.LEFT, padx=(8, 0), pady=2)

        # log messaggi
        self._log = scrolledtext.ScrolledText(
            frame,
            bg=CARD, fg=FG, font=MONO,
            relief='flat', wrap=tk.WORD,
            state=tk.DISABLED, insertbackground=FG,
            padx=16, pady=12,
            selectbackground=ACCENT, selectforeground=FG,
        )
        self._log.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        # tag colori e spaziatura
        self._log.tag_config('meta',
                              foreground=FG3, font=MONO_SM, spacing1=14)
        self._log.tag_config('sender',
                              foreground=ACCENT, font=(MONO[0], MONO[1], 'bold'))
        self._log.tag_config('sep',
                              foreground=BORDER, spacing3=4)
        self._log.tag_config('body',
                              foreground=FG, font=MONO, spacing3=6,
                              lmargin1=0, lmargin2=0)

    # ── pannello trading (destra) ──────────────────────────────────────────────

    def _build_trade_panel(self, parent):
        frame = tk.Frame(parent, bg=BG)
        parent.add(frame, minsize=340)

        self._build_order_section(frame)
        self._build_positions_section(frame)
        self._build_account_section(frame)

    def _build_order_section(self, parent):
        sect = _card(parent)
        sect.pack(fill=tk.X, padx=10, pady=(12, 6))

        _section_header(sect, 'Nuovo ordine')

        # campi
        grid = tk.Frame(sect, bg=CARD, padx=16, pady=6)
        grid.pack(fill=tk.X)
        grid.columnconfigure(1, weight=1)

        FIELDS = [
            ('Simbolo',     'simbolo',     'EURUSD'),
            ('Lotto',       'lotto',       '0.01'),
            ('Stop Loss',   'stop_loss',   '0.0'),
            ('Take Profit', 'take_profit', '0.0'),
        ]
        self._order_vars: dict[str, tk.StringVar] = {}
        for i, (label, key, default) in enumerate(FIELDS):
            tk.Label(grid, text=label, bg=CARD, fg=FG2,
                     font=F_SM, anchor='w').grid(row=i, column=0,
                                                  sticky='w', pady=5)
            var = tk.StringVar(value=default)
            self._order_vars[key] = var
            ent = tk.Entry(grid, textvariable=var,
                           bg=SURF, fg=FG, insertbackground=FG,
                           relief='flat', font=F_SM,
                           highlightbackground=BORDER,
                           highlightthickness=1)
            ent.grid(row=i, column=1, sticky='ew', padx=(10, 0), pady=5)

        # pulsanti buy / sell
        btns = tk.Frame(sect, bg=CARD, padx=16, pady=(6, 16))
        btns.pack(fill=tk.X)
        btns.columnconfigure((0, 1), weight=1)

        FlatButton(btns, text='▲  BUY', command=self._send_buy,
                   bg=GREEN, fg='white', hover_bg='#059669',
                   font=F_B, pady=11,
                   ).grid(row=0, column=0, sticky='ew', padx=(0, 5))

        FlatButton(btns, text='▼  SELL', command=self._send_sell,
                   bg=RED, fg='white', hover_bg='#e11d48',
                   font=F_B, pady=11,
                   ).grid(row=0, column=1, sticky='ew')

    def _build_positions_section(self, parent):
        sect = _card(parent)
        sect.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 6))

        hdr = _section_header(sect, 'Posizioni aperte')
        _btn(hdr, '↻', self._refresh_positions,
             bg=CARD, fg=FG3, pad_x=8).pack(side=tk.RIGHT)

        # stile treeview
        style = ttk.Style()
        style.theme_use('clam')
        style.configure('App.Treeview',
                         background=SURF, foreground=FG,
                         fieldbackground=SURF, rowheight=28,
                         font=MONO_SM, borderwidth=0)
        style.configure('App.Treeview.Heading',
                         background=CARD, foreground=FG2,
                         font=F_XS, relief='flat', padding=6)
        style.map('App.Treeview',
                  background=[('selected', ACCENT)],
                  foreground=[('selected', FG)])

        cols = ('Simbolo', 'Tipo', 'Lotti', 'Aperto @', 'P&L')
        widths = [72, 48, 48, 82, 70]

        tree_wrap = tk.Frame(sect, bg=CARD, padx=10, pady=0)
        tree_wrap.pack(fill=tk.BOTH, expand=True)

        sb = ttk.Scrollbar(tree_wrap, orient=tk.VERTICAL)
        self._tree = ttk.Treeview(tree_wrap, columns=cols, show='headings',
                                   style='App.Treeview', height=5,
                                   yscrollcommand=sb.set)
        sb.config(command=self._tree.yview)

        for col, w in zip(cols, widths):
            self._tree.heading(col, text=col)
            self._tree.column(col, width=w, anchor='center', minwidth=w)

        self._tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sb.pack(side=tk.RIGHT, fill=tk.Y)

        FlatButton(sect, text='Chiudi posizione selezionata',
                   command=self._close_selected,
                   bg=CARD, fg=FG3, font=F_SM, pady=9,
                   highlightbackground=BORDER, highlightthickness=1,
                   ).pack(fill=tk.X, padx=10, pady=(4, 10))

    def _build_account_section(self, parent):
        sect = _card(parent)
        sect.pack(fill=tk.X, padx=10, pady=(0, 10))

        _section_header(sect, 'Account')

        metrics_row = tk.Frame(sect, bg=CARD, padx=16, pady=(0, 16))
        metrics_row.pack(fill=tk.X)
        metrics_row.columnconfigure((0, 1, 2), weight=1)

        METRICS = [('Balance', 'balance'), ('Equity', 'equity'), ('Margine libero', 'free')]
        self._acc_vars: dict[str, tk.StringVar] = {}

        for col, (label, key) in enumerate(METRICS):
            cell = tk.Frame(metrics_row, bg=CARD)
            cell.grid(row=0, column=col, sticky='w',
                      padx=(0 if col == 0 else 16, 0))
            tk.Label(cell, text=label, bg=CARD, fg=FG3,
                     font=F_XS).pack(anchor='w')
            var = tk.StringVar(value='—')
            self._acc_vars[key] = var
            tk.Label(cell, textvariable=var, bg=CARD, fg=FG,
                     font=F_B).pack(anchor='w', pady=(3, 0))

    # ── Telegram ─────────────────────────────────────────────────────────────

    def _connect_telegram(self):
        if not self._group_id:
            self._open_group_selector(connect_after=True)
            return
        self._tg_lbl.config(text='Telegram: connessione…', fg=YELLOW)
        self._tg_dot.config(fg=YELLOW)
        self._tg_btn.config(state='disabled', text='…')
        self._start_listener()

    def _open_group_selector(self, connect_after: bool = False):
        from core.group_selector import GroupSelectorDialog
        was_connected = self._tg_connected

        def on_select(gid: int, name: str):
            settings_store.set_group(gid, name)
            self._group_id, self._group_name = gid, name
            self._grp_btn.config(text=f'▾  {_trim(name, 30)}', fg=FG2)
            if was_connected or connect_after:
                if self._telegram:
                    self._telegram.stop()
                    self._telegram = None
                self._tg_lbl.config(text='Telegram: connessione…', fg=YELLOW)
                self._tg_dot.config(fg=YELLOW)
                self.after(1200, self._start_listener)

        GroupSelectorDialog(self, on_select=on_select)

    def _open_signal_selector(self):
        from core.signal_selector import SignalSelectorDialog
        if not self._group_id:
            messagebox.showwarning('Gruppo mancante',
                                   'Seleziona prima un gruppo Telegram.')
            return

        def on_save(examples: list):
            self._signal_count = len(examples)
            n = self._signal_count
            self._sig_btn.config(
                text=f'⚡  {n} segnali' if n else '⚡  Segnali',
                fg=FG2 if n else FG3)

        SignalSelectorDialog(self, group_id=self._group_id,
                             group_name=self._group_name, on_save=on_save)

    def _start_listener(self):
        from core.telegram_listener import TelegramListener
        self._telegram = TelegramListener(
            self._msg_queue, self._group_id, self._on_tg_status)
        self._telegram.start()

    def _on_tg_status(self, connected: bool, info: str):
        self.after(0, lambda: self._apply_tg_status(connected, info))

    def _apply_tg_status(self, connected: bool, info: str):
        self._tg_connected = connected
        if connected:
            self._tg_dot.config(fg=GREEN)
            self._tg_lbl.config(text=f'Telegram: {info}', fg=FG)
            self._tg_btn.config(state='normal', text='Connetti',
                                 bg=CARD, fg=FG3)
        else:
            self._tg_dot.config(fg=RED)
            self._tg_lbl.config(text=f'Telegram: {info}', fg=RED)
            self._tg_btn.config(state='normal', text='Connetti',
                                 bg=ACCENT, fg=FG)

    # ── messaggi ─────────────────────────────────────────────────────────────

    def _poll_messages(self):
        try:
            while True:
                self._append_message(self._msg_queue.get_nowait())
        except queue.Empty:
            pass
        self.after(100, self._poll_messages)

    def _append_message(self, msg: dict):
        self._log.config(state=tk.NORMAL)
        self._log.insert(tk.END, f"\n{msg['date']}   ", 'meta')
        self._log.insert(tk.END, msg['sender'], 'sender')
        self._log.insert(tk.END, '\n' + '─' * 54 + '\n', 'sep')
        self._log.insert(tk.END, msg['text'] + '\n', 'body')
        self._log.config(state=tk.DISABLED)
        self._log.see(tk.END)

    def _clear_log(self):
        self._log.config(state=tk.NORMAL)
        self._log.delete('1.0', tk.END)
        self._log.config(state=tk.DISABLED)

    # ── MT5 ──────────────────────────────────────────────────────────────────

    def _connect_mt5(self):
        ok, msg = self._mt5.connect()
        if ok:
            self._mt5_dot.config(fg=GREEN)
            self._mt5_lbl.config(text=f'MT5: {msg}', fg=FG)
            self._refresh_positions()
        else:
            self._mt5_dot.config(fg=RED)
            self._mt5_lbl.config(text=f'MT5: {msg}', fg=RED)
            messagebox.showerror('MT5', msg)

    def _send_buy(self):  self._send_order('buy')
    def _send_sell(self): self._send_order('sell')

    def _send_order(self, direction: str):
        if not self._mt5.connected:
            messagebox.showwarning('MT5', 'Connettiti prima a MetaTrader 5')
            return
        try:
            symbol = self._order_vars['simbolo'].get().strip().upper()
            lot    = float(self._order_vars['lotto'].get())
            sl     = float(self._order_vars['stop_loss'].get())
            tp     = float(self._order_vars['take_profit'].get())
        except ValueError:
            messagebox.showerror('Input', 'Controlla i valori inseriti')
            return
        fn = self._mt5.open_buy if direction == 'buy' else self._mt5.open_sell
        ok, msg = fn(symbol, lot, sl, tp)
        if ok:
            messagebox.showinfo('Ordine', msg)
            self._refresh_positions()
        else:
            messagebox.showerror('Ordine fallito', msg)

    def _refresh_positions(self):
        for row in self._tree.get_children():
            self._tree.delete(row)
        for p in self._mt5.get_positions():
            tag = 'profit' if p['profit'] >= 0 else 'loss'
            self._tree.insert(
                '', tk.END, iid=str(p['ticket']), tags=(tag,),
                values=(p['symbol'], p['type'], p['volume'],
                        p['price_open'], f"{p['profit']:+.2f}"))
        self._tree.tag_configure('profit', foreground=GREEN)
        self._tree.tag_configure('loss',   foreground=RED)

        acc = self._mt5.get_account_summary()
        if acc:
            cur = acc['currency']
            self._acc_vars['balance'].set(f"{acc['balance']:,.2f} {cur}")
            self._acc_vars['equity'].set(f"{acc['equity']:,.2f} {cur}")
            self._acc_vars['free'].set(f"{acc['free']:,.2f} {cur}")

    def _close_selected(self):
        sel = self._tree.selection()
        if not sel:
            messagebox.showinfo('Info', 'Seleziona una posizione dalla tabella')
            return
        ticket = int(sel[0])
        ok, msg = self._mt5.close_position(ticket)
        if ok:
            messagebox.showinfo('Chiusura', msg)
            self._refresh_positions()
        else:
            messagebox.showerror('Errore', msg)

    # ── quit ─────────────────────────────────────────────────────────────────

    def on_close(self):
        if self._telegram:
            self._telegram.stop()
        self._mt5.disconnect()
        self.destroy()


# ── Widget helpers ────────────────────────────────────────────────────────────

def _vbar(parent, side=tk.LEFT):
    """Barra verticale separatrice."""
    tk.Frame(parent, bg=BORDER, width=1).pack(
        side=side, fill=tk.Y, pady=10, padx=6)


def _btn(parent, text: str, command, bg=CARD, fg=FG2,
         highlight=False, pad_x=12) -> FlatButton:
    """Pulsante flat con stile coerente (FlatButton per compatibilità macOS)."""
    kw = dict(highlightbackground=BORDER, highlightthickness=1) if highlight else {}
    return FlatButton(parent, text=text, command=command,
                      bg=bg, fg=fg, font=F_SM,
                      padx=pad_x, pady=5, **kw)


def _card(parent) -> tk.Frame:
    """Frame con sfondo CARD e bordo sottile."""
    f = tk.Frame(parent, bg=CARD)
    f.configure(highlightbackground=BORDER, highlightthickness=1)
    return f


def _section_header(parent, title: str) -> tk.Frame:
    """Riga header di sezione con titolo e linea separatrice."""
    row = tk.Frame(parent, bg=CARD, padx=16, pady=12)
    row.pack(fill=tk.X)
    tk.Label(row, text=title, bg=CARD, fg=FG, font=F_B).pack(side=tk.LEFT)
    tk.Frame(row, bg=BORDER, height=1).pack(
        side=tk.LEFT, fill=tk.X, expand=True, padx=(10, 0), pady=6)
    return row


def _trim(text: str, maxlen: int) -> str:
    return text[:maxlen] + ('…' if len(text) > maxlen else '')
