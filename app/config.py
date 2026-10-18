import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
# llama-3.3-70b and llama-4-scout were shut down by Groq (Aug / Jul 2026).
GROQ_TEXT_MODEL = os.getenv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b")
GROQ_FAST_MODEL = os.getenv("GROQ_FAST_MODEL", "openai/gpt-oss-20b")
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")

FRONTEND_ORIGINS = [
    o.strip() for o in
    os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
    if o.strip()
]

USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY)
USE_GROQ = bool(GROQ_API_KEY)
GOOGLE_VISION_API_KEY = os.getenv("GOOGLE_VISION_API_KEY", "").strip()
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "").strip()

# Lazy mode texts. Without these, messages are written to the server log instead of sent.
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_FROM = os.getenv("TWILIO_FROM", "").strip()  # your Twilio number (+1...) or a Messaging Service SID (MG...)
USE_TWILIO = bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM)
# Free fallback: TextBelt. "textbelt" is the free key (one text a day per server IP, US numbers).
TEXTBELT_KEY = os.getenv("TEXTBELT_KEY", "").strip()
# Lazy mode by email (free): a Gmail address + an app password (Google Account -> Security -> App passwords).
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").replace(" ", "").strip()
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
USE_EMAIL = bool(SMTP_USER and SMTP_PASSWORD)
# When the API is public, only these addresses may get lazy-mode emails (comma-separated).
# Empty = anyone, which is fine on localhost but lets strangers send mail from your account.
LAZY_ALLOWED_EMAILS = {e.strip().lower() for e in os.getenv("LAZY_ALLOWED_EMAILS", "").split(",") if e.strip()}

DATA_DIR = ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

DEMO_USER_ID = "demo-user"


# ---------------------------------------------------------------- AI lane settings
PERCEPTRON_API_KEY = os.getenv("PERCEPTRON_API_KEY", "").strip()
PERCEPTRON_MODEL = os.getenv("PERCEPTRON_MODEL", "perceptron-mk1.5")
USE_PERCEPTRON = bool(PERCEPTRON_API_KEY)
AI_TIMEOUT_SECONDS = float(os.getenv("AI_TIMEOUT_SECONDS", "20"))


# ---------------------------------------------------------------- core lane settings
PAYMENT_MODE = "simulated"  # organisers confirmed no Visa API is required; never claim real payments
DEMO_EMAIL = os.getenv("DEMO_EMAIL", "").strip()
