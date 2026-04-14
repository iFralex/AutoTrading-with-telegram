"""
Diagnostica MT5 — eseguire direttamente sul VPS (non tramite server).

Uso:
    python test_mt5_diag.py

Lo script testa ogni pezzo della catena in isolamento e stampa
cosa funziona e cosa no. Nessun server, nessun async, nessun thread.

Imposta le variabili SOTTO prima di eseguire.
"""

import sys
import time
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURA QUESTI VALORI PRIMA DI ESEGUIRE
# ─────────────────────────────────────────────────────────────────────────────

MT5_LOGIN    = 0            # es. 12345678
MT5_PASSWORD = ""           # es. "password123"
MT5_SERVER   = ""           # es. "ICMarkets-Demo"

# Percorso al template MT5 (la cartella con terminal64.exe già configurato)
# Lascia None per usare il percorso default del bot.
MT5_TEMPLATE_PATH: str | None = None

# ─────────────────────────────────────────────────────────────────────────────


def sep(title: str = "") -> None:
    line = "─" * 60
    if title:
        print(f"\n{line}\n  {title}\n{line}")
    else:
        print(line)


def ok(msg: str) -> None:
    print(f"  [OK]  {msg}")


def fail(msg: str) -> None:
    print(f"  [ERR] {msg}")


def info(msg: str) -> None:
    print(f"        {msg}")


# ── Step 0: verifica configurazione ──────────────────────────────────────────

sep("STEP 0 — Configurazione")

if not MT5_LOGIN or not MT5_PASSWORD or not MT5_SERVER:
    fail("MT5_LOGIN / MT5_PASSWORD / MT5_SERVER non impostati nello script.")
    fail("Apri test_mt5_diag.py e compila le variabili in cima al file.")
    sys.exit(1)

ok(f"Login: {MT5_LOGIN}  Server: {MT5_SERVER}")

# Risolve il percorso template
if MT5_TEMPLATE_PATH:
    template = Path(MT5_TEMPLATE_PATH)
else:
    template = Path(__file__).parent.parent / "mt5_template"

info(f"Template path: {template}")
if not (template / "terminal64.exe").exists():
    fail(f"terminal64.exe non trovato in {template}")
    fail("Il template MT5 non è configurato correttamente.")
    sys.exit(1)

ok("terminal64.exe trovato nel template")


# ── Step 1: importa la libreria MetaTrader5 ──────────────────────────────────

sep("STEP 1 — Import libreria MetaTrader5")

try:
    import MetaTrader5 as mt5
    ok(f"Libreria importata — versione: {mt5.__version__}")
except ImportError as e:
    fail(f"Impossibile importare MetaTrader5: {e}")
    fail("Esegui: pip install MetaTrader5")
    sys.exit(1)


# ── Step 2: initialize senza path (MT5 di sistema, se installato) ────────────

sep("STEP 2 — initialize() senza path (MT5 di sistema)")

info("Chiamo mt5.initialize() senza path e senza portable...")
mt5.shutdown()  # reset per sicurezza

t0 = time.time()
if mt5.initialize(timeout=10_000):
    elapsed = time.time() - t0
    ok(f"initialize() riuscito in {elapsed:.1f}s")
    build = mt5.terminal_info()
    if build:
        info(f"Terminal: {build.path}")
        info(f"Build:    {build.build}")
    mt5.shutdown()
else:
    code, msg = mt5.last_error()
    elapsed = time.time() - t0
    fail(f"initialize() fallito dopo {elapsed:.1f}s — {msg} (codice {code})")
    info("MT5 di sistema non disponibile (normale se usi solo la copia portable)")
    mt5.shutdown()


# ── Step 3: initialize con path del template ─────────────────────────────────

sep("STEP 3 — initialize() con il template (portable=True)")

terminal_path = str(template / "terminal64.exe")
info(f"Path: {terminal_path}")
info("Chiamo mt5.initialize(path=..., portable=True, timeout=30000) ...")

mt5.shutdown()
t0 = time.time()
if mt5.initialize(path=terminal_path, portable=True, timeout=30_000):
    elapsed = time.time() - t0
    ok(f"initialize() riuscito in {elapsed:.1f}s")
    tinfo = mt5.terminal_info()
    if tinfo:
        info(f"Terminal path: {tinfo.path}")
        info(f"Build:         {tinfo.build}")
        info(f"Connected:     {tinfo.connected}")
        info(f"Trade allowed: {tinfo.trade_allowed}")
else:
    code, msg = mt5.last_error()
    elapsed = time.time() - t0
    fail(f"initialize() fallito dopo {elapsed:.1f}s — {msg} (codice {code})")
    if code == -10005:
        info("IPC timeout: MT5 si avvia ma non risponde all'IPC.")
        info("Cause comuni:")
        info("  - Il processo gira in Session 0 (servizio Windows)")
        info("  - Antivirus blocca la named pipe")
        info("  - Il terminal64.exe nel template non è mai stato avviato a mano")
    elif code == -10001:
        info("IPC send failed: connessione IPC rotta o processo già terminato.")
    mt5.shutdown()
    sys.exit(1)


# ── Step 4: login ─────────────────────────────────────────────────────────────

sep("STEP 4 — login()")

info(f"Chiamo mt5.login({MT5_LOGIN}, server={MT5_SERVER!r}) ...")
t0 = time.time()
if mt5.login(MT5_LOGIN, password=MT5_PASSWORD, server=MT5_SERVER):
    elapsed = time.time() - t0
    ok(f"login() riuscito in {elapsed:.1f}s")
    acc = mt5.account_info()
    if acc:
        info(f"Nome:    {acc.name}")
        info(f"Server:  {acc.server}")
        info(f"Balance: {acc.balance} {acc.currency}")
        info(f"Equity:  {acc.equity} {acc.currency}")
        info(f"Leverage: 1:{acc.leverage}")
else:
    code, msg = mt5.last_error()
    elapsed = time.time() - t0
    fail(f"login() fallito dopo {elapsed:.1f}s — {msg} (codice {code})")
    mt5.shutdown()
    sys.exit(1)


# ── Step 5: simbolo di test ───────────────────────────────────────────────────

sep("STEP 5 — lettura simbolo EURUSD")

TEST_SYMBOL = "EURUSD"
info(f"Chiamo mt5.symbol_info({TEST_SYMBOL!r}) ...")
sym = mt5.symbol_info(TEST_SYMBOL)
if sym:
    ok(f"Simbolo trovato: {sym.name}")
    tick = mt5.symbol_info_tick(TEST_SYMBOL)
    if tick:
        info(f"Bid: {tick.bid}  Ask: {tick.ask}")
    else:
        fail("symbol_info_tick() ha restituito None")
else:
    fail(f"Simbolo {TEST_SYMBOL!r} non trovato — provo a selezionarlo...")
    mt5.symbol_select(TEST_SYMBOL, True)
    time.sleep(1)
    sym = mt5.symbol_info(TEST_SYMBOL)
    if sym:
        ok(f"Simbolo disponibile dopo symbol_select()")
    else:
        code, msg = mt5.last_error()
        fail(f"Simbolo non disponibile: {msg} (codice {code})")


# ── Cleanup ───────────────────────────────────────────────────────────────────

mt5.shutdown()

sep("RISULTATO")
ok("Tutti i passi superati — MT5 funziona correttamente in questo contesto.")
info("Se il server continua a dare timeout, il problema è nell'ambiente")
info("in cui gira il server (Session 0, permessi, processo separato, ecc.).")
sep()
