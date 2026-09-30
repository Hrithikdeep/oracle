import os

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
JWT_SECRET = os.getenv("JWT_SECRET")

# Browser origins allowed to call this API (see main.py CORS middleware).
# Comma-separated, no trailing slash. Defaults to the local Next.js dev
# server so local dev needs zero config; set this in production to the real
# frontend origin(s).
CORS_ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
# Optional regex for origins that can't be listed up front (e.g. Vercel
# preview deployments: https://oracle-.*-myteam\.vercel\.app). Unset by
# default — a broad pattern like .*\.vercel\.app would allow every Vercel
# site to call this API from a browser.
CORS_ALLOW_ORIGIN_REGEX = os.getenv("CORS_ALLOW_ORIGIN_REGEX") or None

if not OPENAI_API_KEY:
    print("Warning: OPENAI_API_KEY is not set")
if not ANTHROPIC_API_KEY:
    print("Warning: ANTHROPIC_API_KEY is not set")
if not TAVILY_API_KEY:
    print("Warning: TAVILY_API_KEY is not set")
if not JWT_SECRET:
    print("Warning: JWT_SECRET is not set")
