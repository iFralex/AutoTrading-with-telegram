"""
Diagnostica MT5 — flusso completamente automatizzato.

Eseguire DIRETTAMENTE sul VPS (non tramite server), in sessione RDP attiva.

Flusso:
  STEP 0  Configurazione e prerequisiti
  STEP 1  Import libreria MetaTrader5
  STEP 2  Copia template -> directory utente test
  STEP 3  Avvio MT5 + invio nome server (SendKeys) + chiusura
  STEP 4  Login via API Python (initialize con credenziali)
  STEP 5  BUY LIMIT a -10% del prezzo corrente, size 0.01
           (ordine pendente — cancellato subito dopo)
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


def _ensure_experts_enabled(mt5_dir: Path) -> None:
    """Scrive ExpertsEnabled=1 in config/common.ini.

    MT5 killato con taskkill /F non salva le modifiche in-memory al common.ini,
    quindi Ctrl+E non persiste su disco. Questa funzione lo scrive direttamente.
    """
    common_ini = mt5_dir / "config" / "common.ini"
    try:
        common_ini.parent.mkdir(parents=True, exist_ok=True)
        if common_ini.exists():
            text = common_ini.read_text(encoding="utf-8", errors="replace")
            if re.search(r"ExpertsEnabled\s*=\s*0", text):
                text = re.sub(r"ExpertsEnabled\s*=\s*0", "ExpertsEnabled=1", text)
                common_ini.write_text(text, encoding="utf-8")
                ok("ExpertsEnabled corretto a 1 in common.ini")
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
        warn(f"_ensure_experts_enabled: {e}")


def _get_mt5_pid_for_dir(mt5_dir: Path) -> int | None:
    """Trova il PID del processo terminal64.exe in esecuzione dalla directory."""
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
                return int(pid_str)
    except Exception:
        pass
    return None


def _kill_pid(pid: int) -> None:
    try:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                       capture_output=True, timeout=5)
    except Exception:
        pass


def _sendkeys_escape(s: str) -> str:
    """Escapa i caratteri speciali di WScript.Shell SendKeys."""
    special = {
        "+": "{+}", "^": "{^}", "%": "{%}", "~": "{~}",
        "{": "{{",  "}": "}}", "(": "{(}", ")": "{)}",
        "[": "{[}", "]": "{]}",
    }
    return "".join(special.get(c, c) for c in s)


def _send_server_and_enter(pid: int, server: str) -> bool:
    """
    Attende che la finestra MT5 sia visibile, poi invia:
      - il nome del server (il focus è già sul campo server)
      - Invio per confermare

    Usa PowerShell + WScript.Shell (sempre disponibile su Windows).
    """
    server_str = _sendkeys_escape(server)
    ps = f"""
Add-Type -AssemblyName Microsoft.VisualBasic

$proc = Get-Process -Id {pid} -ErrorAction SilentlyContinue
if (-not $proc) {{ exit 1 }}

# Attende finestra principale (max 30s)
$found = $false
for ($i = 0; $i -lt 30; $i++) {{
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne 0) {{
        $found = $true
        break
    }}
    Start-Sleep 1
}}
if (-not $found) {{ Write-Host "Nessuna finestra trovata"; exit 1 }}

# Porta la finestra in primo piano
try {{
    [Microsoft.VisualBasic.Interaction]::AppActivate({pid})
}} catch {{
    $s2 = New-Object -ComObject WScript.Shell
    $s2.AppActivate("MetaTrader 5") | Out-Null
}}
Start-Sleep -Milliseconds 600

$shell = New-Object -ComObject WScript.Shell
$shell.SendKeys("+{{TAB}}")       # Shift+Tab (1)
Start-Sleep -Milliseconds 150
$shell.SendKeys("+{{TAB}}")       # Shift+Tab (2)
Start-Sleep -Milliseconds 150
$shell.SendKeys("{server_str}")   # digita il nome del server
Start-Sleep -Milliseconds 300
$shell.SendKeys("{{ENTER}}")      # conferma
Start-Sleep -Milliseconds 800
$shell.SendKeys("{{ESC}}")        # chiude eventuali dialog residui
Start-Sleep -Milliseconds 400
$shell.SendKeys("^e")             # Ctrl+E -> attiva algo trading
Start-Sleep -Milliseconds 1000
exit 0
"""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        warn(f"SendKeys stderr: {result.stderr.strip()[:200]}")
    return result.returncode == 0


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
    info("Directory esistente, rimozione in corso...")
    shutil.rmtree(test_user_dir, ignore_errors=True)

try:
    shutil.copytree(template, test_user_dir)
    ok(f"Copiato in {test_user_dir}")
except Exception as e:
    fail(f"Copia fallita: {e}")
    sys.exit(1)

terminal_exe = str(test_user_dir / "terminal64.exe")


# ── Step 3: avvio MT5 + invio server + chiusura ───────────────────────────────

sep("STEP 3 — Avvio MT5 + invio server + chiusura")

info(f"Avvio: {terminal_exe} /portable")
try:
    proc = subprocess.Popen([terminal_exe, "/portable"])
    mt5_pid = proc.pid
    ok(f"MT5 avviato — PID {mt5_pid}")
except Exception as e:
    fail(f"Impossibile avviare MT5: {e}")
    shutil.rmtree(test_user_dir, ignore_errors=True)
    sys.exit(1)

info("Attendo 4s (startup MT5)...")
time.sleep(4.0)

info(f"Invio server '{MT5_SERVER}' + Invio...")
if _send_server_and_enter(mt5_pid, MT5_SERVER):
    ok("Tasti inviati")
else:
    warn("SendKeys ha restituito un errore — continuo comunque.")

info("Attendo 3s poi chiudo MT5...")
time.sleep(3.0)

_kill_pid(mt5_pid)
time.sleep(2.0)
ok("MT5 chiuso")

# taskkill /F non salva le modifiche in-memory: scriviamo ExpertsEnabled=1
# direttamente su disco prima di rilanciare MT5 via API.
_ensure_experts_enabled(test_user_dir)


# ── Step 4: login via API Python ─────────────────────────────────────────────

sep("STEP 4 — Login via API Python (initialize con credenziali)")

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

ORDER_REQUEST = {
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

result_order = mt5.order_send(ORDER_REQUEST)

# retcode 10027 = autotrading disabilitato dal client terminal.
# Riattiva Ctrl+E sulla finestra MT5 e riprova.
if result_order and result_order.retcode in (10017, 10027):
    warn(f"Trading disabilitato ({result_order.retcode}) — restart MT5 con ExpertsEnabled=1...")
    mt5.shutdown()
    current_pid = _get_mt5_pid_for_dir(test_user_dir)
    if current_pid:
        _kill_pid(current_pid)
        time.sleep(2.0)
    _ensure_experts_enabled(test_user_dir)
    reinit_ok = mt5.initialize(
        path=terminal_exe,
        portable=True,
        login=MT5_LOGIN,
        password=MT5_PASSWORD,
        server=MT5_SERVER,
        timeout=60_000,
    )
    if not reinit_ok:
        code, msg = mt5.last_error()
        fail(f"Reinizializzazione fallita: {msg} (codice {code})")
    else:
        tinfo = mt5.terminal_info()
        info(f"Trade allowed dopo restart: {tinfo.trade_allowed if tinfo else '?'}")
        result_order = mt5.order_send(ORDER_REQUEST)

if result_order and result_order.retcode == mt5.TRADE_RETCODE_DONE:
    ticket = result_order.order
    ok(f"BUY LIMIT piazzato — ticket #{ticket}  prezzo={entry_price}")
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
    shutil.rmtree(test_user_dir)
    ok(f"Directory test rimossa: {test_user_dir}")
except Exception as e:
    warn(f"Impossibile rimuovere {test_user_dir}: {e}")
    warn("Rimuovila manualmente.")


sep("RISULTATO")
ok("Tutti i passi superati.")
sep()
