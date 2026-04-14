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


# ── Step 2: pre-flight (ExpertsEnabled + kill processi residui) ──────────────

sep("STEP 2 — Pre-flight: ExpertsEnabled=1 + kill MT5 residuo")

import re as _re
import subprocess as _subprocess

def _ensure_experts_enabled_diag(mt5_dir: Path) -> None:
    common_ini = mt5_dir / "config" / "common.ini"
    try:
        common_ini.parent.mkdir(parents=True, exist_ok=True)
        if common_ini.exists():
            text = common_ini.read_text(encoding="utf-8", errors="replace")
            if _re.search(r"ExpertsEnabled\s*=\s*0", text):
                text = _re.sub(r"ExpertsEnabled\s*=\s*0", "ExpertsEnabled=1", text)
                common_ini.write_text(text, encoding="utf-8")
                ok("ExpertsEnabled corretto da 0 a 1 in common.ini")
            elif "ExpertsEnabled" not in text:
                if "[Common]" in text:
                    text = text.replace("[Common]", "[Common]\r\nExpertsEnabled=1", 1)
                else:
                    text = "[Common]\r\nExpertsEnabled=1\r\n" + text
                common_ini.write_text(text, encoding="utf-8")
                ok("ExpertsEnabled=1 aggiunto a common.ini")
            else:
                ok("ExpertsEnabled=1 già presente in common.ini")
        else:
            common_ini.write_text("[Common]\r\nExpertsEnabled=1\r\n", encoding="utf-8")
            ok("common.ini creato con ExpertsEnabled=1")
    except Exception as e:
        fail(f"Impossibile aggiornare common.ini: {e}")


def _kill_mt5_diag(mt5_dir: Path) -> None:
    try:
        result = _subprocess.run(
            ["wmic", "process", "where", "name='terminal64.exe'",
             "get", "ProcessId,ExecutablePath", "/format:csv"],
            capture_output=True, text=True, timeout=10,
        )
        target = str(mt5_dir).lower().rstrip("\\")
        killed_any = False
        for line in result.stdout.splitlines():
            parts = line.strip().split(",")
            if len(parts) < 3:
                continue
            exe_path = parts[1].strip().lower().rstrip("\\")
            pid_str = parts[2].strip()
            if exe_path.startswith(target) and pid_str.isdigit():
                _subprocess.run(["taskkill", "/PID", pid_str, "/F"],
                                capture_output=True, timeout=5)
                ok(f"MT5 PID {pid_str} terminato")
                killed_any = True
        if not killed_any:
            ok("Nessun processo MT5 in esecuzione dalla directory template")
        else:
            info("Attendo 2s per la chiusura completa...")
            time.sleep(2.0)
    except Exception as e:
        fail(f"Kill MT5: {e}")


_ensure_experts_enabled_diag(template)
_kill_mt5_diag(template)


# ── Step 3+4: initialize con credenziali (startup + login in un'unica chiamata) ─

sep("STEP 3 — initialize() + login() in una sola chiamata")

terminal_path = str(template / "terminal64.exe")
info(f"Path:   {terminal_path}")
info(f"Login:  {MT5_LOGIN}  Server: {MT5_SERVER}")
info("Chiamo mt5.initialize(path, portable=True, login, password, server, timeout=60s)")
info("(startup + login atomico: evita IPC disruption da server switch)")

mt5.shutdown()
t0 = time.time()
if mt5.initialize(
    path=terminal_path,
    portable=True,
    login=MT5_LOGIN,
    password=MT5_PASSWORD,
    server=MT5_SERVER,
    timeout=60_000,
):
    elapsed = time.time() - t0
    ok(f"initialize() riuscito in {elapsed:.1f}s")
    tinfo = mt5.terminal_info()
    if tinfo:
        info(f"Terminal path: {tinfo.path}")
        info(f"Build:         {tinfo.build}")
        info(f"Connected:     {tinfo.connected}")
        info(f"Trade allowed: {tinfo.trade_allowed}")
        if not tinfo.trade_allowed:
            print()
            fail("Trade allowed = False: algo trading disabilitato nel terminale.")
            info("  Riesegui setup.ps1 — imposta ExpertsEnabled=1 in common.ini")
            print()
    acc = mt5.account_info()
    if acc:
        ok(f"Login confermato: {acc.name} | {acc.server} | {acc.balance} {acc.currency}")
    else:
        fail("initialize() OK ma account_info() e' None — login non riuscito.")
        mt5.shutdown()
        sys.exit(1)
else:
    code, msg = mt5.last_error()
    elapsed = time.time() - t0
    fail(f"initialize() fallito dopo {elapsed:.1f}s — {msg} (codice {code})")
    if code == -10005:
        info("IPC timeout: MT5 avviato ma non completa startup+login entro 60s.")
        info("Possibili cause:")
        info("  - La VPS non raggiunge il server '" + MT5_SERVER + "'")
        info("  - Nome server errato (controlla maiuscole/spazi)")
        info("  - MT5 mostra un dialogo bloccante (antivirus, update, disclaimer)")
    elif code == -10001:
        info("IPC send failed: processo MT5 crashato durante l'avvio.")
    mt5.shutdown()
    sys.exit(1)


# ── Step 5: simbolo di test ───────────────────────────────────────────────────

sep("STEP 4 — lettura simbolo EURUSD")

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
