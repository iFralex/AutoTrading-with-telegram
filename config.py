import os
from pathlib import Path
from dotenv import load_dotenv

# Carica il file .env dalla cartella del progetto
load_dotenv(Path(__file__).parent / '.env')

# ── Telegram ──────────────────────────────────────────────────────────────────
TELEGRAM_API_ID   = int(os.environ['TELEGRAM_API_ID'])
TELEGRAM_API_HASH = os.environ['TELEGRAM_API_HASH']
TELEGRAM_SESSION  = os.getenv('TELEGRAM_SESSION', 'session')

# ── MetaTrader 5 ──────────────────────────────────────────────────────────────
MT5_LOGIN    = int(os.getenv('MT5_LOGIN', '0'))
MT5_PASSWORD = os.getenv('MT5_PASSWORD', '')
MT5_SERVER   = os.getenv('MT5_SERVER', '')
