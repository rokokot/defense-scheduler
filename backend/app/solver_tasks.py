from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from .solver_runner import SolverOptions, runner
from .solver_utils import format_solver_response


@dataclass
class SolverRunRecord:
    id: str
    dataset_id: str
    status: str
    created_at: float
    timeout: int
    solver: str
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class SolverRunManager:
    def __init__(self, max_workers: int = 1) -> None:
        self._runs: Dict[str, SolverRunRecord] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

    def submit(self, options: SolverOptions) -> SolverRunRecord:
        run_id = uuid.uuid4().hex
        record = SolverRunRecord(
            id=run_id,
            dataset_id=options.dataset,
            status="pending",
            created_at=time.time(),
            timeout=options.timeout,
            solver=options.solver,
            metadata={"must_plan_all": options.must_plan_all},
        )
        with self._lock:
            self._runs[run_id] = record
        self._executor.submit(self._execute, run_id, options)
        return record

    def list_runs(self) -> Dict[str, SolverRunRecord]:
        with self._lock:
            return dict(self._runs)

    def get(self, run_id: str) -> Optional[SolverRunRecord]:
        with self._lock:
            return self._runs.get(run_id)

    def _execute(self, run_id: str, options: SolverOptions) -> None:
        with self._lock:
            record = self._runs.get(run_id)
            if not record:
                return
            record.status = "running"
            record.started_at = time.time()
        try:
            raw_result = runner.solve(options)
            result = format_solver_response(raw_result, options)
            with self._lock:
                record = self._runs.get(run_id)
                if not record:
                    return
                record.result = result
                record.status = "succeeded"
                record.finished_at = time.time()
        except Exception as exc:  # pragma: no cover
            with self._lock:
                record = self._runs.get(run_id)
                if not record:
                    return
                record.error = str(exc)
                record.status = "failed"
                record.finished_at = time.time()


run_manager = SolverRunManager(max_workers=2)

__all__ = ["SolverRunManager", "SolverRunRecord", "run_manager"]
