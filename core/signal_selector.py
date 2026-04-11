from __future__ import annotations

"""
Dialog per selezionare i messaggi che contengono segnali di trading.

Recupera gli ultimi 50 messaggi del gruppo selezionato tramite Telethon,
li mostra in una lista scrollabile con checkbox. L'utente seleziona solo
quelli che sono veri segnali; al salvataggio vengono scritti in settings.json.
"""

import asyncio
import selectors
import threading
import tkinter as tk

import config
import core.settings_store as settings_store
from gui.widgets import FlatButton

# ── palette ───────────────────────────────────────────────────────────────────
_BG      = '#0f1117'
_PANEL   = '#1e2233'
_ROW_ALT = '#161b27'
_ACCENT  = '#7c3aed'
_GREEN   = '#10b981'
_RED     = '#f43f5e'
_SEP     = '#2a2f45'
_FG      = '#f1f5f9'
_FG_DIM  = '#94a3b8'
_FG3     = '#475569'
_FONT    = ('Helvetica Neue', 11)
_FONT_SM = ('Helvetica Neue', 10)
_FONT_B  = ('Helvetica Neue', 11, 'bold')
_MONO    = ('Menlo', 10)


class SignalSelectorDialog(tk.Toplevel):
    """
    Finestra modale: mostra gli ultimi 50 messaggi del gruppo con checkbox.
    on_save(examples: list[dict]) è chiamato dopo il salvataggio.
    """

    def __init__(self, parent, group_id: int, group_name: str, on_save=None):
        super().__init__(parent)
        self.title('Seleziona messaggi segnale')
        self.geometry('700x620')
        self.configure(bg=_BG)
        self.resizable(True, True)
        self.transient(parent)
        self.grab_set()
        self.protocol('WM_DELETE_WINDOW', self._cancel)

        self._group_id   = group_id
        self._group_name = group_name
        self._on_save    = on_save or (lambda _: None)

        self._messages: list[dict]        = []
        self._vars:     list[tk.BooleanVar] = []
        # IDs già salvati in precedenza → pre-spuntati
        self._saved_ids: set[int] = {m['id'] for m in settings_store.get_signal_examples()}

        self._build_ui()
        self._fetch_messages()

    # ── costruzione UI ────────────────────────────────────────────────────────

    def _build_ui(self):
        # header
        hdr = tk.Frame(self, bg=_BG)
        hdr.pack(fill=tk.X, padx=14, pady=(12, 2))
        tk.Label(hdr, text='Seleziona i messaggi con segnali di trading',
                 bg=_BG, fg=_FG, font=_FONT_B).pack(anchor='w')
        tk.Label(hdr, text=f'Gruppo: {self._group_name}',
                 bg=_BG, fg=_FG_DIM, font=_FONT_SM).pack(anchor='w')

        # barra strumenti rapidi
        ctrl = tk.Frame(self, bg=_BG)
        ctrl.pack(fill=tk.X, padx=14, pady=(6, 4))
        for label, cmd in [('Seleziona tutti', self._select_all),
                            ('Deseleziona tutti', self._deselect_all)]:
            FlatButton(ctrl, text=label, command=cmd,
                       bg=_SEP, fg=_FG_DIM,
                       font=_FONT_SM, padx=8,
                       ).pack(side=tk.LEFT, padx=(0, 4))

        # area scrollabile: Canvas + Frame interno
        container = tk.Frame(self, bg=_BG)
        container.pack(fill=tk.BOTH, expand=True, padx=14, pady=(0, 6))

        self._canvas = tk.Canvas(container, bg=_BG, highlightthickness=0)
        sb = tk.Scrollbar(container, orient=tk.VERTICAL,
                          command=self._canvas.yview, bg=_PANEL)
        self._inner = tk.Frame(self._canvas, bg=_BG)

        self._win_id = self._canvas.create_window(
            (0, 0), window=self._inner, anchor='nw')
        self._inner.bind('<Configure>', self._on_inner_resize)
        self._canvas.bind('<Configure>', self._on_canvas_resize)
        self._canvas.configure(yscrollcommand=sb.set)

        self._canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sb.pack(side=tk.RIGHT, fill=tk.Y)

        # placeholder di caricamento
        self._loading_lbl = tk.Label(
            self._inner, text='Connessione e download messaggi...',
            bg=_BG, fg=_FG_DIM, font=_FONT_SM)
        self._loading_lbl.pack(padx=10, pady=24)

        # footer
        footer = tk.Frame(self, bg=_BG)
        footer.pack(fill=tk.X, padx=14, pady=(0, 12))

        self._count_lbl = tk.Label(footer, text='', bg=_BG, fg=_FG_DIM, font=_FONT_SM)
        self._count_lbl.pack(side=tk.LEFT)

        FlatButton(footer, text='Annulla', command=self._cancel,
                   bg=_PANEL, fg=_FG_DIM,
                   font=_FONT_SM, padx=12, pady=7,
                   highlightbackground=_SEP, highlightthickness=1,
                   ).pack(side=tk.RIGHT, padx=(6, 0))
        FlatButton(footer, text='Salva selezione', command=self._save,
                   bg=_ACCENT, fg='white', hover_bg='#6d28d9',
                   font=_FONT_SM, padx=14, pady=7,
                   ).pack(side=tk.RIGHT)

    # ── scroll helpers ────────────────────────────────────────────────────────

    def _on_inner_resize(self, _e):
        self._canvas.configure(scrollregion=self._canvas.bbox('all'))

    def _on_canvas_resize(self, event):
        self._canvas.itemconfig(self._win_id, width=event.width)

    def _bind_scroll(self):
        self.bind_all('<MouseWheel>', self._on_mousewheel)

    def _unbind_scroll(self):
        self.unbind_all('<MouseWheel>')

    def _on_mousewheel(self, event):
        # macOS: delta negativo = scorrimento verso il basso
        self._canvas.yview_scroll(int(-1 * event.delta), 'units')

    # ── fetch asincrono ───────────────────────────────────────────────────────

    def _fetch_messages(self):
        def run():
            loop = asyncio.SelectorEventLoop(selectors.SelectSelector())
            asyncio.set_event_loop(loop)
            try:
                msgs = loop.run_until_complete(self._async_fetch())
                self.after(0, lambda: self._populate(msgs))
            except Exception as exc:
                self.after(0, lambda e=exc: self._loading_lbl.config(
                    text=f'Errore durante il caricamento: {e}', fg=_RED))
            finally:
                loop.close()

        threading.Thread(target=run, daemon=True, name='SignalFetcher').start()

    async def _async_fetch(self) -> list[dict]:
        from telethon import TelegramClient

        client = TelegramClient(
            config.TELEGRAM_SESSION,
            config.TELEGRAM_API_ID,
            config.TELEGRAM_API_HASH,
        )
        await client.start()
        messages = []
        async for msg in client.iter_messages(self._group_id, limit=50):
            if not msg.text:
                continue
            sender   = await msg.get_sender()
            name     = _format_name(sender)
            date_str = (msg.date.astimezone().strftime('%d/%m/%Y %H:%M')
                        if msg.date else '??')
            messages.append({
                'id':     msg.id,
                'date':   date_str,
                'sender': name,
                'text':   msg.text,
            })
        await client.disconnect()
        return messages   # dal più recente al meno recente

    # ── rendering lista ───────────────────────────────────────────────────────

    def _populate(self, messages: list[dict]):
        self._loading_lbl.destroy()
        self._messages = messages
        self._vars     = []

        if not messages:
            tk.Label(self._inner, text='Nessun messaggio trovato nel gruppo.',
                     bg=_BG, fg=_FG_DIM, font=_FONT_SM).pack(padx=10, pady=20)
            self._update_count()
            return

        for i, msg in enumerate(messages):
            var = tk.BooleanVar(value=(msg['id'] in self._saved_ids))
            var.trace_add('write', lambda *_: self._update_count())
            self._vars.append(var)
            self._build_row(i, msg, var)

        self._bind_scroll()
        self._update_count()

    def _build_row(self, index: int, msg: dict, var: tk.BooleanVar):
        row_bg = _PANEL if index % 2 == 0 else _ROW_ALT

        row = tk.Frame(self._inner, bg=row_bg)
        row.pack(fill=tk.X, pady=(0, 1))

        # ── checkbox ──────────────────────────────────────────────────────────
        cb = tk.Checkbutton(
            row, variable=var,
            bg=row_bg, activebackground=row_bg,
            fg=_FG, selectcolor=_SEP,
            relief='flat', bd=0, cursor='hand2',
        )
        cb.pack(side=tk.LEFT, anchor='n', padx=(8, 0), pady=8)

        # ── contenuto ─────────────────────────────────────────────────────────
        content = tk.Frame(row, bg=row_bg)
        content.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(4, 8), pady=6)

        tk.Label(
            content,
            text=f'{msg["date"]}  ·  {msg["sender"]}',
            bg=row_bg, fg=_FG_DIM, font=_FONT_SM,
        ).pack(anchor='w')

        preview = msg['text'][:500] + ('…' if len(msg['text']) > 500 else '')
        tk.Label(
            content, text=preview,
            bg=row_bg, fg=_FG, font=_MONO,
            justify='left', wraplength=540, anchor='w',
        ).pack(anchor='w', pady=(2, 0))

        # clic sul frame fa toggle della checkbox
        for widget in (row, content):
            widget.bind('<Button-1>', lambda _e, v=var: v.set(not v.get()))

    # ── azioni ────────────────────────────────────────────────────────────────

    def _update_count(self):
        n = sum(v.get() for v in self._vars)
        self._count_lbl.config(
            text=f'{n} / {len(self._vars)} messaggi selezionati come segnale')

    def _select_all(self):
        for v in self._vars:
            v.set(True)

    def _deselect_all(self):
        for v in self._vars:
            v.set(False)

    def _save(self):
        selected = [
            msg for msg, var in zip(self._messages, self._vars) if var.get()
        ]
        settings_store.set_signal_examples(selected)
        self._unbind_scroll()
        self._on_save(selected)
        self.destroy()

    def _cancel(self):
        self._unbind_scroll()
        self.destroy()


# ── helper ────────────────────────────────────────────────────────────────────

def _format_name(sender) -> str:
    if sender is None:
        return 'Anonimo'
    first = getattr(sender, 'first_name', '') or ''
    last  = getattr(sender, 'last_name',  '') or ''
    title = getattr(sender, 'title',      '') or ''
    full  = f'{first} {last}'.strip()
    return full if full else title if title else str(getattr(sender, 'id', '?'))
