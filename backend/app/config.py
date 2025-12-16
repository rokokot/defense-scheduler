"""Application configuration and path helpers."""
from __future__ import annotations

import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent  # backend/app directory
BACKEND_DIR = APP_DIR.parent


def _candidate_roots() -> list[Path]:
    env_base = os.getenv("PROJECT_ROOT")
    candidates = []
    if env_base:
        candidates.append(Path(env_base))
    candidates.extend(
        [
            BACKEND_DIR.parent,  # repo root during local dev
            BACKEND_DIR,  # backend/ when running tests without full repo
            Path("/app"),  # docker image root
        ]
    )
    return candidates


def _resolve_base_dir() -> Path:
    for candidate in _candidate_roots():
        solver_dir = candidate / "solver" / "src"
        if solver_dir.exists():
            return candidate
    # Fallback to backend dir even if solver is missing (will fail later with clearer error)
    return BACKEND_DIR


BASE_DIR = _resolve_base_dir()

DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
DATA_INPUT_DIR = DATA_DIR / "input"
DATA_OUTPUT_DIR = DATA_DIR / "output"
SNAPSHOT_DIR = DATA_DIR / "snapshots"
SOLVER_SRC_DIR = BASE_DIR / "solver" / "src"
# Ensure solver dir resolves even when only installed package exists (docker without sources)
if not SOLVER_SRC_DIR.exists():
    alt_solver_dir = Path("/app/solver/src")
    if alt_solver_dir.exists():
        SOLVER_SRC_DIR = alt_solver_dir

for path in (DATA_INPUT_DIR, DATA_OUTPUT_DIR, SNAPSHOT_DIR):
    path.mkdir(parents=True, exist_ok=True)

DEFAULT_DATASET = "sample"
DEFAULT_TIMEOUT = 180  # seconds
