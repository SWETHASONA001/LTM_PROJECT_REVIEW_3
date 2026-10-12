# AeroHydro-PINN — single-service image: FastAPI backend that also serves the built website.
# Data extracts are served only through /api/data/* after sign-in (AEROHYDRO_REQUIRE_AUTH=1).

# ---- 1. Build the website -------------------------------------------------------------
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Same-origin API; data loaded from the protected API instead of public files.
ENV VITE_API_BASE_URL=same-origin \
    VITE_DATA_SOURCE=api
RUN npm run build && rm -rf dist/data

# ---- 2. Python runtime ----------------------------------------------------------------
FROM python:3.11-slim
ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r backend/requirements.txt
COPY backend/app backend/app
COPY ml ml
COPY models models
COPY frontend/public/data data
COPY --from=web /web/dist web

ENV AEROHYDRO_DATA_DIR=/app/data \
    AEROHYDRO_FRONTEND_DIST=/app/web \
    AEROHYDRO_STORAGE_DIR=/tmp/aerohydro \
    AEROHYDRO_REQUIRE_AUTH=1 \
    AEROHYDRO_ALLOW_SIGNUP=0 \
    AEROHYDRO_ALLOW_LOCAL_ORIGINS=0 \
    AEROHYDRO_ALLOWED_ORIGINS=

WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
