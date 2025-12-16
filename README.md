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

## Structure

```
defense-scheduler/
├── backend/              # FastAPI service (100KB)
│   ├── app/             # API endpoints & business logic
│   ├── requirements.txt # Python dependencies
│   ├── Dockerfile       # Container image
│   └── .env.example     # Configuration template
│
├── frontend/             # React + TypeScript UI (443MB)
│   ├── src/             # Components & UI logic
│   ├── package.json     # Node dependencies
│   ├── Dockerfile       # Multi-stage build (nginx)
│   └── nginx.conf       # Production server config
│
├── solver/               # CPMpy constraint solver (124KB)
│   ├── src/             # Solver algorithms
│   ├── setup.py         # Package configuration
│   └── requirements.txt # Solver dependencies
│
├── data/                 # Persistent storage (2MB)
│   ├── input/           # Dataset uploads
│   ├── output/          # Solver results
│   └── snapshots/       # Dashboard state saves
│
├── docker-compose.yml    # Service orchestration
├── setup.sh              # Quick development setup
└── .gitignore            # Version control rules
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

## Key Features

- **Constraint-based scheduling** with CPMpy + OR-Tools
- **MUS explanation** for conflicts (Minimal Unsatisfiable Subsets)
- **MCS repair** suggestions (Minimal Correction Subsets)
- **Interactive dashboard** with drag-and-drop
- **Docker-ready** for production deployment

## API Endpoints

- `GET /health` - Health check
- `GET /api/datasets` - List available datasets
- `POST /api/schedule/load` - Load dataset
- `POST /api/schedule/solve` - Run solver
- `POST /api/schedule/explain` - Get MUS explanation
- `POST /api/schedule/repairs` - Get MCS repairs

Full API docs: http://localhost:8000/docs

## Dataset Format

Place datasets in `data/input/your-dataset/`:

**defenses.csv:**
```csv
event_id,student,title,supervisor,assessors,programme
def-001,John Doe,Thesis Title,Prof. Smith,Prof. Jones | Prof. Lee,CW
```

**availabilities.csv:**
```csv
person_id,name,day,time_slot,status
prof-smith,Prof. Smith,2021-06-23,09:00,available
```

## Deployment

**Development:**
```bash
./setup.sh && cd backend && source .venv/bin/activate && uvicorn app.main:app --reload
```

**Production:**
```bash
docker-compose up -d
docker-compose logs -f
```

**Health monitoring:**
- Backend: `curl http://localhost:8000/health`
- Frontend: `curl http://localhost:3000/`

## Troubleshooting

**Backend won't start:**
```bash
pip install -r backend/requirements.txt
python --version  # Requires 3.12+
```

**Frontend build fails:**
```bash
cd frontend && rm -rf node_modules && npm install
node --version  # Requires 20+
```

**Docker issues:**
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up
```

---

**Version:** 0.1.0
**Stack:** React 18 + TypeScript + FastAPI + CPMpy + OR-Tools
**License:** [Your License]
