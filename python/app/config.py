"""Central paths + env. Loads the repo-root .env so the Python platform shares
configuration with the TS implementation (same DEEPSEEK_*, GMAIL_*, secrets/)."""

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

# Shared with the TS side
SCRATCH_DIR = PROJECT_ROOT / "scratch"
SKILLS_DIR = PROJECT_ROOT / "src" / "skills"          # single source of truth for skill .md files
PUBLIC_DIR = PROJECT_ROOT / "public"
SECRETS_DIR = PROJECT_ROOT / "secrets"
CLIENT_SECRET_PATH = SECRETS_DIR / "google_oauth_client.json"
TOKEN_PATH = SECRETS_DIR / "gmail.token.json"

# Python-side state (kept separate from the TS agent.db.json)
DATA_DIR = PROJECT_ROOT / "python" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
TASK_DB_PATH = DATA_DIR / "tasks.sqlite"
CHECKPOINT_DB_PATH = DATA_DIR / "checkpoints.sqlite"
DEMO_DB_PATH = DATA_DIR / "demo-data.sqlite"

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

DEFAULT_GMAIL_USER = "yeexianteoh1223@gmail.com"
GMAIL_USER = os.getenv("GMAIL_USER", DEFAULT_GMAIL_USER)
ALLOWED_SENDERS = [
    s.strip().lower() for s in os.getenv("ALLOWED_SENDERS", "").split(",") if s.strip()
]
POLL_INTERVAL_MS = int(os.getenv("POLL_INTERVAL_MS", "60000"))
ATTACHMENT_MAX_BYTES = int(os.getenv("ATTACHMENT_MAX_BYTES", str(10 * 1024 * 1024)))

PORT = int(os.getenv("PY_PORT", "3001"))
