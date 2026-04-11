from __future__ import annotations

"""
Wizard di configurazione iniziale (3 step).

Mostrato al primo avvio o quando la configurazione è incompleta.
Chiama on_complete() quando tutti i passi obbligatori sono completati.
"""

import tkinter as tk

from core.group_selector import GroupSelectorDialog
from core.signal_selector import SignalSelectorDialog
from gui.widgets import FlatButton
import core.settings_store as settings_store

# ── Palette ───────────────────────────────────────────────────────────────────
BG     = '#0f1117'
SURF   = '#161b27'
CARD   = '#1e2233'
BORDER = '#2a2f45'
ACCENT = '#7c3aed'
GREEN  = '#10b981'
FG     = '#f1f5f9'
FG2    = '#94a3b8'
FG3    = '#475569'

F    = ('Helvetica Neue', 11)
F_SM = ('Helvetica Neue', 10)
F_XS = ('Helvetica Neue', 9)
F_B  = ('Helvetica Neue', 11, 'bold')
F_XL = ('Helvetica Neue', 22, 'bold')
F_SUB = ('Helvetica Neue', 12)


class SetupView(tk.Frame):
    """
    Frame del wizard di configurazione a 3 step.
    Si ricostruisce ogni volta che cambia lo stato.
    """

    def __init__(self, parent, on_complete, **kwargs):
        super().__init__(parent, bg=BG, **kwargs)
        self._on_complete = on_complete
        self._win = parent   # finestra principale (App) — NON usare _root: è un metodo interno di tkinter

        gid, gname = settings_store.get_group()
        self._group_id     = gid
        self._group_name   = gname or ''
        self._signal_count = len(settings_store.get_signal_examples())

        self._render()

    # ── rendering ─────────────────────────────────────────────────────────────

    def _render(self):
        for w in self.winfo_children():
            w.destroy()

        wrap = tk.Frame(self, bg=BG)
        wrap.place(relx=0.5, rely=0.5, anchor='center')

        # titolo
        tk.Label(wrap, text='Telegram  →  MT5', bg=BG, fg=FG,
                 font=F_XL).pack(anchor='w', pady=(0, 6))
        tk.Label(wrap, text='Prima di iniziare, completa la configurazione',
                 bg=BG, fg=FG2, font=F_SUB).pack(anchor='w', pady=(0, 32))

        # step card 1-2-3
        for n in (1, 2, 3):
            self._build_step_card(wrap, n)

        # footer
        foot = tk.Frame(wrap, bg=BG)
        foot.pack(fill=tk.X, pady=(28, 0))

        ready = self._is_ready()
        FlatButton(
            foot,
            text='Avvia applicazione  →',
            command=self._on_complete,
            bg=ACCENT if ready else CARD,
            fg=FG if ready else FG3,
            hover_bg='#6d28d9' if ready else CARD,
            font=F_B, padx=24, pady=12,
            state='normal' if ready else 'disabled',
        ).pack(side=tk.RIGHT)

        if not ready:
            missing = []
            if not self._group_id:
                missing.append('seleziona un gruppo')
            elif not self._signal_count:
                missing.append('configura almeno un segnale')
            tk.Label(foot, text='  ·  '.join(missing),
                     bg=BG, fg=FG3, font=F_SM,
                     ).pack(side=tk.RIGHT, padx=(0, 16), pady=4)

    def _build_step_card(self, parent, n: int):
        done   = self._step_done(n)
        active = self._step_active(n)

        card = tk.Frame(parent, bg=CARD, padx=20, pady=16)
        card.pack(fill=tk.X, pady=(0, 6))
        card.configure(highlightbackground=BORDER, highlightthickness=1)

        # badge numero/spunta
        badge_bg = GREEN if done else (ACCENT if active else SURF)
        badge_fg = 'white' if (done or active) else FG3
        badge = tk.Label(card, text='✓' if done else str(n),
                         bg=badge_bg, fg=badge_fg,
                         font=('Helvetica Neue', 10, 'bold'),
                         width=2, anchor='center')
        if not done and not active:
            badge.configure(highlightbackground=BORDER, highlightthickness=1)
        badge.pack(side=tk.LEFT, anchor='n', pady=2, padx=(0, 18))

        # titolo + sottotitolo
        mid = tk.Frame(card, bg=CARD)
        mid.pack(side=tk.LEFT, fill=tk.X, expand=True)
        TITLES = ('Autenticazione Telegram', 'Gruppo da monitorare', 'Esempi di segnale')
        tk.Label(mid, text=TITLES[n - 1], bg=CARD, fg=FG, font=F_B).pack(anchor='w')
        tk.Label(mid, text=self._step_subtitle(n), bg=CARD,
                 fg=self._step_sub_fg(n), font=F_SM).pack(anchor='w', pady=(3, 0))

        # azione a destra
        right = tk.Frame(card, bg=CARD)
        right.pack(side=tk.RIGHT, padx=(12, 0))
        self._build_step_action(right, n, done, active)

    def _build_step_action(self, parent, n: int, done: bool, active: bool):
        if n == 1:
            tk.Label(parent, text='✓  Sessione attiva',
                     bg=CARD, fg=GREEN, font=F_SM).pack()
            return

        if n == 2:
            lbl    = 'Cambia  →' if done else 'Seleziona gruppo  →'
            btn_bg = CARD if done else ACCENT
            btn_fg = FG2  if done else 'white'
            kw = dict(highlightbackground=BORDER, highlightthickness=1) if done else {}
            FlatButton(parent, text=lbl, command=self._open_group_selector,
                       bg=btn_bg, fg=btn_fg,
                       font=F_SM, padx=14, pady=8, **kw).pack()
            return

        # n == 3
        if done:
            FlatButton(parent, text='Modifica  →',
                       command=self._open_signal_selector,
                       bg=CARD, fg=FG2, font=F_SM, padx=14, pady=8,
                       highlightbackground=BORDER, highlightthickness=1).pack()
        elif self._group_id:
            FlatButton(parent, text='Configura segnali  →',
                       command=self._open_signal_selector,
                       bg=ACCENT, fg='white', hover_bg='#6d28d9',
                       font=F_SM, padx=14, pady=8).pack()
        else:
            tk.Label(parent, text='Prima configura il gruppo',
                     bg=CARD, fg=FG3, font=F_XS).pack()

    # ── state helpers ─────────────────────────────────────────────────────────

    def _step_done(self, n: int) -> bool:
        if n == 1: return True
        if n == 2: return bool(self._group_id)
        return self._signal_count > 0

    def _step_active(self, n: int) -> bool:
        if n == 2: return not self._group_id
        if n == 3: return bool(self._group_id) and self._signal_count == 0
        return False

    def _step_subtitle(self, n: int) -> str:
        if n == 1: return 'Sessione Telegram attiva'
        if n == 2: return self._group_name if self._group_id else 'Nessun gruppo selezionato'
        if self._signal_count: return f'{self._signal_count} messaggi di esempio salvati'
        return 'Prima seleziona un gruppo' if not self._group_id else 'Indica quali messaggi sono segnali'

    def _step_sub_fg(self, n: int) -> str:
        if n == 1: return GREEN
        if n == 2: return FG2 if self._group_id else FG3
        return FG2 if self._signal_count else FG3

    def _is_ready(self) -> bool:
        return bool(self._group_id) and self._signal_count > 0

    # ── dialog handlers ───────────────────────────────────────────────────────

    def _open_group_selector(self):
        def on_select(gid: int, name: str):
            settings_store.set_group(gid, name)
            self._group_id, self._group_name = gid, name
            self._render()

        GroupSelectorDialog(self._win, on_select=on_select)

    def _open_signal_selector(self):
        if not self._group_id:
            return

        def on_save(examples: list):
            self._signal_count = len(examples)
            self._render()

        SignalSelectorDialog(self._win, group_id=self._group_id,
                             group_name=self._group_name, on_save=on_save)
