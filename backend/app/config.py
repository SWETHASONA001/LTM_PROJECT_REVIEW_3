"""Backend configuration from environment variables (no secrets in code)."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Directory holding the generated JSON extracts (scripts/build_frontend_data.py).
DATA_DIR = Path(os.getenv("AEROHYDRO_DATA_DIR", ROOT / "frontend" / "public" / "data"))

# Raw repository datasets (read-only). Not required for the API to start.
RAW_DIR = Path(os.getenv("AEROHYDRO_RAW_DIR", ROOT / "data" / "raw"))

# Scenario persistence file.
STORAGE_DIR = Path(os.getenv("AEROHYDRO_STORAGE_DIR", ROOT / "backend" / "storage"))

# Comma-separated list of allowed browser origins for CORS.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("AEROHYDRO_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]

# Also allow any localhost/127.0.0.1 port in development. Set AEROHYDRO_ALLOW_LOCAL_ORIGINS=0 in production.
LOCAL_ORIGIN_REGEX = r"http://(localhost|127\.0\.0\.1):\d+" if os.getenv("AEROHYDRO_ALLOW_LOCAL_ORIGINS", "1") != "0" else None

# LLM provider for the copilot (see copilot_service.enabled()).
LLM_PROVIDER = os.getenv("AEROHYDRO_LLM_PROVIDER", "").strip()

# Production: every /api/* call except health and sign-in needs a valid session token,
# including the data extracts (served from /api/data/{name}, never as public files).
REQUIRE_AUTH = os.getenv("AEROHYDRO_REQUIRE_AUTH", "0") == "1"

# Built frontend to serve from this same service (single-URL deployment). Unset in local development.
_dist = os.getenv("AEROHYDRO_FRONTEND_DIST", "").strip()
FRONTEND_DIST = Path(_dist) if _dist else None

VERSION = "0.1.0"
