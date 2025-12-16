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

**Backend** (`.env`):
```bash
PORT=8000
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
DEFAULT_SOLVER=ortools
DEFAULT_TIMEOUT=180
```

**Frontend** (`.env.local`):
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

To load the new datasets, run docker compose down, and then docker compose up again to reload the container with new data.