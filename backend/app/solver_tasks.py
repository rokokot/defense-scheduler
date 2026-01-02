from __future__ import annotations

import multiprocessing as mp
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from multiprocessing.connection import Connection
from typing import Any, Dict, Optional, Tuple

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
        self._ctx = mp.get_context("spawn")
        self._processes: Dict[str, mp.Process] = {}

    def submit(self, options: SolverOptions) -> SolverRunRecord:
        run_id = uuid.uuid4().hex
        record = SolverRunRecord(
            id=run_id,
            dataset_id=options.dataset,
            status="pending",
            created_at=time.time(),
            timeout=options.timeout,
            solver=options.solver,
            metadata={
                "must_plan_all": options.must_plan_all,
                "adjacency_objective": options.adjacency_objective,
            },
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

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            record = self._runs.get(run_id)
            process = self._processes.get(run_id)
            if not record or record.status in {"succeeded", "failed", "cancelled"}:
                return False
            record.status = "cancelled"
            record.finished_at = time.time()
            record.error = record.error or "Cancelled by user"
        if process and process.is_alive():
            process.terminate()
            process.join(timeout=1)
        with self._lock:
            self._processes.pop(run_id, None)
        return True

    def _execute(self, run_id: str, options: SolverOptions) -> None:
        with self._lock:
            record = self._runs.get(run_id)
            if not record or record.status == "cancelled":
                return
            record.status = "running"
            record.started_at = time.time()
        parent_conn, child_conn = self._ctx.Pipe()
        process = self._ctx.Process(target=_solver_process_entry, args=(options, child_conn))
        process.daemon = True
        process.start()
        child_conn.close()
        with self._lock:
            self._processes[run_id] = process
        payload: Optional[Tuple[str, Any]] = None
        try:
            payload = parent_conn.recv()
        except EOFError:
            payload = None
        finally:
            parent_conn.close()
            process.join(timeout=1)
            with self._lock:
                self._processes.pop(run_id, None)
        with self._lock:
            record = self._runs.get(run_id)
            if not record:
                return
            if record.status == "cancelled":
                return
            if not payload:
                record.status = "failed"
                record.error = record.error or "Solver process exited unexpectedly"
                record.finished_at = time.time()
                return
            kind, data = payload
            if kind == "success":
                result = format_solver_response(data, options)
                record.result = result
                record.status = "succeeded"
                record.finished_at = time.time()
            else:
                record.error = str(data)
                record.status = "failed"
                record.finished_at = time.time()


def _solver_process_entry(options: SolverOptions, conn: Connection) -> None:
    try:
        raw_result = runner.solve(options)
        conn.send(("success", raw_result))
    except Exception as exc:  # pragma: no cover
        conn.send(("error", str(exc)))
    finally:
        conn.close()


run_manager = SolverRunManager(max_workers=2)

__all__ = ["SolverRunManager", "SolverRunRecord", "run_manager"]
