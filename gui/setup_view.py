from __future__ import annotations

"""
Wizard di configurazione iniziale (4 step).

Step 1 — Credenziali API   : inserisce api_id / api_hash e scrive config.py
Step 2 — Autenticazione    : autentica la sessione Telegram (telefono + OTP + 2FA)
Step 3 — Gruppo            : seleziona il gruppo/canale da monitorare
Step 4 — Segnali           : indica quali messaggi sono segnali di trading

Step 1 è visibile solo se config.py non esiste ancora.
Step 2 è visibile solo se config.py esiste ma la sessione non è autenticata.
"""

import asyncio
import os
import selectors
import threading
import tkinter as tk
import webbrowser

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
RED    = '#f43f5e'
FG     = '#f1f5f9'
FG2    = '#94a3b8'
FG3    = '#475569'

F    = ('Helvetica Neue', 11)
F_SM = ('Helvetica Neue', 10)
F_XS = ('Helvetica Neue', 9)
F_B  = ('Helvetica Neue', 11, 'bold')
F_XL = ('Helvetica Neue', 22, 'bold')
F_SUB = ('Helvetica Neue', 12)
MONO = ('Menlo', 10)

_PROJECT_ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CONFIG_PATH    = os.path.join(_PROJECT_ROOT, 'config.py')
_TELEGRAM_URL   = 'https://my.telegram.org/apps'


# ── helpers pubblici (importati anche da app.py) ──────────────────────────────

def _config_exists() -> bool:
    return os.path.exists(_CONFIG_PATH)


def _session_exists() -> bool:
    if not _config_exists():
        return False
    try:
        import config  # noqa: PLC0415
        return os.path.exists(f'{config.TELEGRAM_SESSION}.session')
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  SetupView
# ─────────────────────────────────────────────────────────────────────────────

class SetupView(tk.Frame):
    """Wizard a 4 step; si ricostruisce ad ogni cambio di stato."""

    def __init__(self, parent, on_complete, **kwargs):
        super().__init__(parent, bg=BG, **kwargs)
        self._on_complete   = on_complete
        self._win           = parent   # App — NON usare _root (metodo interno tkinter)

        gid, gname          = settings_store.get_group()
        self._group_id      = gid
        self._group_name    = gname or ''
        self._signal_count  = len(settings_store.get_signal_examples())
        self._tg_auth       = _session_exists()   # True se la sessione esiste già

        self._render()

    # ── rendering ─────────────────────────────────────────────────────────────

    def _render(self):
        for w in self.winfo_children():
            w.destroy()

        wrap = tk.Frame(self, bg=BG)
        wrap.place(relx=0.5, rely=0.5, anchor='center')

        tk.Label(wrap, text='Telegram  →  MT5', bg=BG, fg=FG,
                 font=F_XL).pack(anchor='w', pady=(0, 6))
        tk.Label(wrap, text='Prima di iniziare, completa la configurazione',
                 bg=BG, fg=FG2, font=F_SUB).pack(anchor='w', pady=(0, 28))

        for n in (1, 2, 3, 4):
            self._build_step_card(wrap, n)

        # footer
        foot = tk.Frame(wrap, bg=BG)
        foot.pack(fill=tk.X, pady=(24, 0))

        ready = self._is_ready()
        FlatButton(
            foot,
            text='Avvia applicazione  →',
            command=self._on_complete,
            bg=ACCENT if ready else CARD,
            fg=FG    if ready else FG3,
            hover_bg='#6d28d9' if ready else CARD,
            font=F_B, padx=24, pady=12,
            state='normal' if ready else 'disabled',
        ).pack(side=tk.RIGHT)

        if not ready:
            missing = self._missing_hint()
            if missing:
                tk.Label(foot, text=missing,
                         bg=BG, fg=FG3, font=F_SM,
                         ).pack(side=tk.RIGHT, padx=(0, 16), pady=4)

    def _build_step_card(self, parent, n: int):
        done   = self._step_done(n)
        active = self._step_active(n)

        card = tk.Frame(parent, bg=CARD, padx=20, pady=14)
        card.pack(fill=tk.X, pady=(0, 6))
        card.configure(highlightbackground=BORDER, highlightthickness=1)

        # badge
        badge_bg = GREEN if done else (ACCENT if active else SURF)
        badge_fg = 'white' if (done or active) else FG3
        badge = tk.Label(card, text='✓' if done else str(n),
                         bg=badge_bg, fg=badge_fg,
                         font=('Helvetica Neue', 10, 'bold'),
                         width=2, anchor='center')
        if not done and not active:
            badge.configure(highlightbackground=BORDER, highlightthickness=1)
        badge.pack(side=tk.LEFT, anchor='n', pady=2, padx=(0, 16))

        # testo centrale
        mid = tk.Frame(card, bg=CARD)
        mid.pack(side=tk.LEFT, fill=tk.X, expand=True)
        TITLES = ('Credenziali API Telegram',
                  'Autenticazione Telegram',
                  'Gruppo da monitorare',
                  'Esempi di segnale')
        tk.Label(mid, text=TITLES[n - 1],
                 bg=CARD, fg=FG, font=F_B).pack(anchor='w')
        tk.Label(mid, text=self._step_subtitle(n),
                 bg=CARD, fg=self._step_sub_fg(n), font=F_SM).pack(anchor='w', pady=(3, 0))

        # azione destra
        right = tk.Frame(card, bg=CARD)
        right.pack(side=tk.RIGHT, padx=(12, 0))
        self._build_step_action(right, n, done, active)

    def _build_step_action(self, parent, n: int, done: bool, active: bool):
        if n == 1:
            if done:
                FlatButton(parent, text='Modifica  →',
                           command=self._open_credentials_dialog,
                           bg=CARD, fg=FG2, font=F_SM, padx=12, pady=7,
                           highlightbackground=BORDER, highlightthickness=1).pack()
            else:
                FlatButton(parent, text='Configura credenziali  →',
                           command=self._open_credentials_dialog,
                           bg=ACCENT, fg='white', hover_bg='#6d28d9',
                           font=F_SM, padx=14, pady=8).pack()
            return

        if n == 2:
            if done:
                tk.Label(parent, text='✓  Sessione attiva',
                         bg=CARD, fg=GREEN, font=F_SM).pack()
            elif _config_exists():
                FlatButton(parent, text='Autentica  →',
                           command=self._open_auth_dialog,
                           bg=ACCENT, fg='white', hover_bg='#6d28d9',
                           font=F_SM, padx=14, pady=8).pack()
            else:
                tk.Label(parent, text='Prima configura le credenziali',
                         bg=CARD, fg=FG3, font=F_XS).pack()
            return

        if n == 3:
            lbl    = 'Cambia  →' if done else 'Seleziona gruppo  →'
            btn_bg = CARD if done else (ACCENT if active else SURF)
            btn_fg = FG2  if done else ('white' if active else FG3)
            kw = dict(highlightbackground=BORDER, highlightthickness=1) if done else {}
            state = 'normal' if (done or active) else 'disabled'
            FlatButton(parent, text=lbl, command=self._open_group_selector,
                       bg=btn_bg, fg=btn_fg,
                       font=F_SM, padx=14, pady=8,
                       state=state, **kw).pack()
            return

        # n == 4
        if done:
            FlatButton(parent, text='Modifica  →',
                       command=self._open_signal_selector,
                       bg=CARD, fg=FG2, font=F_SM, padx=14, pady=8,
                       highlightbackground=BORDER, highlightthickness=1).pack()
        elif self._group_id and self._tg_auth:
            FlatButton(parent, text='Configura segnali  →',
                       command=self._open_signal_selector,
                       bg=ACCENT, fg='white', hover_bg='#6d28d9',
                       font=F_SM, padx=14, pady=8).pack()
        else:
            tk.Label(parent, text='Prima seleziona un gruppo',
                     bg=CARD, fg=FG3, font=F_XS).pack()

    # ── state helpers ─────────────────────────────────────────────────────────

    def _step_done(self, n: int) -> bool:
        if n == 1: return _config_exists()
        if n == 2: return self._tg_auth
        if n == 3: return bool(self._group_id)
        return self._signal_count > 0

    def _step_active(self, n: int) -> bool:
        if n == 1: return not _config_exists()
        if n == 2: return _config_exists() and not self._tg_auth
        if n == 3: return self._tg_auth and not self._group_id
        return bool(self._group_id) and self._signal_count == 0

    def _step_subtitle(self, n: int) -> str:
        if n == 1:
            if _config_exists():
                return 'api_id e api_hash configurati'
            return 'Necessarie per accedere a Telegram'
        if n == 2:
            return 'Sessione Telegram attiva' if self._tg_auth else 'Accesso con numero di telefono + codice OTP'
        if n == 3:
            return self._group_name if self._group_id else 'Nessun gruppo selezionato'
        if self._signal_count:
            return f'{self._signal_count} messaggi di esempio salvati'
        return 'Indica quali messaggi sono segnali di trading'

    def _step_sub_fg(self, n: int) -> str:
        if n == 1: return FG2 if _config_exists() else FG3
        if n == 2: return GREEN if self._tg_auth else FG3
        if n == 3: return FG2 if self._group_id else FG3
        return FG2 if self._signal_count else FG3

    def _is_ready(self) -> bool:
        return _config_exists() and self._tg_auth and bool(self._group_id) and self._signal_count > 0

    def _missing_hint(self) -> str:
        if not _config_exists():    return 'inserisci le credenziali API'
        if not self._tg_auth:       return 'autentica Telegram'
        if not self._group_id:      return 'seleziona un gruppo'
        return ''

    # ── dialog handlers ───────────────────────────────────────────────────────

    def _open_credentials_dialog(self):
        _CredentialsDialog(self._win, on_save=lambda: (
            setattr(self, '_tg_auth', _session_exists()),
            self._render(),
        ))

    def _open_auth_dialog(self):
        def on_success(info: str):
            self._tg_auth = True
            self._render()
        _TelegramAuthDialog(self._win, on_success=on_success)

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


# ─────────────────────────────────────────────────────────────────────────────
#  Dialog: Credenziali API
# ─────────────────────────────────────────────────────────────────────────────

class _CredentialsDialog(tk.Toplevel):
    """
    Spiega come ottenere le credenziali Telegram API e le salva in config.py.
    """

    def __init__(self, parent, on_save=None):
        super().__init__(parent)
        self.title('Credenziali API Telegram')
        self.geometry('560x540')
        self.configure(bg=BG)
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()
        self.protocol('WM_DELETE_WINDOW', self.destroy)

        self._on_save = on_save or (lambda: None)
        self._build_ui()

        # pre-popola se config.py esiste già
        if _config_exists():
            try:
                import config  # noqa: PLC0415
                self._id_var.set(str(config.TELEGRAM_API_ID))
                self._hash_var.set(config.TELEGRAM_API_HASH)
                self._sess_var.set(config.TELEGRAM_SESSION)
            except Exception:
                pass

    def _build_ui(self):
        pad = tk.Frame(self, bg=BG, padx=28, pady=22)
        pad.pack(fill=tk.BOTH, expand=True)

        tk.Label(pad, text='Credenziali API Telegram',
                 bg=BG, fg=FG, font=F_B).pack(anchor='w')
        tk.Label(pad, text='Servono per connettere il bot al tuo account Telegram.',
                 bg=BG, fg=FG2, font=F_SM).pack(anchor='w', pady=(4, 20))

        # ── istruzioni ────────────────────────────────────────────────────────
        steps_card = tk.Frame(pad, bg=SURF, padx=16, pady=14)
        steps_card.pack(fill=tk.X, pady=(0, 18))
        steps_card.configure(highlightbackground=BORDER, highlightthickness=1)

        tk.Label(steps_card, text='Come ottenerle', bg=SURF, fg=FG, font=F_B).pack(anchor='w')

        instructions = (
            '1.  Apri my.telegram.org/apps e accedi con il tuo numero.',
            '2.  Clicca "Create new application".',
            '3.  Compila titolo e short name (valori a piacere), piattaforma Desktop.',
            '4.  Copia "App api_id" e "App api_hash" e incollali qui sotto.',
        )
        for line in instructions:
            tk.Label(steps_card, text=line,
                     bg=SURF, fg=FG2, font=F_SM,
                     justify='left', anchor='w').pack(anchor='w', pady=1)

        FlatButton(steps_card, text='Apri my.telegram.org/apps  ↗',
                   command=lambda: webbrowser.open(_TELEGRAM_URL),
                   bg=CARD, fg=FG2, font=F_SM, padx=10, pady=6,
                   highlightbackground=BORDER, highlightthickness=1,
                   ).pack(anchor='w', pady=(10, 0))

        # ── form ──────────────────────────────────────────────────────────────
        grid = tk.Frame(pad, bg=BG)
        grid.pack(fill=tk.X, pady=(0, 20))
        grid.columnconfigure(1, weight=1)

        self._id_var   = tk.StringVar()
        self._hash_var = tk.StringVar()
        self._sess_var = tk.StringVar(value='session')

        _form_row(grid, 0, 'App api_id',   self._id_var,   '12345678')
        _form_row(grid, 1, 'App api_hash', self._hash_var, 'abcdef1234567890abcdef1234567890')
        _form_row(grid, 2, 'Nome sessione', self._sess_var, '',
                  hint='Puoi lasciare il valore predefinito')

        # ── footer ────────────────────────────────────────────────────────────
        foot = tk.Frame(pad, bg=BG)
        foot.pack(fill=tk.X)

        FlatButton(foot, text='Annulla', command=self.destroy,
                   bg=CARD, fg=FG3, font=F_SM, padx=14, pady=8,
                   highlightbackground=BORDER, highlightthickness=1,
                   ).pack(side=tk.RIGHT, padx=(8, 0))
        FlatButton(foot, text='Salva  →', command=self._save,
                   bg=ACCENT, fg='white', hover_bg='#6d28d9',
                   font=F_B, padx=18, pady=9,
                   ).pack(side=tk.RIGHT)

    def _save(self):
        from tkinter import messagebox

        api_id_s = self._id_var.get().strip()
        api_hash = self._hash_var.get().strip()
        session  = self._sess_var.get().strip() or 'session'

        if not api_id_s:
            messagebox.showerror('Campo mancante', 'Inserisci l\'App api_id.', parent=self)
            return
        try:
            api_id = int(api_id_s)
        except ValueError:
            messagebox.showerror('Valore non valido',
                                 'L\'App api_id deve essere un numero intero.', parent=self)
            return
        if not api_hash:
            messagebox.showerror('Campo mancante', 'Inserisci l\'App api_hash.', parent=self)
            return
        if len(api_hash) != 32 or not all(c in '0123456789abcdef' for c in api_hash.lower()):
            if not messagebox.askyesno(
                    'Formato insolito',
                    'L\'api_hash solitamente è una stringa esadecimale da 32 caratteri. '
                    'Il valore inserito sembra diverso. Salvare comunque?',
                    parent=self):
                return

        _write_config(_CONFIG_PATH, api_id, api_hash, session)
        self._on_save()
        self.destroy()


class _AuthCancelled(Exception):
    """Sollevata quando l'utente chiude il dialog prima di completare l'auth."""


# ─────────────────────────────────────────────────────────────────────────────
#  Dialog: Autenticazione Telegram
# ─────────────────────────────────────────────────────────────────────────────

class _TelegramAuthDialog(tk.Toplevel):
    """
    Guida l'utente nell'autenticazione Telegram in 3 fasi:
      1. Numero di telefono  →  2. Codice OTP  →  3. Password 2FA (opzionale)

    L'intera sequenza Telethon gira in un thread background;
    threading.Event sincronizza i passi con la GUI.
    """

    def __init__(self, parent, on_success):
        super().__init__(parent)
        self.title('Autenticazione Telegram')
        self.geometry('440x260')
        self.configure(bg=BG)
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()
        self.protocol('WM_DELETE_WINDOW', self._on_close)

        self._on_success    = on_success
        self._input_event   = threading.Event()
        self._input_value   = ''
        self._closed        = False

        self._show_loading('Connessione a Telegram…')
        threading.Thread(target=self._run_auth, daemon=True, name='TgAuth').start()

    # ── thread background ─────────────────────────────────────────────────────

    def _run_auth(self):
        loop = asyncio.SelectorEventLoop(selectors.SelectSelector())
        asyncio.set_event_loop(loop)
        try:
            info = loop.run_until_complete(self._async_auth())
            if not self._closed:
                self.after(0, lambda i=info: self._finish(i))
        except _AuthCancelled:
            pass   # utente ha chiuso il dialog
        except Exception as exc:
            if not self._closed:
                self.after(0, lambda e=exc: self._show_error(str(e)))
        finally:
            loop.close()

    async def _async_auth(self) -> str:
        """
        Usa client.start() con callback async: Telethon gestisce internamente
        la sequenza connect → phone → OTP → 2FA evitando problemi di serializzazione.
        """
        import config  # noqa: PLC0415
        from telethon import TelegramClient

        async def _phone_cb() -> str:
            self.after(0, self._show_phone_step)
            return await self._get_input()

        async def _code_cb() -> str:
            self.after(0, self._show_code_step)
            return await self._get_input()

        async def _pwd_cb() -> str:
            self.after(0, self._show_2fa_step)
            return await self._get_input()

        client = TelegramClient(
            config.TELEGRAM_SESSION,
            config.TELEGRAM_API_ID,
            config.TELEGRAM_API_HASH,
        )
        await client.start(
            phone=_phone_cb,
            code_callback=_code_cb,
            password=_pwd_cb,
        )

        me = await client.get_me()
        await client.disconnect()
        return f'{me.first_name} ({me.phone})'

    async def _get_input(self) -> str:
        """Attende input dalla GUI senza bloccare l'event loop."""
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._wait_sync)
        if self._closed:
            raise _AuthCancelled()
        return result

    def _wait_sync(self) -> str:
        self._input_event.clear()
        self._input_event.wait()
        return self._input_value

    def _submit(self):
        val = self._entry_var.get().strip()
        if not val:
            return
        self._input_value = val
        self._input_event.set()
        self._show_loading('Verifica in corso…')

    # ── fasi UI ───────────────────────────────────────────────────────────────

    def _show_phone_step(self):
        self._show_input(
            title    = 'Numero di telefono',
            subtitle = 'Inserisci il numero con prefisso internazionale (es. +39 333 1234567)',
            btn_text = 'Invia codice OTP  →',
            secret   = False,
        )

    def _show_code_step(self):
        self._show_input(
            title    = 'Codice OTP',
            subtitle = 'Inserisci il codice ricevuto via SMS o nell\'app Telegram',
            btn_text = 'Verifica  →',
            secret   = False,
        )

    def _show_2fa_step(self):
        self._show_input(
            title    = 'Password 2FA',
            subtitle = 'Il tuo account ha la verifica in due passaggi attivata',
            btn_text = 'Accedi  →',
            secret   = True,
        )

    def _show_input(self, *, title: str, subtitle: str, btn_text: str, secret: bool):
        self._clear()
        pad = tk.Frame(self, bg=BG, padx=32, pady=24)
        pad.pack(fill=tk.BOTH, expand=True)

        tk.Label(pad, text=title, bg=BG, fg=FG, font=F_B).pack(anchor='w')
        tk.Label(pad, text=subtitle, bg=BG, fg=FG2, font=F_SM,
                 justify='left', wraplength=360, anchor='w',
                 ).pack(anchor='w', pady=(4, 14))

        self._entry_var = tk.StringVar()
        ent = tk.Entry(pad, textvariable=self._entry_var,
                       bg=SURF, fg=FG, insertbackground=FG,
                       relief='flat', font=MONO,
                       show='●' if secret else '',
                       highlightbackground=BORDER, highlightthickness=1)
        ent.pack(fill=tk.X, pady=(0, 14))
        ent.focus()
        ent.bind('<Return>', lambda _e: self._submit())

        FlatButton(pad, text=btn_text, command=self._submit,
                   bg=ACCENT, fg='white', hover_bg='#6d28d9',
                   font=F_B, padx=16, pady=9).pack(anchor='e')

    def _show_loading(self, msg: str):
        self._clear()
        pad = tk.Frame(self, bg=BG, padx=32, pady=40)
        pad.pack(fill=tk.BOTH, expand=True)
        tk.Label(pad, text=msg, bg=BG, fg=FG2, font=F_SM).pack()

    def _show_error(self, msg: str):
        self._clear()
        pad = tk.Frame(self, bg=BG, padx=32, pady=24)
        pad.pack(fill=tk.BOTH, expand=True)
        tk.Label(pad, text='Errore di autenticazione',
                 bg=BG, fg=RED, font=F_B).pack(anchor='w')
        tk.Label(pad, text=msg, bg=BG, fg=FG2, font=F_SM,
                 justify='left', wraplength=360, anchor='w',
                 ).pack(anchor='w', pady=(6, 20))
        FlatButton(pad, text='Riprova', command=self._retry,
                   bg=ACCENT, fg='white', font=F_SM, padx=14, pady=8).pack(anchor='w')

    def _clear(self):
        for w in self.winfo_children():
            w.destroy()

    def _finish(self, info: str):
        self._on_success(info)
        self.destroy()

    def _retry(self):
        self._closed = False
        self._input_value = ''
        self._input_event.clear()
        self._show_loading('Connessione a Telegram…')
        threading.Thread(target=self._run_auth, daemon=True, name='TgAuth').start()

    def _on_close(self):
        self._closed = True
        self._input_value = ''
        self._input_event.set()   # sblocca eventuale wait_sync pendente
        self.destroy()


# ── helpers ───────────────────────────────────────────────────────────────────

def _form_row(grid: tk.Frame, row: int, label: str,
              var: tk.StringVar, placeholder: str, hint: str = ''):
    tk.Label(grid, text=label, bg=BG, fg=FG2,
             font=F_SM, anchor='w').grid(row=row * 2, column=0,
                                          sticky='w', pady=(10, 2), padx=(0, 14))
    ent = tk.Entry(grid, textvariable=var,
                   bg=SURF, fg=FG, insertbackground=FG,
                   relief='flat', font=MONO,
                   highlightbackground=BORDER, highlightthickness=1)
    ent.grid(row=row * 2, column=1, sticky='ew', pady=(10, 2))

    if placeholder and not var.get():
        ent.insert(0, placeholder)
        ent.config(fg=FG3)

        def _in(e, e_=ent, ph=placeholder):
            if e_.get() == ph:
                e_.delete(0, tk.END)
                e_.config(fg=FG)

        def _out(e, e_=ent, v=var, ph=placeholder):
            if not e_.get():
                e_.insert(0, ph)
                e_.config(fg=FG3)

        ent.bind('<FocusIn>',  _in)
        ent.bind('<FocusOut>', _out)

        # override StringVar.get per ignorare il placeholder
        _orig = var.get
        def _safe_get(ph=placeholder, e_=ent, orig=_orig):
            val = e_.get()
            return '' if val == ph else val
        var.get = _safe_get  # type: ignore[method-assign]

    if hint:
        tk.Label(grid, text=hint, bg=BG, fg=FG3, font=F_XS, anchor='w',
                 ).grid(row=row * 2 + 1, column=1, sticky='w')


def _write_config(path: str, api_id: int, api_hash: str, session: str):
    content = f"""\
# File generato automaticamente — non caricare su git (è in .gitignore).
# Per modificare le credenziali elimina questo file e riavvia l'app.

# ── Telegram ──────────────────────────────────────────────────────────────────
TELEGRAM_API_ID   = {api_id}
TELEGRAM_API_HASH = '{api_hash}'
TELEGRAM_SESSION  = '{session}'

# ── MetaTrader 5 ──────────────────────────────────────────────────────────────
MT5_LOGIN    = 0       # numero conto (0 = usa conto attivo nel terminale)
MT5_PASSWORD = ''      # lascia vuoto se MT5 è già loggato
MT5_SERVER   = ''      # es. "ICMarkets-Demo"
"""
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(content)
