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

# LLM provider for the copilot. Not implemented yet: the endpoint reports 503
# until a provider integration (e.g. a LangGraph agent) is added server-side.
LLM_PROVIDER = os.getenv("AEROHYDRO_LLM_PROVIDER", "").strip()

VERSION = "0.1.0"
