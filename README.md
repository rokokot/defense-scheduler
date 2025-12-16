# Defense Scheduler

## quick start

### Docker (Recommended)
```bash
docker-compose up --build

# Access:
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

### Local Development
```bash
# One-command setup
./setup.sh

# Start backend (terminal 1)
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload

# Start frontend (terminal 2)
cd frontend
npm run dev
```

## Configuration

### Docker Compose (`.env`)

Copy `.env.example` to `.env` before starting the stack with Compose—this file controls both the backend CORS whitelist and the frontend API URL that Vite embeds at build time.

```bash
API_HOST=localhost
FRONTEND_HOSTS=
ALLOWED_ORIGINS=
```

- `API_HOST` is what the frontend uses when it` fetch`es `/api/` (defaults to `localhost` for local testing, but in production point it to your public IP or DNS name, e.g., `134.98.159.147`).
- `FRONTEND_HOSTS` lets you add extra origins for the backend CORS middleware (comma-separated hosts, host:port pairs, or full URLs); the default whitelist already covers `localhost:3000`, `localhost:5173`, and the vite preview port.
- `ALLOWED_ORIGINS` can override the entire CORS list if you prefer to supply the full comma-separated origins yourself. When it is set, `FRONTEND_HOSTS` is ignored.
For a deployed instance, set both `API_HOST` and `FRONTEND_HOSTS` to the public hostname/IP you intend clients to use (e.g., `134.98.159.147`) so the frontend targets the right backend endpoint and the backend permits that dashboard origin.

After editing `.env`, restart the Compose stack (`docker compose up -d --build`) so the new values propagate to both containers.

### Frontend development (`.env.local`)

While working locally you can still use `.env.local` inside `frontend/` to point the dev server at the backend:

```bash
VITE_API_URL=http://localhost:8000
```


## Data format

Place datasets in `data/input/your-dataset/`:

**defenses.csv:**
```csv
event_id,student,title,supervisor,assessors,programme

```

**availabilities.csv:**
```csv
person_id,name,day,time_slot,status
```
