# Build context is backend/ (on Railway: set the service's Root Directory to "backend").
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN useradd --create-home --uid 1000 appuser

WORKDIR /app
# api/research.py creates /app/uploads at import time, so the app user needs
# write access to /app itself.
RUN chown appuser:appuser /app

# Dependencies first so this layer is cached across code-only changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=appuser:appuser . .

USER appuser

# Migrations run on every start (safe: `alembic upgrade head` is a no-op when
# already current, and this is a single-instance service so there's no
# concurrent-migration race). `exec` makes uvicorn PID 1 so it receives
# SIGTERM on redeploys. Railway injects PORT; 8000 is only the local default.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
