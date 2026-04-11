"""
Entry point.

Avvia direttamente la GUI. Se config.py o la sessione Telegram mancano,
il wizard di setup (SetupView) guida l'utente a configurare tutto.
"""

if __name__ == '__main__':
    from gui.app import App
    app = App()
    app.protocol('WM_DELETE_WINDOW', app.on_close)
    app.mainloop()
