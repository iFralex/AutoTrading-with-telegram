from __future__ import annotations

"""
Schermata di primo avvio: guida l'utente a ottenere le credenziali
Telegram API e scrive config.py.

Chiamata da main.py prima di importare config, solo se config.py non esiste.
"""

import os
import tkinter as tk
import webbrowser
from tkinter import messagebox

from gui.widgets import FlatButton

# ── Palette (identica all'app principale) ─────────────────────────────────────
BG     = '#0f1117'
SURF   = '#161b27'
CARD   = '#1e2233'
BORDER = '#2a2f45'
ACCENT = '#7c3aed'
GREEN  = '#10b981'
RED    = '#f43f5e'
FG     = '#f1f5f9'
FG2    = '#94a3b8'
FG3    = '#475569'

F    = ('Helvetica Neue', 11)
F_SM = ('Helvetica Neue', 10)
F_XS = ('Helvetica Neue', 9)
F_B  = ('Helvetica Neue', 11, 'bold')
F_XL = ('Helvetica Neue', 20, 'bold')
F_SUB = ('Helvetica Neue', 12)
MONO = ('Menlo', 10)

_TELEGRAM_APPS_URL = 'https://my.telegram.org/apps'


def run_config_setup() -> None:
    """
    Apre la finestra di configurazione iniziale.
    Blocca fino alla chiusura. Se l'utente salva, config.py viene creato.
    """
    root = tk.Tk()
    root.title('Configurazione iniziale — Telegram → MT5')
    root.geometry('620x740')
    root.resizable(False, False)
    root.configure(bg=BG)
    _ConfigSetupWindow(root)
    root.mainloop()


# ─────────────────────────────────────────────────────────────────────────────

class _ConfigSetupWindow:

    def __init__(self, root: tk.Tk):
        self._root = root

        # ── canvas + scrollbar per gestire schermi piccoli ────────────────────
        canvas = tk.Canvas(root, bg=BG, highlightthickness=0)
        sb = tk.Scrollbar(root, orient=tk.VERTICAL, command=canvas.yview)
        canvas.configure(yscrollcommand=sb.set)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        root.bind_all('<MouseWheel>', lambda e: canvas.yview_scroll(int(-1 * e.delta), 'units'))

        inner = tk.Frame(canvas, bg=BG)
        win_id = canvas.create_window((0, 0), window=inner, anchor='nw')

        def _on_inner(e):
            canvas.configure(scrollregion=canvas.bbox('all'))
        def _on_canvas(e):
            canvas.itemconfig(win_id, width=e.width)

        inner.bind('<Configure>', _on_inner)
        canvas.bind('<Configure>', _on_canvas)

        # ── contenuto ─────────────────────────────────────────────────────────
        pad = tk.Frame(inner, bg=BG)
        pad.pack(padx=36, pady=(32, 28))

        # titolo
        tk.Label(pad, text='Configurazione iniziale',
                 bg=BG, fg=FG, font=F_XL).pack(anchor='w')
        tk.Label(pad, text='Telegram  →  MT5',
                 bg=BG, fg=FG2, font=F_SUB).pack(anchor='w', pady=(2, 24))

        # intro
        _intro(pad,
               'Per connettere il bot a Telegram hai bisogno di credenziali API '
               'personali. Non sono la tua password: sono chiavi tecniche che '
               'Telegram rilascia gratuitamente a ogni sviluppatore.')

        # step 1
        _step_card(pad, '1', 'Apri il pannello sviluppatori Telegram',
                   'Clicca il pulsante qui sotto per aprire il sito di Telegram.',
                   action=lambda: webbrowser.open(_TELEGRAM_APPS_URL),
                   action_label='Apri my.telegram.org/apps  ↗')

        # step 2
        _step_card(pad, '2', 'Accedi con il tuo numero di telefono',
                   'Inserisci il numero con il prefisso internazionale '
                   '(es. +39 333 1234567). Telegram ti invierà un codice OTP '
                   'via SMS o nell\'app.')

        # step 3
        _step_card(pad, '3', 'Crea una nuova applicazione',
                   'Clicca su "Create new application" e compila i campi:\n'
                   '• App title: qualsiasi nome (es. "My Trading Bot")\n'
                   '• Short name: una parola sola (es. "tradingbot")\n'
                   '• Platform: Desktop\n'
                   'Gli altri campi sono facoltativi, lascia pure i default.')

        # step 4 — input
        _step_header(pad, '4', 'Copia le credenziali e incollale qui sotto')
        form_card = _card(pad)
        form_card.pack(fill=tk.X, pady=(0, 8))

        info = tk.Frame(form_card, bg=CARD, padx=20, pady=6)
        info.pack(fill=tk.X)
        tk.Label(info,
                 text='Nella pagina trovi "App api_id" e "App api_hash": copiali qui.',
                 bg=CARD, fg=FG2, font=F_SM, justify='left', anchor='w',
                 wraplength=480).pack(anchor='w')

        grid = tk.Frame(form_card, bg=CARD, padx=20, pady=(4, 20))
        grid.pack(fill=tk.X)
        grid.columnconfigure(1, weight=1)

        self._api_id   = _field(grid, 0, 'App api_id',   placeholder='12345678')
        self._api_hash = _field(grid, 1, 'App api_hash', placeholder='abcdef1234567890abcdef1234567890')
        self._session  = _field(grid, 2, 'Nome sessione',
                                placeholder='session',
                                default='session',
                                hint='Puoi lasciare il valore predefinito')

        # avviso sicurezza
        warn = tk.Frame(pad, bg=SURF, padx=16, pady=12)
        warn.pack(fill=tk.X, pady=(0, 20))
        warn.configure(highlightbackground=BORDER, highlightthickness=1)
        tk.Label(warn, text='🔒  Sicurezza',
                 bg=SURF, fg=FG, font=F_B).pack(anchor='w')
        tk.Label(warn,
                 text='Le credenziali vengono salvate solo in locale nel file config.py '
                      'e non vengono mai caricate su internet. config.py è escluso '
                      'dal repository git tramite .gitignore.',
                 bg=SURF, fg=FG2, font=F_SM, justify='left', anchor='w',
                 wraplength=530).pack(anchor='w', pady=(4, 0))

        # footer
        foot = tk.Frame(pad, bg=BG)
        foot.pack(fill=tk.X)

        FlatButton(foot, text='Annulla', command=self._cancel,
                   bg=CARD, fg=FG3, font=F_SM, padx=14, pady=9,
                   highlightbackground=BORDER, highlightthickness=1,
                   ).pack(side=tk.RIGHT, padx=(8, 0))

        FlatButton(foot, text='Salva e continua  →', command=self._save,
                   bg=ACCENT, fg='white', hover_bg='#6d28d9',
                   font=F_B, padx=20, pady=10,
                   ).pack(side=tk.RIGHT)

    # ── azioni ────────────────────────────────────────────────────────────────

    def _save(self):
        api_id   = self._api_id.real_get().strip()
        api_hash = self._api_hash.real_get().strip()
        session  = self._session.real_get().strip() or 'session'

        # validazione
        if not api_id:
            messagebox.showerror('Campo mancante', 'Inserisci l\'App api_id.', parent=self._root)
            return
        try:
            api_id_int = int(api_id)
        except ValueError:
            messagebox.showerror('Valore non valido',
                                 'L\'App api_id deve essere un numero intero.', parent=self._root)
            return
        if not api_hash:
            messagebox.showerror('Campo mancante', 'Inserisci l\'App api_hash.', parent=self._root)
            return
        if len(api_hash) != 32 or not all(c in '0123456789abcdef' for c in api_hash.lower()):
            if not messagebox.askyesno(
                    'Formato insolito',
                    'L\'api_hash solitamente è una stringa esadecimale di 32 caratteri.\n'
                    'Il valore inserito sembra diverso. Salvare comunque?',
                    parent=self._root):
                return

        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.py')
        _write_config(config_path, api_id_int, api_hash, session)
        self._root.destroy()

    def _cancel(self):
        self._root.destroy()


# ── helpers UI ────────────────────────────────────────────────────────────────

def _intro(parent, text: str):
    f = tk.Frame(parent, bg=BG)
    f.pack(fill=tk.X, pady=(0, 20))
    tk.Label(f, text=text, bg=BG, fg=FG2, font=F_SM,
             justify='left', anchor='w', wraplength=530).pack(anchor='w')


def _card(parent) -> tk.Frame:
    f = tk.Frame(parent, bg=CARD)
    f.configure(highlightbackground=BORDER, highlightthickness=1)
    return f


def _step_header(parent, num: str, title: str):
    row = tk.Frame(parent, bg=BG)
    row.pack(fill=tk.X, pady=(12, 6))

    badge = tk.Label(row, text=num, bg=ACCENT, fg='white',
                     font=('Helvetica Neue', 10, 'bold'), width=2, anchor='center')
    badge.pack(side=tk.LEFT, padx=(0, 12))
    tk.Label(row, text=title, bg=BG, fg=FG, font=F_B).pack(side=tk.LEFT, anchor='w')


def _step_card(parent, num: str, title: str, body: str,
               action=None, action_label: str = ''):
    _step_header(parent, num, title)

    card = _card(parent)
    card.pack(fill=tk.X, pady=(0, 8))

    inner = tk.Frame(card, bg=CARD, padx=20, pady=14)
    inner.pack(fill=tk.X)

    tk.Label(inner, text=body, bg=CARD, fg=FG2, font=F_SM,
             justify='left', anchor='w', wraplength=500).pack(anchor='w')

    if action:
        FlatButton(inner, text=action_label, command=action,
                   bg=SURF, fg=FG2, font=F_SM, padx=12, pady=7,
                   highlightbackground=BORDER, highlightthickness=1,
                   ).pack(anchor='w', pady=(10, 0))


def _field(grid: tk.Frame, row: int, label: str,
           placeholder: str = '', default: str = '',
           hint: str = '') -> tk.Entry:
    tk.Label(grid, text=label, bg=CARD, fg=FG2,
             font=F_SM, anchor='w').grid(row=row * 2, column=0,
                                         sticky='w', pady=(10, 2))
    var = tk.StringVar(value=default)
    ent = tk.Entry(grid, textvariable=var,
                   bg=SURF, fg=FG, insertbackground=FG,
                   relief='flat', font=MONO,
                   highlightbackground=BORDER, highlightthickness=1)
    ent.grid(row=row * 2, column=1, sticky='ew', padx=(12, 0), pady=(10, 2))

    if placeholder and not default:
        # testo suggerimento grigio che scompare al focus
        ent.insert(0, placeholder)
        ent.config(fg=FG3)

        def _focus_in(e, entry=ent, v=var, ph=placeholder):
            if entry.get() == ph:
                entry.delete(0, tk.END)
                entry.config(fg=FG)

        def _focus_out(e, entry=ent, v=var, ph=placeholder):
            if not entry.get():
                entry.insert(0, ph)
                entry.config(fg=FG3)

        ent.bind('<FocusIn>',  _focus_in)
        ent.bind('<FocusOut>', _focus_out)

        # wrap get() per restituire '' se è ancora il placeholder
        original_get = var.get
        def safe_get(ph=placeholder):
            val = ent.get()
            return '' if val == ph else val
        ent.real_get = safe_get   # tipo custom, vedi _save
    else:
        ent.real_get = ent.get   # normale

    if hint:
        tk.Label(grid, text=hint, bg=CARD, fg=FG3,
                 font=F_XS, anchor='w').grid(row=row * 2 + 1, column=1,
                                              sticky='w', padx=(12, 0))
    return ent


# ── scrittura config.py ───────────────────────────────────────────────────────

def _write_config(path: str, api_id: int, api_hash: str, session: str):
    content = f"""\
# File generato automaticamente — NON caricare su git (è in .gitignore).
# Modifica i valori o cancella questo file per rifare la configurazione.

# ── Telegram ──────────────────────────────────────────────────────────────────
TELEGRAM_API_ID   = {api_id}
TELEGRAM_API_HASH = '{api_hash}'
TELEGRAM_SESSION  = '{session}'

# ── MetaTrader 5 ──────────────────────────────────────────────────────────────
MT5_LOGIN    = 0       # numero conto (0 = usa conto attivo nel terminale)
MT5_PASSWORD = ''      # lascia vuoto se MT5 è già loggato
MT5_SERVER   = ''      # es. "ICMarkets-Demo"
"""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
