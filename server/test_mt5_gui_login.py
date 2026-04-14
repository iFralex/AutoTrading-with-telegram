"""
Diagnostica MT5 — copia template in directory utente, setup manuale server,
poi login e ordine tramite API Python.

Eseguire DIRETTAMENTE sul VPS (non tramite server), in sessione RDP attiva.

Flusso:
  STEP 0  Configurazione e prerequisiti
  STEP 1  Import libreria MetaTrader5
  STEP 2  Copia template -> directory utente test (login resettato)
  STEP 3  Avvio MT5 — azione manuale richiesta:
           - scrivi il nome del server nel campo già focalizzato
           - Tab -> invio
           - chiudi MT5
           Poi premi Invio nello script per continuare.
  STEP 4  Login via API Python (initialize con credenziali)
  STEP 5  BUY LIMIT a -10% del prezzo corrente, size 0.01
           (ordine pendente — cancellato subito dopo)
  CLEANUP Termina MT5 e rimuove directory test

Configura le variabili qui sotto prima di eseguire.
"""

import shutil
import subprocess
import sys
import time
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURA QUESTI VALORI PRIMA DI ESEGUIRE
# ─────────────────────────────────────────────────────────────────────────────

MT5_LOGIN    = 0        # es. 12345678
MT5_PASSWORD = ""       # es. "password123"
MT5_SERVER   = ""       # es. "ICMarkets-Demo"

# Percorso al template MT5 (la cartella con terminal64.exe già configurato).
# Lascia None per usare il percorso default del bot.
MT5_TEMPLATE_PATH: str | None = None

# Simbolo e lotto per il test ordine (STEP 5).
ORDER_SYMBOL = "EURUSD"
ORDER_LOT    = 0.01

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


def warn(msg: str) -> None:
    print(f"  [!!]  {msg}")


# ── Step 0: configurazione ────────────────────────────────────────────────────

sep("STEP 0 — Configurazione")

if not MT5_LOGIN or not MT5_PASSWORD or not MT5_SERVER:
    fail("MT5_LOGIN / MT5_PASSWORD / MT5_SERVER non impostati.")
    fail("Apri test_mt5_gui_login.py e compila le variabili in cima al file.")
    sys.exit(1)

ok(f"Login: {MT5_LOGIN}  Server: {MT5_SERVER}")

if MT5_TEMPLATE_PATH:
    template = Path(MT5_TEMPLATE_PATH)
else:
    template = Path(__file__).parent.parent / "mt5_template"
    if not template.exists():
        template = Path(r"C:\TradingBot\mt5_template")

info(f"Template: {template}")
if not (template / "terminal64.exe").exists():
    fail(f"terminal64.exe non trovato in {template}")
    sys.exit(1)
ok("terminal64.exe trovato nel template")

test_user_dir = template.parent / "mt5_users" / "test_diag_user"
info(f"Directory utente test: {test_user_dir}")

if sys.platform != "win32":
    fail("Questo script richiede Windows con MT5 installato.")
    sys.exit(1)
ok("Piattaforma Windows rilevata")


# ── Step 1: import libreria ───────────────────────────────────────────────────

sep("STEP 1 — Import libreria MetaTrader5")

try:
    import MetaTrader5 as mt5
    ok(f"Libreria importata — versione: {mt5.__version__}")
except ImportError as e:
    fail(f"Impossibile importare MetaTrader5: {e}")
    sys.exit(1)


# ── Step 2: copia template → directory utente test ────────────────────────────

sep("STEP 2 — Copia template → directory utente test")

if test_user_dir.exists():
    info(f"Directory esistente, rimozione in corso...")
    shutil.rmtree(test_user_dir, ignore_errors=True)

try:
    shutil.copytree(template, test_user_dir)
    ok(f"Copiato in {test_user_dir}")
except Exception as e:
    fail(f"Copia fallita: {e}")
    sys.exit(1)

terminal_exe = str(test_user_dir / "terminal64.exe")


# ── Step 3: avvio MT5 — azione manuale ───────────────────────────────────────

sep("STEP 3 — Avvio MT5 — azione manuale richiesta")

info(f"Avvio MT5: {terminal_exe}")
try:
    proc = subprocess.Popen([terminal_exe, "/portable"])
    mt5_pid = proc.pid
    ok(f"MT5 avviato — PID {mt5_pid}")
except Exception as e:
    fail(f"Impossibile avviare MT5: {e}")
    shutil.rmtree(test_user_dir, ignore_errors=True)
    sys.exit(1)

print()
print("  ┌─────────────────────────────────────────────────────┐")
print("  │  AZIONE RICHIESTA                                   │")
print("  │                                                     │")
print(f"  │  1. Nel campo gia' focalizzato digita il server:   │")
print(f"  │     {MT5_SERVER:<49}│")
print("  │  2. Premi Tab                                       │")
print("  │  3. Premi Invio                                     │")
print("  │  4. Chiudi MT5                                      │")
print("  └─────────────────────────────────────────────────────┘")
print()
input("  Quando hai chiuso MT5, premi Invio qui per continuare... ")
print()


# ── Step 4: login via API Python ─────────────────────────────────────────────

sep("STEP 4 — Login via API Python (initialize con credenziali)")

info(f"Path:   {terminal_exe}")
info(f"Login:  {MT5_LOGIN}  Server: {MT5_SERVER}")
info("Chiamo mt5.initialize(path, portable=True, login, password, server, timeout=60s)")

mt5.shutdown()
t0 = time.time()
init_ok = False
for attempt in range(1, 4):
    if attempt > 1:
        mt5.shutdown()
        time.sleep(10.0)
    if mt5.initialize(
        path=terminal_exe,
        portable=True,
        login=MT5_LOGIN,
        password=MT5_PASSWORD,
        server=MT5_SERVER,
        timeout=60_000,
    ):
        elapsed = time.time() - t0
        ok(f"initialize() riuscito in {elapsed:.1f}s (tentativo {attempt})")
        init_ok = True
        break
    code, msg = mt5.last_error()
    warn(f"Tentativo {attempt}/3: {msg} (codice {code})")

if not init_ok:
    fail("initialize() fallito dopo 3 tentativi.")
    shutil.rmtree(test_user_dir, ignore_errors=True)
    sys.exit(1)

tinfo = mt5.terminal_info()
if tinfo:
    info(f"Connected:     {tinfo.connected}")
    info(f"Trade allowed: {tinfo.trade_allowed}")

acc = mt5.account_info()
if acc:
    ok(f"Account: {acc.name} | {acc.server} | {acc.balance} {acc.currency}")
else:
    fail("account_info() è None — login non riuscito.")
    mt5.shutdown()
    shutil.rmtree(test_user_dir, ignore_errors=True)
    sys.exit(1)


# ── Step 5: BUY LIMIT a -10% del prezzo corrente ─────────────────────────────

sep("STEP 5 — BUY LIMIT a -10% del prezzo corrente")

sym_info = mt5.symbol_info(ORDER_SYMBOL)
if sym_info is None:
    info(f"Simbolo {ORDER_SYMBOL} non in Market Watch — aggiungo...")
    mt5.symbol_select(ORDER_SYMBOL, True)
    time.sleep(1)
    sym_info = mt5.symbol_info(ORDER_SYMBOL)

if sym_info is None:
    fail(f"Simbolo {ORDER_SYMBOL} non disponibile su questo broker.")
    mt5.shutdown()
    shutil.rmtree(test_user_dir, ignore_errors=True)
    sys.exit(1)

tick = mt5.symbol_info_tick(ORDER_SYMBOL)
if tick is None:
    fail(f"Impossibile ottenere il tick per {ORDER_SYMBOL}.")
    mt5.shutdown()
    shutil.rmtree(test_user_dir, ignore_errors=True)
    sys.exit(1)

digits = sym_info.digits
entry_price = round(tick.bid * 0.90, digits)
info(f"Bid corrente: {tick.bid}  Entry BUY LIMIT: {entry_price} (-10%)")

request = {
    "action":       mt5.TRADE_ACTION_PENDING,
    "symbol":       ORDER_SYMBOL,
    "volume":       ORDER_LOT,
    "type":         mt5.ORDER_TYPE_BUY_LIMIT,
    "price":        entry_price,
    "magic":        999999,
    "comment":      "diag_test",
    "type_time":    mt5.ORDER_TIME_GTC,
    "type_filling": mt5.ORDER_FILLING_RETURN,
}

result_order = mt5.order_send(request)
if result_order and result_order.retcode == mt5.TRADE_RETCODE_DONE:
    ticket = result_order.order
    ok(f"BUY LIMIT piazzato — ticket #{ticket}  prezzo={entry_price}")
    # Cancella subito (è solo un test)
    time.sleep(1)
    res_cancel = mt5.order_send({
        "action": mt5.TRADE_ACTION_REMOVE,
        "order":  ticket,
    })
    if res_cancel and res_cancel.retcode == mt5.TRADE_RETCODE_DONE:
        ok(f"Ordine #{ticket} cancellato correttamente")
    else:
        warn(f"Cancellazione fallita: retcode={getattr(res_cancel, 'retcode', '?')} "
             f"— {getattr(res_cancel, 'comment', '?')}")
        warn(f"  Cancella manualmente l'ordine #{ticket} da MT5.")
else:
    fail(f"Ordine fallito: retcode={getattr(result_order, 'retcode', '?')} "
         f"— {getattr(result_order, 'comment', '?')}")

mt5.shutdown()


# ── Cleanup ───────────────────────────────────────────────────────────────────

sep("CLEANUP")

try:
    subprocess.run(["taskkill", "/PID", str(mt5_pid), "/F"],
                   capture_output=True, timeout=5)
except Exception:
    pass
time.sleep(1)

try:
    shutil.rmtree(test_user_dir)
    ok(f"Directory test rimossa: {test_user_dir}")
except Exception as e:
    warn(f"Impossibile rimuovere {test_user_dir}: {e}")
    warn("Rimuovila manualmente.")


sep("RISULTATO")
ok("Tutti i passi superati.")
sep()
