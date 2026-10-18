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
