# AI Powered Farming Assistant

A full-stack application that uses a TensorFlow CNN to detect plant diseases from uploaded leaf images. Built with React (Vite) and FastAPI.

## Features
- Upload plant leaf images for analysis
- Detect plant diseases using a Convolutional Neural Network
- Get confidence scores for predictions
- View detailed precautions and remedies
- Browse a disease library generated from the model's supported classes and backend guidance
- Search local scan history and download diagnosis reports as PDFs
- Switch the interface between English and Hindi
- Modern, responsive "Green Farming" themed UI

The Disease Library is an educational reference, not a confirmed diagnosis. Its supported
plant/class list comes from `backend/class_labels.py`; prevention and next-step guidance
comes from `backend/disease_info.py`. Symptom and cause descriptions are not shown where
the project has no verified information for them.

## Language Support

The interface supports English and Hindi, and remembers the selection in the browser.
Scientific model class names remain unchanged. Guidance text is shown in its original
English when no verified Hindi translation is available; the application does not
automatically translate technical precautions or remedies. PDF reports remain in English
because the bundled PDF fonts do not support Hindi text.

## Scan History and Reports

The prototype stores scan metadata in `backend/data/scan_history.sqlite3` (or at the
path configured by `PLANT_DISEASE_HISTORY_DB`). Metadata includes the original filename,
model prediction, confidence, alternative predictions, precautions, remedies, and
timestamp. Image bytes are not written to disk. A PDF generated from the active scan can
include its image while it remains selected in the browser; reports for history entries
omit the original image because it was not retained.

For local use, keep the API bound to loopback (`127.0.0.1`). The API CORS allowlist defaults
to the Vite localhost origins and can be changed with `PLANT_DISEASE_ALLOWED_ORIGINS`.
This unauthenticated SQLite history is for a single-user local prototype only. Do not
expose this API or its scan endpoints to a network or deploy it as a shared service.
For deployment, use a server database such as PostgreSQL with authentication and
per-user authorization; configure private object storage only if image retention is
explicitly enabled and disclosed.

## Project Structure
- `frontend/` - React frontend (Vite)
- `backend/` - FastAPI backend with TensorFlow and OpenCV

## Model Requirements

The API requires the existing trained model at
`backend/model/efficientnetv2_plant_model.h5`. Keep this model paired with the current
`backend/class_labels.py` mapping (15 output classes). The backend loads it with
`compile=False` and readiness remains unavailable if it cannot be loaded or the output
count does not match the class mapping. The Docker build deliberately fails if this model
file is missing. Do not replace or retrain the model as part of deployment.

## Run Locally

Prerequisites: Python 3.11, Node.js 22, and the model file above.

In a PowerShell terminal:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:PLANT_DISEASE_HOST = "127.0.0.1"
$env:PLANT_DISEASE_PORT = "8000"
$env:PLANT_DISEASE_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
$env:PLANT_DISEASE_ENABLE_SCAN_HISTORY = "true"
python -m uvicorn main:app --host $env:PLANT_DISEASE_HOST --port $env:PLANT_DISEASE_PORT
```

In a second terminal:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

The frontend development default calls `http://localhost:8000`. Set
`VITE_API_BASE_URL` in `frontend/.env.local` to override it; Vite reads this value at
build/start time, so restart the dev server after changing it. In production, an empty
`VITE_API_BASE_URL` uses same-origin API paths and requires a reverse proxy to route the
API paths to FastAPI.

Backend configuration is via environment variables (the `.env.example` file documents
them but is not loaded automatically):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLANT_DISEASE_HOST` | `127.0.0.1` when running `python main.py` | Bind address. Use `0.0.0.0` only inside a container or behind a trusted proxy. |
| `PLANT_DISEASE_PORT` | `8000` | Port used by `python main.py` and the container entrypoint. |
| `PLANT_DISEASE_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated HTTP(S) origins, without paths. |
| `PLANT_DISEASE_MODEL_PATH` | `model/efficientnetv2_plant_model.h5` under `backend/` | Optional model path override. |
| `PLANT_DISEASE_ENABLE_SCAN_HISTORY` | `true` | Enables the unauthenticated local SQLite history API. Keep off for public deployments. |
| `PLANT_DISEASE_HISTORY_DB` | `backend/data/scan_history.sqlite3` | SQLite path when history is enabled. |
| `PLANT_DISEASE_CONFIDENCE_THRESHOLD` | unset | Optional score threshold from 0 to 100; it does not establish out-of-distribution detection. |
| `VITE_API_BASE_URL` | dev: `http://localhost:8000`; production: same-origin | Frontend API origin, baked into the Vite build. |
| `VITE_ENABLE_SCAN_HISTORY` | `true` | Set to `false` at frontend build time when backend history is disabled. |

`/health` is a liveness check. `/ready` returns HTTP 200 only after the model loads and
class output dimensions are validated; otherwise it returns HTTP 503.

## Tests and Build Checks

Run backend API tests (these use a stub predictor for deterministic endpoint checks):

```powershell
cd backend
python -m pip install -r requirements-test.txt
python -m pytest -q
```

Run frontend static checks and production build:

```powershell
cd frontend
npm ci
npm run lint
npm run build
```

GitHub Actions runs both sets of checks on pushes and pull requests. A real model
prediction can be manually checked after starting the backend:

```powershell
Invoke-RestMethod http://localhost:8000/ready
curl.exe -F "file=@path\to\leaf.jpg" http://localhost:8000/predict
```

The automated endpoint test verifies the request and response contract with a stub model;
it does not claim measured accuracy or replace an end-to-end check using real leaf data.

## Container Demo Deployment

Install Docker Engine with the Compose plugin. Build and launch both services from the
project root:

```powershell
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/ready
```

Open `http://localhost:8080`. The frontend Nginx container proxies API requests to the
backend and enforces a basic per-IP prediction rate limit. Only the frontend port is
published; the backend is internal to the Compose network. The model is copied into the
backend image, so it must be present in the Docker build context. To stop the demo:

```powershell
docker compose down
```

The Compose demo disables scan history in both backend and UI by default: current
history is unauthenticated SQLite and is not safe for a public multi-user service.
If deploying publicly, retain that setting unless history is redesigned with
authentication, per-user authorization, and a persistent server database. Terminate TLS
at a trusted ingress/reverse proxy, restrict exposed ports, and configure that ingress
with appropriate request/time/resource limits. The included Compose file serves HTTP
for local demonstration; it does not configure a public TLS certificate or cloud
deployment.

For a separate frontend host, build the image with `VITE_API_BASE_URL` set to the
public HTTPS API origin, and set `PLANT_DISEASE_ALLOWED_ORIGINS` to the exact HTTPS
frontend origin. Do not use `*` for CORS or place secrets in `VITE_*` variables: Vite
embeds them into publicly readable browser assets.

## Upload and API Safety

FastAPI accepts JPG/JPEG, PNG, and WebP by decoding the file content, rejects mismatched
or unsupported content types, limits each image to 8 MiB and 20 million pixels, and
requires each image side to be at least 64 pixels. Uploads are read through FastAPI's
spooled upload stream, bounded before inference, validated in memory, and closed after
handling; uploaded images are not saved to the scan database. The front-end Nginx
container allows a 9 MiB HTTP body to accommodate multipart overhead.

## Troubleshooting

- **`/ready` returns 503:** check the backend container logs with
  `docker compose logs backend`; confirm that `efficientnetv2_plant_model.h5` exists,
  is readable, and has 15 output classes matching `class_labels.py`.
- **Frontend cannot reach the API:** in Compose, use the frontend origin on port 8080;
  in a separate deployment, verify `VITE_API_BASE_URL`, backend reachability, TLS, and
  the exact `PLANT_DISEASE_ALLOWED_ORIGINS`. Rebuild/restart Vite after changing its
  environment.
- **HTTP 413 or 415:** upload a valid JPG/JPEG, PNG, or WebP under 8 MiB and within the
  20-megapixel limit. Reverse proxies must allow at least 9 MiB request bodies.
- **Grad-CAM is unavailable:** prediction remains available independently; inspect the
  backend logs for the visualization error and verify the model supports gradient
  computation.
- **History is unavailable in Compose:** this is intentional. The public-demo profile
  disables history because it has no authentication.
- **Slow first startup:** TensorFlow model loading can take time. Compose waits on
  `/ready`; inspect backend logs and allow the configured startup window before
  diagnosing a failed model load.
