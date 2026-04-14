#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Setup iniziale Trading Bot su Windows Server 2025.
    Eseguire UNA SOLA VOLTA come Administrator dopo il provisioning della VPS.

.PARAMETER InstallDir
    Cartella radice del bot. Default: C:\TradingBot

.PARAMETER PythonVersion
    Versione Python da installare se non presente. Default: 3.12.4

.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -InstallDir "D:\TradingBot"
#>

param(
    [string]$InstallDir    = "C:\TradingBot",
    [string]$PythonVersion = "3.12.4"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── helpers ──────────────────────────────────────────────────────────────────

function Write-Step([string]$Msg) {
    Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] $Msg" -ForegroundColor Cyan
}
function Write-OK([string]$Msg) {
    Write-Host "  OK  $Msg" -ForegroundColor Green
}
function Write-Warn([string]$Msg) {
    Write-Host "  !!  $Msg" -ForegroundColor Yellow
}

# ── 1. Python ────────────────────────────────────────────────────────────────

Write-Step "Verifica Python..."

# Get-Command trova anche l'alias trappola del Microsoft Store (WindowsApps).
# Consideriamo Python "reale" solo se il percorso non punta a WindowsApps.
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
$pythonReal = $pythonCmd -and ($pythonCmd.Source -notlike "*WindowsApps*")

if (-not $pythonReal) {
    Write-Warn "Python non trovato (o solo alias Store). Download di Python $PythonVersion..."
    $url       = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe"
    $installer = "$env:TEMP\python_setup.exe"
    Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
    Start-Process -FilePath $installer `
        -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1" `
        -Wait
    # Ricarica PATH senza riavviare la shell
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Remove-Item $installer -Force
    Write-OK "Python $PythonVersion installato"
} else {
    Write-OK "Python gia' presente: $(python --version 2>&1)"
}

# ── 2. Struttura directory ───────────────────────────────────────────────────

Write-Step "Creazione struttura directory in $InstallDir ..."

$dirs = @(
    "$InstallDir",
    "$InstallDir\bot",            # codice sorgente
    "$InstallDir\sessions",       # file .session Telethon (uno per utente)
    "$InstallDir\mt5_template",   # installazione MT5 portable configurata
    "$InstallDir\mt5_users",      # copie MT5 per ogni utente
    "$InstallDir\logs",           # log rotanti
    "$InstallDir\data"            # database SQLite
)

foreach ($d in $dirs) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    Write-OK $d
}

# ── 3. Copia codice sorgente ─────────────────────────────────────────────────

Write-Step "Copia codice sorgente..."

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

# Esclude artefatti inutili sul server
$exclude = @("__pycache__", "*.pyc", "*.session", "*.sessio", ".git", "gui")

Get-ChildItem -Path $sourceRoot -Exclude $exclude | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination "$InstallDir\bot\" -Recurse -Force
}
Write-OK "Sorgenti copiati in $InstallDir\bot"

# ── 4. Dipendenze Python ─────────────────────────────────────────────────────

Write-Step "Installazione dipendenze Python..."

$req = "$InstallDir\bot\vps\requirements.txt"
pip install -r $req --quiet --no-warn-script-location
Write-OK "Pacchetti installati"

# ── 5. File .env ─────────────────────────────────────────────────────────────

Write-Step "Configurazione .env..."

$envDest = "$InstallDir\bot\vps\.env"
$envExmp = "$InstallDir\bot\vps\.env.example"

if (-not (Test-Path $envDest)) {
    Copy-Item $envExmp $envDest
    # Genera una chiave di cifratura Fernet casuale
    $key = python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    (Get-Content $envDest) -replace "ENCRYPTION_KEY=.*", "ENCRYPTION_KEY=$key" |
        Set-Content $envDest
    Write-OK ".env creato con chiave di cifratura generata"
    Write-Warn "Apri $envDest e configura le variabili rimanenti"
} else {
    Write-OK ".env gia' presente, non sovrascritto"
}

# ── 6. MT5 template (portable, automatico) ───────────────────────────────────

Write-Step "Installazione MT5 in modalita' portable..."

$mt5Template  = "$InstallDir\mt5_template"
$mt5Exe       = "$mt5Template\terminal64.exe"
$mt5Installer = "$env:TEMP\mt5setup.exe"

if (Test-Path $mt5Exe) {
    Write-OK "MT5 template gia' presente, saltato"
} else {
    # 6a. Download installer MetaQuotes (versione generica, broker-agnostic)
    Write-Warn "Download MT5 installer da MetaQuotes..."
    $mt5Url = "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe"
    Invoke-WebRequest -Uri $mt5Url -OutFile $mt5Installer -UseBasicParsing
    Write-OK "Download completato"

    # 6b. Installa in una cartella temporanea, poi copia in mt5_template
    # /auto = installazione silenziosa; /InstallPath non e' supportato
    # quindi installiamo nel percorso default e copiamo
    $mt5DefaultPath = "$env:ProgramFiles\MetaTrader 5"
    Write-Warn "Installazione silenziosa MT5 (potrebbe richiedere 1-2 minuti)..."
    Start-Process -FilePath $mt5Installer -ArgumentList "/auto" -Wait
    Remove-Item $mt5Installer -Force

    # 6c. Cerca terminal64.exe nell'installazione (percorso default o subdirectory)
    $foundExe = Get-ChildItem -Path $mt5DefaultPath -Filter "terminal64.exe" `
                              -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1

    if (-not $foundExe) {
        # Fallback: cerca in tutto Program Files
        $foundExe = Get-ChildItem -Path "$env:ProgramFiles" -Filter "terminal64.exe" `
                                  -Recurse -ErrorAction SilentlyContinue |
                    Select-Object -First 1
    }

    if (-not $foundExe) {
        Write-Warn "terminal64.exe non trovato dopo l'installazione."
        Write-Warn "Installa MT5 manualmente in $mt5Template e rilancia setup.ps1"
    } else {
        # 6d. Copia l'intera cartella di installazione in mt5_template
        $sourceDir = $foundExe.DirectoryName
        Write-Warn "Copia MT5 in modalita' portable: $sourceDir -> $mt5Template"
        Copy-Item -Path "$sourceDir\*" -Destination $mt5Template -Recurse -Force
        Write-OK "MT5 copiato in $mt5Template"
    }
}

# 6e. Crea config portable con trading algoritmico abilitato
$mt5ConfigDir = "$mt5Template\config"
New-Item -ItemType Directory -Force -Path $mt5ConfigDir | Out-Null
$mt5IniPath = "$mt5ConfigDir\terminal.ini"

if (-not (Test-Path $mt5IniPath)) {
    @"
[Experts]
AllowLiveTrading=1
AllowDllImport=0
Enabled=1
Account=0
Profile=default
"@ | Set-Content -Path $mt5IniPath -Encoding UTF8
    Write-OK "Config portable scritto: trading algoritmico abilitato"
} else {
    # Assicura che AllowLiveTrading sia a 1 anche se il file esiste gia'
    $ini = Get-Content $mt5IniPath
    if ($ini -notmatch "AllowLiveTrading=1") {
        $ini = $ini -replace "AllowLiveTrading=.*", "AllowLiveTrading=1"
        if ($ini -notmatch "AllowLiveTrading") {
            $ini += "`nAllowLiveTrading=1"
        }
        $ini | Set-Content $mt5IniPath -Encoding UTF8
        Write-OK "AllowLiveTrading abilitato nel config esistente"
    } else {
        Write-OK "Config MT5 gia' corretto"
    }
}

# 6f. Primo avvio manuale del template (OBBLIGATORIO)
#
# La libreria Python MetaTrader5 usa IPC (named pipe) per comunicare col
# terminale. Al primo avvio, MT5 mostra dialoghi (licenza, configurazione
# broker) che bloccano l'IPC. Il template deve essere avviato ALMENO UNA
# VOLTA a mano, con tutti i dialoghi accettati, prima che il bot possa
# usarlo in automatico.
#
# Le copie create per ogni utente ereditano i config gia' scritti dal
# primo avvio, quindi non mostrano piu' dialoghi.

$commonIni = "$mt5ConfigDir\common.ini"
if (-not (Test-Path $commonIni)) {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "  ║  AZIONE RICHIESTA — PRIMO AVVIO MT5 (una volta sola)║" -ForegroundColor Yellow
    Write-Host "  ╠══════════════════════════════════════════════════════╣" -ForegroundColor Yellow
    Write-Host "  ║                                                      ║" -ForegroundColor Yellow
    Write-Host "  ║  1. MT5 sta per aprirsi. Aspetta che carichi.        ║" -ForegroundColor Yellow
    Write-Host "  ║  2. Accetta la licenza se richiesta.                 ║" -ForegroundColor Yellow
    Write-Host "  ║  3. Salta o cancella la schermata di login.          ║" -ForegroundColor Yellow
    Write-Host "  ║     (NON serve fare login ora — il bot lo fara'      ║" -ForegroundColor Yellow
    Write-Host "  ║      automaticamente con le credenziali di ogni      ║" -ForegroundColor Yellow
    Write-Host "  ║      utente.)                                        ║" -ForegroundColor Yellow
    Write-Host "  ║  4. Aspetta che MT5 sia completamente caricato.      ║" -ForegroundColor Yellow
    Write-Host "  ║  5. CHIUDI MT5.                                      ║" -ForegroundColor Yellow
    Write-Host "  ║  6. Torna qui e premi INVIO per continuare.          ║" -ForegroundColor Yellow
    Write-Host "  ║                                                      ║" -ForegroundColor Yellow
    Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  Premi INVIO per aprire MT5..."

    Start-Process -FilePath $mt5Exe -ArgumentList "/portable" -PassThru | Out-Null

    Write-Host ""
    Write-Host "  MT5 avviato. Completa i passi sopra, poi chiudi MT5." -ForegroundColor Cyan
    Read-Host "  Quando hai chiuso MT5, premi INVIO per continuare..."

    # Verifica che il common.ini sia stato creato (MT5 lo scrive al primo avvio)
    if (Test-Path $commonIni) {
        Write-OK "MT5 template inizializzato correttamente (common.ini presente)"
    } else {
        Write-Warn "common.ini non trovato — MT5 potrebbe non essere stato chiuso correttamente."
        Write-Warn "Se il bot da' IPC timeout, ripeti questo passo a mano:"
        Write-Warn "  Apri $mt5Exe, accetta dialoghi, chiudi."
    }
} else {
    Write-OK "MT5 template gia' inizializzato (common.ini presente)"
}

# ── 7. Redis / Memurai ───────────────────────────────────────────────────────

Write-Step "Verifica Redis..."

$redisService = Get-Service -Name "Redis" -ErrorAction SilentlyContinue
$memuraiService = Get-Service -Name "Memurai" -ErrorAction SilentlyContinue

if (-not $redisService -and -not $memuraiService) {
    Write-Warn "Redis/Memurai non installato."
    Write-Warn "Opzioni:"
    Write-Warn "  A) Installa Memurai (Redis per Windows): https://www.memurai.com"
    Write-Warn "  B) Abilita WSL2 e installa Redis nativo"
    Write-Warn "  Per ora il bot funziona senza Redis (comunicazione in-process)"
} else {
    Write-OK "Redis/Memurai trovato"
}

# ── 8. Task Scheduler ────────────────────────────────────────────────────────

Write-Step "Registrazione avvio automatico (Task Scheduler)..."

$taskName   = "TradingBot-API"
$pythonExe  = (Get-Command python).Source
$scriptPath = "$InstallDir\bot\vps\api\app.py"
$workDir    = "$InstallDir\bot"

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action    = New-ScheduledTaskAction `
                -Execute $pythonExe `
                -Argument "`"$scriptPath`"" `
                -WorkingDirectory $workDir

$trigger   = New-ScheduledTaskTrigger -AtStartup

$settings  = New-ScheduledTaskSettingsSet `
                -RestartCount 5 `
                -RestartInterval (New-TimeSpan -Minutes 2) `
                -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
                -MultipleInstances IgnoreNew

# IMPORTANTE: NON usare SYSTEM (Session 0).
# MetaTrader5 usa named pipe IPC che richiede una sessione desktop interattiva.
# Con SYSTEM il terminale MT5 si avvia ma non risponde mai all'IPC (timeout).
# Il task gira come Administrator nella sua sessione utente.
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
                -UserId $currentUser `
                -LogonType Interactive `
                -RunLevel Highest

Register-ScheduledTask `
    -TaskName  $taskName `
    -Action    $action `
    -Trigger   $trigger `
    -Settings  $settings `
    -Principal $principal `
    -Force | Out-Null

Write-OK "Task '$taskName' registrato come $currentUser (sessione interattiva)"
Write-Warn "Il bot si avvia automaticamente al login di $currentUser."
Write-Warn "Assicurati che questo utente sia sempre connesso alla VPS (es. RDP attivo)."

# ── 9. Variabili d'ambiente sistema ─────────────────────────────────────────

Write-Step "Variabili d'ambiente..."

[System.Environment]::SetEnvironmentVariable("TRADING_BOT_DIR", $InstallDir, "Machine")
[System.Environment]::SetEnvironmentVariable("TRADING_BOT_ENV", "production",  "Machine")
Write-OK "TRADING_BOT_DIR = $InstallDir"
Write-OK "TRADING_BOT_ENV = production"

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " SETUP COMPLETATO" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Bot installato in : $InstallDir" -ForegroundColor White
Write-Host " Avvio manuale     : python $scriptPath" -ForegroundColor White
Write-Host " Log               : $InstallDir\logs\" -ForegroundColor White
Write-Host ""
if (-not (Test-Path "$mt5Template\terminal64.exe")) {
    Write-Host " ATTENZIONE: MT5 non trovato in $mt5Template" -ForegroundColor Yellow
    Write-Host "             Copia manualmente terminal64.exe e le sue DLL" -ForegroundColor Yellow
    Write-Host "             poi rilancia setup.ps1" -ForegroundColor Yellow
    Write-Host ""
}
Write-Host " Edita $InstallDir\bot\vps\.env prima di avviare il bot" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
