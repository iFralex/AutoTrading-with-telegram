from __future__ import annotations

"""
Widget personalizzati cross-platform.

Problema: su macOS tk.Button usa il renderer Aqua nativo che ignora bg/fg.
Soluzione: FlatButton estende tk.Label (che rispetta i colori su tutti i SO)
           e simula il comportamento di un pulsante tramite binding del click.
"""

import tkinter as tk


class FlatButton(tk.Label):
    """
    Pulsante flat compatibile macOS e Windows.
    API analoga a tk.Button: text, command, bg, fg, font, padx, pady, state.
    """

    # Parametri di tk.Button non supportati da tk.Label
    _UNSUPPORTED = frozenset({
        'activebackground', 'activeforeground', 'default', 'overrelief',
    })

    def __init__(self, parent, text='', command=None,
                 bg='#1e2233', fg='#f1f5f9',
                 font=('Helvetica Neue', 10),
                 padx=12, pady=6,
                 state='normal',
                 hover_bg=None,
                 **kwargs):
        # Filtra kwargs non supportati da Label
        clean = {k: v for k, v in kwargs.items() if k not in self._UNSUPPORTED}

        super().__init__(
            parent, text=text, bg=bg, fg=fg,
            font=font, padx=padx, pady=pady, **clean,
        )
        self._bg    = bg
        self._fg    = fg
        self._h_bg  = hover_bg or _hover_color(bg)
        self._cmd   = command
        self._state = state

        self.bind('<Button-1>', self._on_click)
        self.bind('<Enter>',   self._on_enter)
        self.bind('<Leave>',   self._on_leave)

        # stato iniziale
        if state == 'disabled':
            tk.Label.configure(self, fg='#475569', cursor='arrow')
        else:
            tk.Label.configure(self, cursor='hand2')

    # ── eventi ────────────────────────────────────────────────────────────────

    def _on_click(self, _e):
        if self._state == 'normal' and self._cmd:
            self._cmd()

    def _on_enter(self, _e):
        if self._state == 'normal':
            tk.Label.configure(self, bg=self._h_bg)

    def _on_leave(self, _e):
        tk.Label.configure(self, bg=self._bg)

    # ── configure ─────────────────────────────────────────────────────────────

    def configure(self, **kw):
        clean = {k: v for k, v in kw.items() if k not in self._UNSUPPORTED}

        state = clean.pop('state', None)
        cmd   = clean.pop('command', None)

        if cmd is not None:
            self._cmd = cmd

        if state is not None:
            self._state = state
            if state == 'disabled':
                clean.setdefault('fg', '#475569')
                clean['cursor'] = 'arrow'
            else:
                clean.setdefault('fg', self._fg)
                clean['cursor'] = 'hand2'

        if 'bg' in clean:
            self._bg  = clean['bg']
            self._h_bg = _hover_color(self._bg)
        if 'fg' in clean:
            self._fg = clean['fg']

        if clean:
            tk.Label.configure(self, **clean)

    config = configure


# ── helpers ───────────────────────────────────────────────────────────────────

def _hover_color(color: str) -> str:
    """
    Colore hover adattivo:
    - sfondo scuro  → leggermente più chiaro
    - sfondo chiaro/colorato → leggermente più scuro
    """
    try:
        c = color.lstrip('#')
        r, g, b = int(c[:2], 16), int(c[2:4], 16), int(c[4:], 16)
        # luminanza percettiva
        lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        f = 1.30 if lum < 0.25 else 0.82
        return '#{:02x}{:02x}{:02x}'.format(
            min(255, int(r * f)),
            min(255, int(g * f)),
            min(255, int(b * f)),
        )
    except Exception:
        return color
