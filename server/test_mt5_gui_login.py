"""
Diagnostica MT5 — simula setup nuovo utente con login GUI automatizzato.

Eseguire DIRETTAMENTE sul VPS (non tramite server), in sessione RDP attiva.
Richiede accesso al desktop (non funziona in Session 0 o headless).

Flusso testato:
  STEP 0  Configurazione e prerequisiti
  STEP 1  Import libreria MetaTrader5
  STEP 2  Copia template -> directory utente test (login resettato)
  STEP 3  Avvio MT5 + login GUI automatizzato via SendKeys
           Shift+Tab  -> campo Login
           Tab        -> campo Password
           Tab        -> checkbox "Salva password"
           Spazio     -> spunta il checkbox
           Tab        -> campo Server
           Invio      -> conferma login
  STEP 4  Connessione API Python (initialize senza credenziali)
  STEP 5  Verifica account e lettura simbolo EURUSD
  STEP 6  Chiusura MT5 e riapertura via API (auto-login da credenziali salvate)
  STEP 7  Ordine di test (solo DEMO — da sbloccare manualmente)
  CLEANUP Termina MT5 e rimuove directory test

Configura le variabili qui sotto prima di eseguire.
"""

import re
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

# Directory dove creare la copia di test (lascia None per usare il default).
MT5_TEST_USER_DIR: str | None = None

# Metti True per eseguire anche STEP 7 (ordine di test).
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

if MT5_TEST_USER_DIR:
    test_user_dir = Path(MT5_TEST_USER_DIR)
else:
    test_user_dir = template.parent / "mt5_users" / "test_diag_user"
    if not test_user_dir.parent.exists():
        test_user_dir = Path(__file__).parent.parent / "mt5_users" / "test_diag_user"

info(f"Directory test utente: {test_user_dir}")

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


def _activate_and_send_login(pid: int, login: int, password: str, server: str) -> bool:
    """
    Porta in primo piano la finestra MT5 (tramite PID) e invia la sequenza
    di tasti per compilare il dialog di login:
        Shift+Tab  -> campo Login
        Tab        -> campo Password
        Tab        -> checkbox "Salva password"
        Spazio     -> spunta il checkbox
        Tab        -> campo Server (dropdown)
        Invio      -> OK

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

# Porta la finestra in primo piano tramite PID
try {{
    [Microsoft.VisualBasic.Interaction]::AppActivate({pid})
}} catch {{
    # Fallback: titolo finestra
    $shell2 = New-Object -ComObject WScript.Shell
    $shell2.AppActivate("MetaTrader 5") | Out-Null
}}
Start-Sleep -Milliseconds 800

# Invia la sequenza di tasti per il dialog di login
$shell = New-Object -ComObject WScript.Shell

$shell.SendKeys("+{{TAB}}")              # Shift+Tab -> campo Login
Start-Sleep -Milliseconds 400
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
# Seleziona tutto e sovrascrivi (il campo potrebbe avere un valore precedente)
$shell.SendKeys("^a")
Start-Sleep -Milliseconds 100
$shell.SendKeys("{server_str}")
Start-Sleep -Milliseconds 300

$shell.SendKeys("{{ENTER}}")            # Conferma login
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


def _kill_mt5_from_dir(mt5_dir: Path) -> None:
    """Termina tutti i processi terminal64.exe in esecuzione dalla directory."""
    try:
        result = subprocess.run(
            ["wmic", "process", "where", "name='terminal64.exe'",
             "get", "ProcessId,ExecutablePath", "/format:csv"],
            capture_output=True, text=True, timeout=10,
        )
        target = str(mt5_dir).lower().rstrip("\\")
        for line in result.stdout.splitlines():
            parts = line.strip().split(",")
            if len(parts) < 3:
                continue
            exe_path = parts[1].strip().lower().rstrip("\\")
            pid_str = parts[2].strip()
            if exe_path.startswith(target) and pid_str.isdigit():
                subprocess.run(["taskkill", "/PID", pid_str, "/F"],
                               capture_output=True, timeout=5)
                info(f"MT5 PID {pid_str} terminato")
    except Exception as e:
        warn(f"Kill MT5: {e}")


def _reset_login_in_config(mt5_dir: Path) -> None:
    """
    Rimuove/azzera il Login salvato in common.ini e imposta ExpertsEnabled=1.
    Questo forza la comparsa del dialog di login al prossimo avvio di MT5
    (invece di fare auto-login con le credenziali del template).
    """
    common_ini = mt5_dir / "config" / "common.ini"
    try:
        if common_ini.exists():
            text = common_ini.read_text(encoding="utf-8", errors="replace")
            # Azzera Login (forza il dialog)
            text = re.sub(r"Login\s*=\s*\d+", "Login=0", text)
            # Garantisce ExpertsEnabled=1
            if re.search(r"ExpertsEnabled\s*=\s*0", text):
                text = re.sub(r"ExpertsEnabled\s*=\s*0", "ExpertsEnabled=1", text)
            elif "ExpertsEnabled" not in text:
                if "[Common]" in text:
                    text = text.replace("[Common]", "[Common]\r\nExpertsEnabled=1", 1)
                else:
                    text = "[Common]\r\nExpertsEnabled=1\r\n" + text
            common_ini.write_text(text, encoding="utf-8")
        else:
            common_ini.parent.mkdir(parents=True, exist_ok=True)
            common_ini.write_text("[Common]\r\nLogin=0\r\nExpertsEnabled=1\r\n",
                                  encoding="utf-8")
    except Exception as e:
        warn(f"_reset_login_in_config: {e}")


# ── Step 2: copia template → directory test ───────────────────────────────────

sep("STEP 2 — Copia template → directory utente test")

if test_user_dir.exists():
    info(f"Directory esistente, rimozione: {test_user_dir}")
    shutil.rmtree(test_user_dir, ignore_errors=True)

try:
    shutil.copytree(template, test_user_dir)
    ok(f"Copiato in {test_user_dir}")
except Exception as e:
    fail(f"Copia fallita: {e}")
    sys.exit(1)

# Resetta il login salvato nel template (forza il dialog di login)
_reset_login_in_config(test_user_dir)
ok("Login resettato in common.ini (forza il dialog al primo avvio)")

terminal_exe = str(test_user_dir / "terminal64.exe")


# ── Step 3: avvio MT5 + login GUI ────────────────────────────────────────────

sep("STEP 3 — Avvio MT5 + login GUI automatizzato")

info(f"Avvio: {terminal_exe} /portable")
try:
    proc = subprocess.Popen([terminal_exe, "/portable"])
    mt5_pid = proc.pid
    ok(f"MT5 avviato — PID {mt5_pid}")
except Exception as e:
    fail(f"Impossibile avviare MT5: {e}")
    shutil.rmtree(test_user_dir, ignore_errors=True)
    sys.exit(1)

info("Attendo 4s prima di inviare i tasti (startup MT5)...")
time.sleep(4.0)

info("Invio sequenza tasti al dialog di login:")
info("  Shift+Tab -> Login")
info("  Tab       -> Password")
info("  Tab+Space -> Salva password (checkbox)")
info("  Tab       -> Server")
info("  Invio     -> OK")

if _activate_and_send_login(mt5_pid, MT5_LOGIN, MT5_PASSWORD, MT5_SERVER):
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
    shutil.rmtree(test_user_dir, ignore_errors=True)
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
    shutil.rmtree(test_user_dir, ignore_errors=True)
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
        _kill_mt5_from_dir(test_user_dir)
        shutil.rmtree(test_user_dir, ignore_errors=True)
        sys.exit(1)
else:
    code, msg = mt5.last_error()
    elapsed = time.time() - t0
    fail(f"initialize() fallito dopo {elapsed:.1f}s — {msg} (codice {code})")
    fail("  MT5 non riesce a fare auto-login senza credenziali.")
    fail("  Il 'Salva password' non era spuntato al step 3, o le credenziali sono errate.")
    _kill_mt5_from_dir(test_user_dir)
    shutil.rmtree(test_user_dir, ignore_errors=True)
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

_kill_mt5_from_dir(test_user_dir)
time.sleep(1)

try:
    shutil.rmtree(test_user_dir)
    ok(f"Directory test rimossa: {test_user_dir}")
except Exception as e:
    warn(f"Impossibile rimuovere {test_user_dir}: {e}")
    warn("Rimuovila manualmente.")


sep("RISULTATO")
ok("Tutti i passi superati.")
ok("Il flusso GUI login + API è funzionante.")
info("")
info("Prossimo passo: aggiornare mt5_trader.py per usare questo approccio")
info("in produzione (GUI login al primo setup, poi auto-login via initialize).")
sep()
