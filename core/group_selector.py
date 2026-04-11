from __future__ import annotations

"""
Dialog modale per selezionare un gruppo/canale Telegram.

Uso:
    GroupSelectorDialog(parent, on_select=callback, on_cancel=callback)

    on_select viene chiamato con (group_id: int, group_name: str).
"""

import asyncio
import selectors
import threading
import tkinter as tk

from gui.widgets import FlatButton

# ── palette (speculare a gui/app.py) ──────────────────────────────────────────
_BG     = '#0f1117'
_PANEL  = '#1e2233'
_ACCENT = '#7c3aed'
_GREEN  = '#10b981'
_RED    = '#f43f5e'
_FG     = '#f1f5f9'
_FG_DIM = '#94a3b8'
_BORDER = '#2a2f45'
_FONT    = ('Helvetica Neue', 11)
_FONT_SM = ('Helvetica Neue', 10)
_FONT_B  = ('Helvetica Neue', 11, 'bold')


class GroupSelectorDialog(tk.Toplevel):
    """Finestra modale con lista gruppi/canali Telegram."""

    def __init__(self, parent, on_select, on_cancel=None):
        super().__init__(parent)
        self.title('Seleziona gruppo Telegram')
        self.geometry('500x520')
        self.configure(bg=_BG)
        self.resizable(True, True)
        self.transient(parent)
        self.grab_set()
        self.protocol('WM_DELETE_WINDOW', self._cancel)

        self._on_select = on_select
        self._on_cancel = on_cancel or (lambda: None)
        self._groups: list[tuple[int, str]] = []
        self._filtered: list[tuple[int, str]] = []

        self._build_ui()
        self._fetch_groups()

    # ── UI ────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        tk.Label(self, text='Gruppi e canali disponibili', bg=_BG, fg=_FG, font=_FONT_B
                 ).pack(anchor='w', padx=14, pady=(12, 2))

        # barra di ricerca
        search_frame = tk.Frame(self, bg=_BG)
        search_frame.pack(fill=tk.X, padx=14, pady=(4, 6))
        tk.Label(search_frame, text='Cerca:', bg=_BG, fg=_FG_DIM, font=_FONT_SM).pack(side=tk.LEFT)
        self._search_var = tk.StringVar()
        self._search_var.trace_add('write', lambda *_: self._apply_filter())
        tk.Entry(
            search_frame, textvariable=self._search_var,
            bg=_PANEL, fg=_FG, insertbackground=_FG, relief='flat', font=_FONT,
        ).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(8, 0))

        # listbox + scrollbar
        list_frame = tk.Frame(self, bg=_BG)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=14, pady=(0, 6))
        sb = tk.Scrollbar(list_frame, orient=tk.VERTICAL, bg=_PANEL, troughcolor=_BG)
        self._listbox = tk.Listbox(
            list_frame, yscrollcommand=sb.set,
            bg=_PANEL, fg=_FG, selectbackground=_ACCENT, selectforeground='white',
            relief='flat', font=_FONT, activestyle='none', borderwidth=0,
            highlightthickness=1, highlightbackground=_BORDER,
        )
        sb.config(command=self._listbox.yview)
        self._listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self._listbox.bind('<Double-Button-1>', lambda _e: self._confirm())

        # label di stato
        self._status_lbl = tk.Label(self, text='Connessione in corso…',
                                    bg=_BG, fg=_FG_DIM, font=_FONT_SM)
        self._status_lbl.pack(anchor='w', padx=14, pady=(0, 4))

        # pulsanti
        btn_row = tk.Frame(self, bg=_BG)
        btn_row.pack(fill=tk.X, padx=14, pady=(0, 14))
        FlatButton(
            btn_row, text='Annulla', command=self._cancel,
            bg=_PANEL, fg=_FG_DIM, font=_FONT_SM,
            padx=12, pady=7,
            highlightbackground=_BORDER, highlightthickness=1,
        ).pack(side=tk.RIGHT, padx=(6, 0))
        FlatButton(
            btn_row, text='Seleziona', command=self._confirm,
            bg=_ACCENT, fg='white', hover_bg='#6d28d9',
            font=_FONT_SM, padx=12, pady=7,
        ).pack(side=tk.RIGHT)

    # ── fetch asincrono ───────────────────────────────────────────────────────

    def _fetch_groups(self):
        def run():
            loop = asyncio.SelectorEventLoop(selectors.SelectSelector())
            asyncio.set_event_loop(loop)
            try:
                groups = loop.run_until_complete(self._async_fetch())
                self.after(0, lambda: self._populate(groups))
            except Exception as exc:
                self.after(0, lambda e=exc: self._status_lbl.config(
                    text=f'Errore: {e}', fg=_RED))
            finally:
                loop.close()

        threading.Thread(target=run, daemon=True, name='GroupFetcher').start()

    async def _async_fetch(self):
        import config
        from telethon import TelegramClient
        from telethon.tl.types import Channel, Chat

        client = TelegramClient(
            config.TELEGRAM_SESSION,
            config.TELEGRAM_API_ID,
            config.TELEGRAM_API_HASH,
        )
        await client.start()
        groups = []
        async for dialog in client.iter_dialogs():
            entity = dialog.entity
            if isinstance(entity, (Channel, Chat)):
                groups.append((dialog.id, dialog.name or '(senza nome)'))
        await client.disconnect()
        return groups

    # ── logica lista ──────────────────────────────────────────────────────────

    def _populate(self, groups: list[tuple[int, str]]):
        self._groups = sorted(groups, key=lambda g: g[1].casefold())
        self._apply_filter()
        count = len(groups)
        self._status_lbl.config(
            text=f'{count} gruppi/canali trovati — doppio clic per selezionare',
            fg=_FG_DIM,
        )

    def _apply_filter(self):
        term = self._search_var.get().casefold()
        self._filtered = [(gid, name) for gid, name in self._groups if term in name.casefold()]
        self._listbox.delete(0, tk.END)
        for _, name in self._filtered:
            self._listbox.insert(tk.END, f'  {name}')

    # ── azioni ────────────────────────────────────────────────────────────────

    def _confirm(self):
        idx = self._listbox.curselection()
        if not idx:
            return
        gid, name = self._filtered[idx[0]]
        self._on_select(gid, name)
        self.destroy()

    def _cancel(self):
        self._on_cancel()
        self.destroy()
