# Deployment guide

## Recommended: one private service on Render (free)

`Dockerfile` + `render.yaml` build a single web service: the FastAPI backend serves the built website, the API and the data at one address. In this mode (`AEROHYDRO_REQUIRE_AUTH=1`):

- every page and API call requires sign-in; the data extracts are served only via `/api/data/*` with a valid session (never as public files);
- self sign-up is off; accounts come from Render secrets, so they survive restarts on the free tier (no persistent disk);
- "Forgot password" is replaced by "ask your administrator" unless SMTP is configured.

**Steps**

1. Create a **private** GitHub repository (it contains the data extracts) and push this branch.
2. On render.com: *New → Blueprint* → pick the repository. Render reads `render.yaml` and asks for:
   - `AEROHYDRO_ADMIN_EMAIL`, `AEROHYDRO_ADMIN_NAME`, `AEROHYDRO_ADMIN_PASSWORD` — your account;
   - `AEROHYDRO_USERS` (optional) — invited users, e.g. `[{"email":"a@b.com","name":"A","password":"at-least-10-chars","role":"engineer"}]`;
   - `ANTHROPIC_API_KEY` (optional) — Claude copilot.
3. Deploy. The app is then at `https://<service-name>.onrender.com`.

**Free-tier limits:** the service sleeps after ~15 min idle (first visit then takes ~1 min); 512 MB RAM; files written at runtime (saved server-side scenarios) are lost on restart — layouts and scenarios saved in the browser are unaffected. The forecasting API is unavailable online (the 186 MB raw SCADA file and the forecaster artifact are not deployed); its page shows the precomputed results.

To add or remove users later, edit `AEROHYDRO_USERS` in the Render dashboard (Environment) — the service restarts with the new list.

## Alternative: Frontend — Vercel or Netlify

| Setting | Value |
|---|---|
| Root / base directory | `frontend` |
| Install command | `npm install` |
| Build command | `npm run build` (typecheck + Vite build) |
| Output directory | `dist` |
| Node version | 20+ (developed on 24) |
| SPA routing | `frontend/vercel.json` (rewrites) or `frontend/netlify.toml` + `public/_redirects` |

Environment variables (build time, public — never put secrets here):

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend origin, e.g. `https://api.example.com` (no trailing slash). Empty = standalone mode. |

**Data extracts.** The UI reads `frontend/public/data/*.json` (≈4.7 MB total). They are generated from `data/raw` by `py -3.11 scripts/build_frontend_data.py` and must be committed or generated in CI before the build — the raw datasets (≈220 MB) are not committed and are not available to Vercel/Netlify. Decide whether these extracts may be public before deploying; anything in `public/` is downloadable by anyone.

## Backend — separate host

Vercel/Netlify static hosting does **not** run the persistent Python/FastAPI/FLORIS backend. Host it separately, e.g. a container on Render, Railway, Fly.io, Azure Container Apps or a VM:

```bash
cd backend
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The image needs the repository's `ml/` and `models/` folders. `models/*.pt` are committed; the two `.joblib` artifacts (~22 MB each) are git-ignored and must be produced at build time with `ml/train_forecaster.py` and `ml/train_isolation_forest.py` (needs `data/raw`) or copied in. The forecaster endpoint additionally reads the raw SCADA CSV; without it `/api/forecast` returns 503.

| Variable | Purpose |
|---|---|
| `AEROHYDRO_ALLOWED_ORIGINS` | Comma-separated frontend origins for CORS (e.g. `https://aerohydro.vercel.app`) |
| `AEROHYDRO_DATA_DIR` | Directory with the JSON extracts (default `frontend/public/data`) |
| `AEROHYDRO_RAW_DIR` | Raw datasets, if server-side processing is added |
| `AEROHYDRO_STORAGE_DIR` | Scenario persistence (default `backend/storage`; use a persistent volume or replace with a database) |
| `AEROHYDRO_SECRET` | Token-signing secret for sign-in sessions (otherwise generated into storage/secret.key). Set explicitly in production. |
| `AEROHYDRO_ALLOW_SIGNUP` | `1` (default) lets anyone create an account from the sign-in page; set `0` in production unless open sign-up is intended. |
| `AEROHYDRO_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM` | Email delivery for password-reset links. Without them, links go to `storage/outbox.log` (development only). |
| `ANTHROPIC_API_KEY` | Enables the copilot agent (Claude). Server-side only, never exposed to the browser. |
| `AEROHYDRO_LLM_MODEL` | Optional model override (default `claude-opus-5-5`). |

## Before going live

1. Decide data-sharing policy for the extracts and the La Haute Borne licence terms.
2. Sign-in exists (backend accounts), but API endpoints are not yet token-protected and layouts/scenarios remain per-browser — add endpoint authorization and server-side workspaces before multi-user use, and disable the local-workspace option.
3. Set `ANTHROPIC_API_KEY` on the backend and test the copilot agent live (its loop is unit-tested with a mocked client only). Conversation memory is in-process; use a store such as Redis for multiple workers.
4. Replace file-based scenario storage with a database.
5. Add HTTPS and rate limiting in front of `/api/floris/simulate` (CPU-bound).
