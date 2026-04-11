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

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Warn "Python non trovato. Download di Python $PythonVersion..."
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

# ── 6. MT5 template ──────────────────────────────────────────────────────────

Write-Step "Verifica installazione MT5 template..."

$mt5Template = "$InstallDir\mt5_template\terminal64.exe"

if (-not (Test-Path $mt5Template)) {
    Write-Warn "MT5 template non trovato."
    Write-Warn "Azioni manuali richieste:"
    Write-Warn "  1. Scarica MT5 dal sito del tuo broker"
    Write-Warn "  2. Installa in modalita' portable in: $InstallDir\mt5_template"
    Write-Warn "  3. Avvialo una volta, fai login con un conto qualsiasi"
    Write-Warn "  4. Vai in Strumenti > Opzioni > Expert Advisor"
    Write-Warn "     Abilita: 'Consenti il trading algoritmico'"
    Write-Warn "  5. Chiudi MT5 (la configurazione e' salvata)"
    Write-Warn "  Il setup automatico usera' questa cartella come template"
    Write-Warn "  per ogni nuovo utente."
} else {
    Write-OK "MT5 template trovato"
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

$principal = New-ScheduledTaskPrincipal `
                -UserId "SYSTEM" `
                -LogonType ServiceAccount `
                -RunLevel Highest

Register-ScheduledTask `
    -TaskName  $taskName `
    -Action    $action `
    -Trigger   $trigger `
    -Settings  $settings `
    -Principal $principal `
    -Force | Out-Null

Write-OK "Task '$taskName' registrato (avvio a ogni boot come SYSTEM)"

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
if (-not (Test-Path $mt5Template)) {
    Write-Host " ATTENZIONE: configura il template MT5 prima di avviare" -ForegroundColor Yellow
    Write-Host "             (vedi istruzioni sopra)" -ForegroundColor Yellow
    Write-Host ""
}
Write-Host " Edita $InstallDir\bot\vps\.env prima di avviare il bot" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
