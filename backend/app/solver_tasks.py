from __future__ import annotations

import logging
import multiprocessing as mp
import queue
import threading
import time
import uuid
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from multiprocessing.connection import Connection
from typing import Any, Dict, Optional, Tuple

from .solver_runner import SolverOptions, runner
from .solver_utils import format_solver_response, format_solver_snapshot

logger = logging.getLogger("uvicorn.error")
MAX_DEBUG_LINES = 2000


def _queue_put_line(q: queue.Queue, line: str) -> None:
    try:
        q.put_nowait(line)
    except queue.Full:
        try:
            q.get_nowait()
        except queue.Empty:
            pass
        try:
            q.put_nowait(line)
        except queue.Full:
            pass


class _QueueWriter:
    def __init__(self, q: queue.Queue, prefix: str | None = None) -> None:
        self._queue = q
        self._buffer = ""
        self._prefix = prefix or ""

    def write(self, data: str) -> int:
        if not data:
            return 0
        self._buffer += data
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            cleaned = line.rstrip()
            if cleaned:
                _queue_put_line(self._queue, f"{self._prefix}{cleaned}")
        return len(data)

    def flush(self) -> None:
        if self._buffer:
            cleaned = self._buffer.rstrip()
            if cleaned:
                _queue_put_line(self._queue, f"{self._prefix}{cleaned}")
            self._buffer = ""


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
    latest_snapshot: Optional[Dict[str, Any]] = None
    solutions: list[Dict[str, Any]] = field(default_factory=list)
    debug_lines: list[str] = field(default_factory=list)


class SolverStreamChannel:
    def __init__(self, run_id: str = "") -> None:
        self._lock = threading.Lock()
        self._subscribers: set[queue.Queue] = set()
        self._history: list[Dict[str, Any]] = []
        self._closed = False
        self._max_history = 100
        self._run_id = run_id

    def publish(self, payload: Dict[str, Any]) -> None:
        with self._lock:
            if self._closed:
                logger.warning(
                    "stream.publish.dropped run_id=%s closed=True type=%s",
                    self._run_id,
                    payload.get("type"),
                )
                return
            self._history.append(payload)
            if len(self._history) > self._max_history:
                self._history.pop(0)
            subscriber_count = len(self._subscribers)
            logger.info(
                "stream.publish run_id=%s type=%s history=%d subscribers=%d",
                self._run_id,
                payload.get("type"),
                len(self._history),
                subscriber_count,
            )
            for subscriber in list(self._subscribers):
                self._publish_to_queue(subscriber, payload)

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=100)
        with self._lock:
            history_len = len(self._history)
            closed = self._closed
            logger.info(
                "stream.subscribe run_id=%s history=%d closed=%s",
                self._run_id,
                history_len,
                closed,
            )
            for event in self._history:
                self._publish_to_queue(q, event)
                logger.info(
                    "stream.subscribe.replay run_id=%s type=%s qsize=%d",
                    self._run_id,
                    event.get("type"),
                    q.qsize(),
                )
            if self._closed:
                self._publish_to_queue(q, None)
            else:
                self._subscribers.add(q)
        return q

    def close(self, payload: Optional[Dict[str, Any]] = None) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            logger.info(
                "stream.close run_id=%s history=%d subscribers=%d",
                self._run_id,
                len(self._history),
                len(self._subscribers),
            )
            if payload is not None:
                self._history.append(payload)
            for subscriber in list(self._subscribers):
                if payload is not None:
                    self._publish_to_queue(subscriber, payload)
                self._publish_to_queue(subscriber, None)
            self._subscribers.clear()

    def _publish_to_queue(self, q: queue.Queue, payload: Optional[Dict[str, Any]]) -> None:
        try:
            q.put_nowait(payload)
        except queue.Full:
            if payload is None:
                return
            try:
                q.get_nowait()
            except queue.Empty:
                pass
            try:
                q.put_nowait(payload)
            except queue.Full:
                pass


class SolverStreamManager:
    def __init__(self) -> None:
        self._channels: Dict[str, SolverStreamChannel] = {}
        self._lock = threading.Lock()

    def create(self, run_id: str) -> SolverStreamChannel:
        with self._lock:
            channel = self._channels.get(run_id)
            if channel is None:
                channel = SolverStreamChannel(run_id=run_id)
                self._channels[run_id] = channel
                logger.info("stream.create run_id=%s", run_id)
            return channel

    def get(self, run_id: str) -> Optional[SolverStreamChannel]:
        with self._lock:
            return self._channels.get(run_id)

    def publish(self, run_id: str, payload: Dict[str, Any]) -> None:
        channel = self.get(run_id)
        if channel:
            channel.publish(payload)

    def close(self, run_id: str, payload: Optional[Dict[str, Any]] = None) -> None:
        channel = self.get(run_id)
        if channel:
            channel.close(payload)


stream_manager = SolverStreamManager()


class SolverDebugChannel:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: set[queue.Queue] = set()
        self._closed = False

    def publish(self, line: str) -> None:
        with self._lock:
            if self._closed:
                return
            for subscriber in list(self._subscribers):
                self._publish_to_queue(subscriber, line)

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=200)
        with self._lock:
            self._subscribers.add(q)
        return q

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            for subscriber in list(self._subscribers):
                self._publish_to_queue(subscriber, None)

    def _publish_to_queue(self, q: queue.Queue, line: Optional[str]) -> None:
        try:
            q.put_nowait(line)
        except queue.Full:
            try:
                q.get_nowait()
            except queue.Empty:
                pass
            try:
                q.put_nowait(line)
            except queue.Full:
                pass


class SolverDebugManager:
    def __init__(self) -> None:
        self._channels: Dict[str, SolverDebugChannel] = {}
        self._lock = threading.Lock()

    def create(self, run_id: str) -> SolverDebugChannel:
        with self._lock:
            channel = self._channels.get(run_id)
            if channel is None:
                channel = SolverDebugChannel()
                self._channels[run_id] = channel
            return channel

    def get(self, run_id: str) -> Optional[SolverDebugChannel]:
        with self._lock:
            return self._channels.get(run_id)

    def publish(self, run_id: str, line: str) -> None:
        channel = self.get(run_id)
        if channel:
            channel.publish(line)

    def close(self, run_id: str) -> None:
        channel = self.get(run_id)
        if channel:
            channel.close()


debug_manager = SolverDebugManager()


class SolverRunManager:
    def __init__(self, max_workers: int = 1) -> None:
        self._runs: Dict[str, SolverRunRecord] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        # Prefer fork on Unix to avoid expensive re-imports per solve; fallback to spawn for safety.
        try:
            self._ctx = mp.get_context("fork")
        except ValueError:
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
                "stream": options.stream,
                "allow_online_defenses": options.allow_online_defenses,
                "config_overrides": options.config_overrides,
                "config_yaml": options.config_yaml,
            },
        )
        with self._lock:
            self._runs[run_id] = record
        if options.stream:
            stream_manager.create(run_id)
        debug_manager.create(run_id)
        self._publish_debug(run_id, f"Run submitted: {run_id}")
        logger.info(
            "solver.run.submitted run_id=%s dataset=%s stream=%s timeout=%s solver=%s",
            run_id,
            options.dataset,
            options.stream,
            options.timeout,
            options.solver,
        )
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
            record.latest_snapshot = None
            record.metadata["cancel_requested"] = True
        self._terminate_process(process)
        with self._lock:
            self._processes.pop(run_id, None)
        stream_manager.close(
            run_id,
            {
                "type": "solver-error",
                "payload": {"message": "cancelled"},
                "timestamp": time.time(),
            },
        )
        self._publish_debug(run_id, "Solver cancelled")
        debug_manager.close(run_id)
        return True

    @staticmethod
    def _terminate_process(process: Optional[mp.Process]) -> None:
        if not process:
            return
        if process.is_alive():
            process.terminate()
            process.join(timeout=1)
        if process.is_alive():
            process.kill()
            process.join(timeout=1)

    def _execute(self, run_id: str, options: SolverOptions) -> None:
        start_wall = time.monotonic()
        with self._lock:
            record = self._runs.get(run_id)
            if not record or record.status == "cancelled":
                return
            record.status = "running"
            record.started_at = time.time()
        logger.info("solver.run.started run_id=%s", run_id)
        self._publish_debug(run_id, "Solver started")
        parent_conn, child_conn = self._ctx.Pipe()
        progress_queue: Optional[mp.Queue] = None
        log_queue: Optional[mp.Queue] = self._ctx.Queue(maxsize=1000)
        stop_event = threading.Event()
        log_stop_event = threading.Event()
        consumer_thread: Optional[threading.Thread] = None
        log_thread: Optional[threading.Thread] = None
        if options.stream:
            progress_queue = self._ctx.Queue(maxsize=100)
        process = self._ctx.Process(
            target=_solver_process_entry,
            args=(options, child_conn, progress_queue, log_queue),
        )
        process.daemon = True
        process.start()
        child_conn.close()
        with self._lock:
            self._processes[run_id] = process
            record = self._runs.get(run_id)
            cancel_requested = bool(record and record.status == "cancelled")
        if cancel_requested:
            self._terminate_process(process)
        if log_queue is not None:
            log_thread = threading.Thread(
                target=self._consume_logs,
                args=(run_id, log_queue, log_stop_event),
                daemon=True,
            )
            log_thread.start()
        if options.stream and progress_queue is not None:
            consumer_thread = threading.Thread(
                target=self._consume_progress,
                args=(run_id, options, progress_queue, stop_event),
                daemon=True,
            )
            consumer_thread.start()
        payload: Optional[Tuple[str, Any]] = None
        try:
            deadline = time.time() + options.timeout + 30
            logger.info("execute.loop.start run_id=%s deadline=%s", run_id, deadline - time.time())
            while True:
                if parent_conn.poll(timeout=0.5):
                    payload = parent_conn.recv()
                    logger.info("execute.loop.received run_id=%s", run_id)
                    break
                with self._lock:
                    record = self._runs.get(run_id)
                    if record and record.status == "cancelled":
                        logger.info("execute.loop.cancelled run_id=%s", run_id)
                        break
                if not process.is_alive():
                    logger.info("execute.loop.process_dead run_id=%s exitcode=%s", run_id, process.exitcode)
                    break
                if time.time() >= deadline:
                    if process.is_alive():
                        process.terminate()
                        process.join(timeout=1)
                    logger.info("execute.loop.timeout run_id=%s", run_id)
                    break
        except EOFError:
            logger.info("execute.loop.eof run_id=%s", run_id)
            payload = None
        finally:
            logger.info("execute.finally.start run_id=%s payload=%s", run_id, payload is not None)
            if payload is None and parent_conn.poll():
                try:
                    payload = parent_conn.recv()
                    logger.info("execute.finally.recovered_payload run_id=%s", run_id)
                except EOFError:
                    payload = None
            parent_conn.close()
            if process.is_alive():
                self._terminate_process(process)
            process.join(timeout=1)
            with self._lock:
                self._processes.pop(run_id, None)
            logger.info("execute.finally.stopping_threads run_id=%s", run_id)
            if options.stream and progress_queue is not None:
                stop_event.set()
                if consumer_thread:
                    consumer_thread.join(timeout=1)
            if log_queue is not None:
                log_stop_event.set()
                if log_thread:
                    log_thread.join(timeout=1)
            logger.info("execute.finally.done run_id=%s", run_id)
        logger.info("execute.post_finally run_id=%s payload=%s", run_id, payload is not None)
        # Variables to track what to do outside lock
        final_status = None
        final_result = None
        final_error = None
        with self._lock:
            record = self._runs.get(run_id)
            if not record:
                logger.info("execute.no_record run_id=%s", run_id)
                return
            if record.status == "cancelled":
                logger.info("execute.cancelled run_id=%s", run_id)
                return
            logger.info("execute.processing run_id=%s status=%s", run_id, record.status)
            if not payload:
                record.finished_at = time.time()
                if process.exitcode == 0 and record.latest_snapshot is not None:
                    record.result = record.latest_snapshot
                    record.status = "succeeded"
                    record.error = None
                    final_status = "succeeded_fallback"
                    final_result = record.latest_snapshot
                else:
                    record.status = "failed"
                    record.error = record.error or "Solver process exited unexpectedly"
                    final_status = "failed"
                    final_error = record.error
            else:
                kind, data = payload
                logger.info("execute.payload_kind run_id=%s kind=%s data_present=%s", run_id, kind, data is not None)
                if kind == "success":
                    result = None
                    if data:
                        result = format_solver_response(data, options)
                        logger.info("execute.formatted_result run_id=%s result_present=%s", run_id, result is not None)
                    if result is None and record.latest_snapshot is not None:
                        result = record.latest_snapshot
                    if result is None:
                        record.status = "failed"
                        record.error = "Solver returned empty result"
                        record.finished_at = time.time()
                        final_status = "failed"
                        final_error = record.error
                    else:
                        record.result = result
                        record.status = "succeeded"
                        record.finished_at = time.time()
                        final_status = "succeeded"
                        final_result = result
                else:
                    record.error = str(data)
                    record.status = "failed"
                    record.finished_at = time.time()
                    final_status = "failed"
                    final_error = record.error
        # Outside the lock: do debug publishing and stream operations
        if final_status == "succeeded" or final_status == "succeeded_fallback":
            fallback_label = " (fallback)" if final_status == "succeeded_fallback" else ""
            self._publish_final_debug(run_id, final_result)
            logger.info(
                "solver.run.succeeded run_id=%s duration_sec=%.3f%s",
                run_id,
                time.monotonic() - start_wall,
                fallback_label,
            )
            stream_manager.publish(
                run_id,
                {
                    "type": "final",
                    "payload": final_result,
                    "timestamp": time.time(),
                },
            )
            stream_manager.close(run_id)
            debug_manager.close(run_id)
        elif final_status == "failed":
            self._publish_debug(run_id, f"Solver failed: {final_error}")
            logger.info(
                "solver.run.failed run_id=%s duration_sec=%.3f error=%s",
                run_id,
                time.monotonic() - start_wall,
                final_error,
            )
            stream_manager.close(
                run_id,
                {
                    "type": "solver-error",
                    "payload": {"message": final_error},
                    "timestamp": time.time(),
                },
            )
            debug_manager.close(run_id)

    def _consume_progress(
        self,
        run_id: str,
        options: SolverOptions,
        progress_queue: mp.Queue,
        stop_event: threading.Event,
    ) -> None:
        # Keep processing until we see None (end signal), even after stop_event is set.
        # This prevents race conditions where events are left in the queue.
        logger.info("consumer.started run_id=%s", run_id)
        received_count = 0
        while True:
            try:
                payload = progress_queue.get(timeout=0.25)
            except queue.Empty:
                # Only exit on timeout if stop_event is set
                if stop_event.is_set():
                    logger.info("consumer.stop run_id=%s received=%d", run_id, received_count)
                    break
                continue
            if payload is None:
                logger.info("consumer.end run_id=%s received=%d", run_id, received_count)
                break
            received_count += 1
            logger.info("consumer.payload run_id=%s count=%d", run_id, received_count)
            try:
                result = format_solver_snapshot(payload, options)
                logger.info("consumer.formatted run_id=%s count=%d", run_id, received_count)
                # Extract data from record while holding lock, then release before publishing
                should_log_solution = False
                solution_index = None
                record = None
                with self._lock:
                    record = self._runs.get(run_id)
                    if record:
                        record.latest_snapshot = result
                        solution_index = result.get("solution_index")
                        last_index = record.metadata.get("last_solution_index")
                        if solution_index is not None and solution_index != last_index:
                            record.metadata["last_solution_index"] = solution_index
                            record.solutions.append(result)
                            if len(record.solutions) > 20:
                                record.solutions = record.solutions[-20:]
                            should_log_solution = True
                # Now outside the lock, do debug logging and publishing
                if should_log_solution and record:
                    self._append_debug_snapshot(run_id, record, result)
                    logger.info(
                        "solver.run.solution run_id=%s idx=%s planned=%s adj=%s",
                        run_id,
                        solution_index,
                        result.get("planned_count"),
                        (result.get("objectives") or {}).get("adjacency", {}).get("score"),
                    )
                logger.info("consumer.publishing run_id=%s count=%d", run_id, received_count)
                stream_manager.publish(
                    run_id,
                    {
                        "type": "snapshot",
                        "payload": result,
                        "timestamp": time.time(),
                    },
                )
                logger.info("consumer.published run_id=%s count=%d", run_id, received_count)
            except Exception as proc_err:
                logger.error("consumer.process_error run_id=%s error=%s", run_id, proc_err, exc_info=True)

    def _publish_debug(self, run_id: str, line: str) -> None:
        with self._lock:
            record = self._runs.get(run_id)
            if record is not None:
                record.debug_lines.append(line)
                if len(record.debug_lines) > MAX_DEBUG_LINES:
                    record.debug_lines = record.debug_lines[-MAX_DEBUG_LINES:]
        debug_manager.publish(run_id, line)

    def _append_debug_snapshot(self, run_id: str, record: SolverRunRecord, result: Dict[str, Any]) -> None:
        solution_index = result.get("solution_index")
        summary = result.get("summary") or {}
        planned = summary.get("scheduled", result.get("planned_count"))
        total = summary.get("total", result.get("total_defenses"))
        adjacency = (result.get("objectives") or {}).get("adjacency", {})
        adj_score = adjacency.get("score")
        adj_possible = adjacency.get("possible")
        solve_time_ms = result.get("solve_time_ms", 0)
        timestamp = solve_time_ms / 1000 if solve_time_ms else None
        lines = [
            f"Solution count: {solution_index}",
            f"Solution found in {timestamp:.3f} seconds." if timestamp is not None else "Solution found.",
            f"Adjacency objective: {adj_score} out of {adj_possible}",
            f"Defenses planned: {planned} out of {total}",
        ]
        for line in lines:
            self._publish_debug(run_id, line)

    def _publish_final_debug(self, run_id: str, result: Dict[str, Any]) -> None:
        solve_time_ms = result.get("solve_time_ms", 0)
        timestamp = solve_time_ms / 1000 if solve_time_ms else None
        adjacency = (result.get("objectives") or {}).get("adjacency", {})
        adj_score = adjacency.get("score")
        adj_possible = adjacency.get("possible")
        summary = result.get("summary") or {}
        planned = summary.get("scheduled", result.get("planned_count"))
        total = summary.get("total", result.get("total_defenses"))
        status = result.get("status", "unknown")
        status_label = "Optimal solution found" if status == "optimal" else "Best feasible solution found"
        lines = [
            f"{status_label} in {timestamp:.3f} seconds" if timestamp is not None else status_label,
            f"Adjacency objective: {adj_score} out of {adj_possible}",
            f"Defenses planned: {planned} out of {total}",
            "_______________________",
        ]
        for line in lines:
            self._publish_debug(run_id, line)

    def _consume_logs(
        self,
        run_id: str,
        log_queue: mp.Queue,
        stop_event: threading.Event,
    ) -> None:
        while not stop_event.is_set():
            try:
                line = log_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            if line is None:
                break
            self._publish_debug(run_id, str(line))


def _solver_process_entry(
    options: SolverOptions,
    conn: Connection,
    progress_queue: Optional[mp.Queue],
    log_queue: Optional[mp.Queue],
) -> None:
    try:
        start_wall = time.monotonic()
        if log_queue is not None:
            sys.stdout = _QueueWriter(log_queue)
            sys.stderr = _QueueWriter(log_queue, prefix="[stderr] ")
            logging.basicConfig(
                level=logging.INFO,
                handlers=[logging.StreamHandler(sys.stdout)],
                force=True,
            )
            for name in ("uvicorn.error", "uvicorn.access"):
                log = logging.getLogger(name)
                log.handlers = []
                log.propagate = True
        logger.info(
            "solver.proc.started dataset=%s stream=%s solver=%s",
            options.dataset,
            options.stream,
            options.solver,
        )
        if options.stream and progress_queue is not None:
            def on_progress(payload: Dict[str, Any]) -> None:
                try:
                    progress_queue.put_nowait(payload)
                except Exception:
                    try:
                        progress_queue.get_nowait()
                    except Exception:
                        pass
                    try:
                        progress_queue.put_nowait(payload)
                    except Exception:
                        pass

            raw_result = runner.solve_with_progress(options, on_progress)
        else:
            raw_result = runner.solve(options)
        logger.info(
            "solver.proc.finished dataset=%s duration_sec=%.3f",
            options.dataset,
            time.monotonic() - start_wall,
        )
        if options.stream:
            if progress_queue is not None:
                try:
                    progress_queue.put_nowait(None)
                except Exception:
                    pass
        conn.send(("success", raw_result))
    except Exception as exc:  # pragma: no cover
        logger.info("solver.proc.failed dataset=%s error=%s", options.dataset, exc)
        conn.send(("error", str(exc)))
    finally:
        if log_queue is not None:
            try:
                log_queue.put_nowait(None)
            except Exception:
                pass
        conn.close()


run_manager = SolverRunManager(max_workers=2)

__all__ = ["SolverRunManager", "SolverRunRecord", "run_manager", "stream_manager", "debug_manager"]
