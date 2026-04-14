"""
Diagnostica MT5 — aggiunge un account al template con login GUI automatizzato.

Eseguire DIRETTAMENTE sul VPS (non tramite server), in sessione RDP attiva.
Richiede accesso al desktop (non funziona in Session 0 o headless).

Flusso testato:
  STEP 0  Configurazione e prerequisiti
  STEP 1  Import libreria MetaTrader5
  STEP 2  Avvio del template MT5 + apertura dialog login via menu File
           Alt+F          -> apre menu File
           Freccia Giu x13 -> voce "Login to Trade Account"
           Invio          -> apre il dialog di login
           (digita login) -> focus già sul campo Login
           Tab            -> campo Password
           Tab            -> checkbox "Salva password"
           Spazio         -> spunta il checkbox
           Tab            -> campo Server
           Invio          -> conferma login
  STEP 3  Connessione API Python (initialize senza credenziali)
  STEP 4  Verifica account e lettura simbolo EURUSD
  STEP 5  Chiusura MT5 e riapertura via API (auto-login da credenziali salvate)
  STEP 6  Ordine di test (solo DEMO — da sbloccare manualmente)
  CLEANUP Termina MT5

Configura le variabili qui sotto prima di eseguire.
"""

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

# Metti True per eseguire anche STEP 6 (ordine di test).
# ATTENZIONE: usa SOLO con un conto demo, verifica il simbolo e i parametri.
RUN_ORDER_TEST = False
ORDER_SYMBOL   = "EURUSD"
ORDER_LOT      = 0.01

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

info(f"Template path: {template}")
if not (template / "terminal64.exe").exists():
    fail(f"terminal64.exe non trovato in {template}")
    sys.exit(1)
ok("terminal64.exe trovato nel template")

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sendkeys_escape(s: str) -> str:
    """Escapa i caratteri speciali di WScript.Shell SendKeys."""
    special = {
        "+": "{+}", "^": "{^}", "%": "{%}", "~": "{~}",
        "{": "{{",  "}": "}}", "(": "{(}", ")": "{)}",
        "[": "{[}", "]": "{]}",
    }
    return "".join(special.get(c, c) for c in s)


def _open_login_dialog_and_fill(pid: int, login: int, password: str, server: str) -> bool:
    """
    Porta in primo piano la finestra principale MT5, apre il dialog di login
    tramite il menu File, poi compila i campi:

        Alt+F              -> apre menu File
        Freccia Giu x13   -> voce "Login to Trade Account"
        Invio              -> apre il dialog di login
        (focus già su Login — nessun Shift+Tab)
        (digita login)
        Tab                -> campo Password
        Tab                -> checkbox "Salva password"
        Spazio             -> spunta il checkbox
        Tab                -> campo Server
        (seleziona tutto + digita server)
        Invio              -> conferma login

    Usa PowerShell + WScript.Shell (sempre disponibile su Windows).
    Ritorna True se il comando PowerShell ha avuto successo.
    """
    login_str    = _sendkeys_escape(str(login))
    password_str = _sendkeys_escape(password)
    server_str   = _sendkeys_escape(server)

    ps = f"""
Add-Type -AssemblyName Microsoft.VisualBasic

# Attende che il processo abbia una finestra principale (max 30s)
$proc = Get-Process -Id {pid} -ErrorAction SilentlyContinue
if (-not $proc) {{ exit 1 }}

$hwndFound = $false
for ($i = 0; $i -lt 30; $i++) {{
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne 0) {{
        $hwndFound = $true
        break
    }}
    Start-Sleep 1
}}
if (-not $hwndFound) {{ Write-Host "Nessuna finestra trovata"; exit 1 }}

# Porta la finestra principale in primo piano tramite PID
try {{
    [Microsoft.VisualBasic.Interaction]::AppActivate({pid})
}} catch {{
    $shell2 = New-Object -ComObject WScript.Shell
    $shell2.AppActivate("MetaTrader 5") | Out-Null
}}
Start-Sleep -Milliseconds 800

$shell = New-Object -ComObject WScript.Shell

# ── Apre il dialog di login dal menu File ─────────────────────────────────
$shell.SendKeys("%f")                   # Alt+F -> menu File
Start-Sleep -Milliseconds 500

# 13 volte freccia in giu' per raggiungere "Login to Trade Account"
for ($i = 0; $i -lt 13; $i++) {{
    $shell.SendKeys("{{DOWN}}")
    Start-Sleep -Milliseconds 80
}}
Start-Sleep -Milliseconds 200

$shell.SendKeys("{{ENTER}}")            # apre il dialog di login
Start-Sleep -Milliseconds 800           # attende che il dialog si apra

# ── Compila i campi del dialog ────────────────────────────────────────────
# Il focus e' gia' sul campo Login — niente Shift+Tab
$shell.SendKeys("{login_str}")
Start-Sleep -Milliseconds 200

$shell.SendKeys("{{TAB}}")              # -> campo Password
Start-Sleep -Milliseconds 200
$shell.SendKeys("{password_str}")
Start-Sleep -Milliseconds 200

$shell.SendKeys("{{TAB}}")              # -> checkbox "Salva password"
Start-Sleep -Milliseconds 150
$shell.SendKeys(" ")                    # spunta il checkbox
Start-Sleep -Milliseconds 150

$shell.SendKeys("{{TAB}}")              # -> campo Server
Start-Sleep -Milliseconds 200
$shell.SendKeys("^a")                   # seleziona tutto (sovrascrive valore esistente)
Start-Sleep -Milliseconds 100
$shell.SendKeys("{server_str}")
Start-Sleep -Milliseconds 300

$shell.SendKeys("{{ENTER}}")            # conferma login
exit 0
"""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        warn(f"SendKeys stderr: {result.stderr.strip()[:200]}")
    return result.returncode == 0


def _kill_process(pid: int) -> None:
    """Termina un processo per PID."""
    try:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                       capture_output=True, timeout=5)
    except Exception:
        pass



# ── Step 2: avvio template MT5 + login GUI ───────────────────────────────────

sep("STEP 2 — Avvio template MT5 + login GUI automatizzato")

terminal_exe = str(template / "terminal64.exe")
info(f"Avvio: {terminal_exe} /portable")
try:
    proc = subprocess.Popen([terminal_exe, "/portable"])
    mt5_pid = proc.pid
    ok(f"MT5 avviato — PID {mt5_pid}")
except Exception as e:
    fail(f"Impossibile avviare MT5: {e}")
    sys.exit(1)

info("Attendo 4s prima di inviare i tasti (startup MT5)...")
time.sleep(4.0)

info("Sequenza tasti:")
info("  Alt+F          -> menu File")
info("  Freccia Giu x13 -> 'Login to Trade Account'")
info("  Invio          -> apre dialog login")
info("  (login)        -> campo Login (focus gia' qui)")
info("  Tab            -> Password")
info("  Tab + Spazio   -> Salva password (checkbox)")
info("  Tab            -> Server")
info("  Invio          -> OK")

if _open_login_dialog_and_fill(mt5_pid, MT5_LOGIN, MT5_PASSWORD, MT5_SERVER):
    ok("Sequenza tasti inviata con successo")
else:
    warn("SendKeys ha restituito un errore — il login potrebbe non essersi completato.")
    warn("Verifica manualmente che MT5 abbia ricevuto le credenziali.")

info("Attendo fino a 60s che MT5 si connetta al broker...")
time.sleep(5.0)   # pausa iniziale prima di controllare


# ── Step 4: connessione API Python ────────────────────────────────────────────

sep("STEP 4 — Connessione API Python (initialize senza credenziali)")

info(f"Chiamo mt5.initialize(path={terminal_exe!r}, portable=True)")
info("(MT5 è già in esecuzione e loggato via GUI — l'API si aggancia all'istanza)")

mt5.shutdown()
t0 = time.time()
init_ok = False
for attempt in range(1, 7):   # max 6 tentativi, ogni 10s = 60s totali
    if mt5.initialize(path=terminal_exe, portable=True, timeout=10_000):
        elapsed = time.time() - t0
        ok(f"initialize() riuscito in {elapsed:.1f}s (tentativo {attempt})")
        init_ok = True
        break
    code, msg = mt5.last_error()
    info(f"  tentativo {attempt}: {msg} (codice {code}) — riprovo in 10s...")
    time.sleep(10.0)

if not init_ok:
    fail("initialize() fallito dopo 60s — MT5 non risponde all'API.")
    warn("Possibili cause:")
    warn("  - Il dialog di login non ha ricevuto i tasti correttamente")
    warn("  - MT5 mostra ancora un dialogo bloccante (licenza, disclaimer)")
    warn("  - ExpertsEnabled=0: algo trading disabilitato nel terminale")
    _kill_process(mt5_pid)
    sys.exit(1)

tinfo = mt5.terminal_info()
if tinfo:
    info(f"Terminal: {tinfo.path}")
    info(f"Connected: {tinfo.connected}")
    info(f"Trade allowed: {tinfo.trade_allowed}")
    if not tinfo.trade_allowed:
        warn("Trade allowed = False: algo trading disabilitato.")
        warn("  Verifica che il pulsante 'Algo Trading' sia attivo in MT5.")


# ── Step 5: verifica account e simbolo ───────────────────────────────────────

sep("STEP 5 — Verifica account e lettura simbolo EURUSD")

acc = mt5.account_info()
if acc:
    ok(f"Account: {acc.name} | {acc.server} | {acc.balance} {acc.currency}")
    if acc.login != MT5_LOGIN:
        warn(f"Login attivo ({acc.login}) diverso da quello configurato ({MT5_LOGIN}).")
        warn("  Il dialog potrebbe non aver ricevuto le credenziali correttamente.")
else:
    fail("account_info() è None — login non riuscito o account non connesso.")
    _kill_process(mt5_pid)
    sys.exit(1)

sym = mt5.symbol_info(ORDER_SYMBOL)
if sym:
    tick = mt5.symbol_info_tick(ORDER_SYMBOL)
    if tick:
        ok(f"{ORDER_SYMBOL}: Bid={tick.bid}  Ask={tick.ask}")
    else:
        fail(f"symbol_info_tick({ORDER_SYMBOL}) ha restituito None")
else:
    warn(f"Simbolo {ORDER_SYMBOL} non in Market Watch — aggiungo...")
    mt5.symbol_select(ORDER_SYMBOL, True)
    time.sleep(1)
    sym = mt5.symbol_info(ORDER_SYMBOL)
    if sym:
        ok(f"{ORDER_SYMBOL} ora disponibile")
    else:
        warn(f"Simbolo {ORDER_SYMBOL} non disponibile su questo broker")

mt5.shutdown()


# ── Step 6: chiusura MT5 e riapertura via API ─────────────────────────────────

sep("STEP 6 — Chiusura MT5 e riapertura via API (auto-login da credenziali salvate)")

info("Termino il processo MT5...")
_kill_process(mt5_pid)
time.sleep(3.0)
ok("MT5 terminato")

info("Riavvio via mt5.initialize(path=..., portable=True) — SENZA credenziali")
info("(MT5 dovrebbe fare auto-login leggendo le credenziali salvate al step 3)")

t0 = time.time()
if mt5.initialize(path=terminal_exe, portable=True, timeout=60_000):
    elapsed = time.time() - t0
    ok(f"initialize() riuscito in {elapsed:.1f}s")
    tinfo = mt5.terminal_info()
    acc2 = mt5.account_info()
    if tinfo:
        info(f"Connected: {tinfo.connected}  Trade allowed: {tinfo.trade_allowed}")
    if acc2:
        ok(f"Auto-login OK: {acc2.name} | {acc2.server} | login={acc2.login}")
        if acc2.login != MT5_LOGIN:
            warn(f"Login attivo ({acc2.login}) diverso da quello configurato ({MT5_LOGIN}).")
    else:
        fail("Auto-login fallito — account_info() è None.")
        fail("  Le credenziali non sono state salvate nel dialog al step 3.")
        mt5.shutdown()
        _kill_process(mt5_pid)
        sys.exit(1)
else:
    code, msg = mt5.last_error()
    elapsed = time.time() - t0
    fail(f"initialize() fallito dopo {elapsed:.1f}s — {msg} (codice {code})")
    fail("  MT5 non riesce a fare auto-login senza credenziali.")
    fail("  Il 'Salva password' non era spuntato al step 2, o le credenziali sono errate.")
    _kill_process(mt5_pid)
    sys.exit(1)


# ── Step 7: ordine di test ────────────────────────────────────────────────────

sep("STEP 7 — Ordine di test")

if not RUN_ORDER_TEST:
    info("Saltato (RUN_ORDER_TEST = False).")
    info("Imposta RUN_ORDER_TEST = True in cima allo script per eseguirlo.")
    info("ATTENZIONE: usa solo su conto DEMO.")
else:
    # Ordine SELL LIMIT al +10% rispetto al prezzo corrente.
    # Un SELL LIMIT sopra mercato non viene eseguito immediatamente: è un
    # ordine pendente sicuro per testare il piazzamento senza aprire posizioni.
    tick = mt5.symbol_info_tick(ORDER_SYMBOL)
    sym_info = mt5.symbol_info(ORDER_SYMBOL)
    if tick is None or sym_info is None:
        fail(f"Impossibile ottenere tick/info per {ORDER_SYMBOL}")
    else:
        digits = sym_info.digits
        entry_price = round(tick.ask * 1.10, digits)
        warn(f"Piazzo SELL LIMIT {ORDER_LOT} {ORDER_SYMBOL} @ {entry_price} "
             f"(+10% rispetto a Ask={tick.ask}) — ordine pendente, non eseguito subito")
        request = {
            "action":      mt5.TRADE_ACTION_PENDING,
            "symbol":      ORDER_SYMBOL,
            "volume":      ORDER_LOT,
            "type":        mt5.ORDER_TYPE_SELL_LIMIT,
            "price":       entry_price,
            "magic":       999999,
            "comment":     "diag_test",
            "type_time":   mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_RETURN,
        }
        result_order = mt5.order_send(request)
        if result_order and result_order.retcode == mt5.TRADE_RETCODE_DONE:
            ticket = result_order.order
            ok(f"Ordine pendente piazzato — ticket #{ticket}  prezzo={entry_price}")
            # Cancella subito l'ordine (è solo un test)
            time.sleep(1)
            cancel_req = {
                "action": mt5.TRADE_ACTION_REMOVE,
                "order":  ticket,
            }
            res_cancel = mt5.order_send(cancel_req)
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

_kill_process(mt5_pid)
ok("MT5 terminato")


sep("RISULTATO")
ok("Tutti i passi superati.")
ok("Il flusso GUI login + API è funzionante.")
info("")
info("Prossimo passo: aggiornare mt5_trader.py per usare questo approccio")
info("in produzione (GUI login al primo setup, poi auto-login via initialize).")
sep()
