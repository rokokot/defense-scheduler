"""
Session State Manager for staged relaxations.

Manages per-session state for the conflict resolution workflow,
including staged relaxations pending application.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

from .models.explanation import (
    RelaxationAction,
    StagedRelaxation,
    StagedRelaxationsResponse,
    ValidationResult,
    ExplanationResponse,
)


logger = logging.getLogger("uvicorn.error")


@dataclass
class SessionState:
    """State for a single session."""
    session_id: str
    dataset_id: str
    staged_relaxations: List[StagedRelaxation] = field(default_factory=list)
    last_explanation: Optional[ExplanationResponse] = None
    planned_defense_ids: List[int] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def touch(self):
        """Update the last-accessed timestamp."""
        self.updated_at = time.time()


class SessionManager:
    """
    Manages per-session state for staged relaxations.

    Thread-safe with automatic cleanup of stale sessions.
    """

    def __init__(self, ttl_seconds: int = 3600, cleanup_interval: int = 300):
        """
        Initialize the session manager.

        Args:
            ttl_seconds: Time-to-live for sessions in seconds (default: 1 hour).
            cleanup_interval: Interval for cleanup task in seconds (default: 5 minutes).
        """
        self._sessions: Dict[str, SessionState] = {}
        self._lock = threading.RLock()
        self._ttl = ttl_seconds
        self._cleanup_interval = cleanup_interval
        self._cleanup_thread: Optional[threading.Thread] = None
        self._stop_cleanup = threading.Event()

    def start_cleanup_task(self):
        """Start the background cleanup task."""
        if self._cleanup_thread is not None:
            return

        def cleanup_loop():
            while not self._stop_cleanup.wait(timeout=self._cleanup_interval):
                self._cleanup_stale_sessions()

        self._cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
        self._cleanup_thread.start()

    def stop_cleanup_task(self):
        """Stop the background cleanup task."""
        self._stop_cleanup.set()
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=5)
            self._cleanup_thread = None

    def get_or_create(self, session_id: str, dataset_id: str) -> SessionState:
        """
        Get existing session or create a new one.

        Args:
            session_id: Session identifier.
            dataset_id: Dataset being scheduled.

        Returns:
            SessionState for the session.
        """
        with self._lock:
            if session_id in self._sessions:
                session = self._sessions[session_id]
                # Update dataset_id if it changed
                if session.dataset_id != dataset_id:
                    session.dataset_id = dataset_id
                    session.staged_relaxations = []  # Clear staged on dataset change
                session.touch()
                return session

            session = SessionState(
                session_id=session_id,
                dataset_id=dataset_id
            )
            self._sessions[session_id] = session
            return session

    def get(self, session_id: str) -> Optional[SessionState]:
        """
        Get a session by ID.

        Args:
            session_id: Session identifier.

        Returns:
            SessionState if found, None otherwise.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.touch()
            return session

    def stage_relaxation(
        self,
        session_id: str,
        relaxation: RelaxationAction
    ) -> StagedRelaxation:
        """
        Add a relaxation to staging.

        Args:
            session_id: Session identifier.
            relaxation: The relaxation action to stage.

        Returns:
            The staged relaxation with metadata.

        Raises:
            KeyError: If session doesn't exist.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise KeyError(f"Session not found: {session_id}")

            # Check for duplicates
            for existing in session.staged_relaxations:
                if existing.relaxation.id == relaxation.id:
                    # Already staged, just return it
                    return existing

            staged = StagedRelaxation(
                id=str(uuid.uuid4()),
                relaxation=relaxation,
                staged_at=time.time(),
                status="pending"
            )
            session.staged_relaxations.append(staged)
            session.touch()
            return staged

    def unstage_relaxation(self, session_id: str, relaxation_id: str) -> bool:
        """
        Remove a relaxation from staging.

        Args:
            session_id: Session identifier.
            relaxation_id: ID of the staged relaxation to remove.

        Returns:
            True if removed, False if not found.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return False

            original_len = len(session.staged_relaxations)
            session.staged_relaxations = [
                s for s in session.staged_relaxations
                if s.id != relaxation_id and s.relaxation.id != relaxation_id
            ]
            session.touch()
            return len(session.staged_relaxations) < original_len

    def get_staged(self, session_id: str) -> List[StagedRelaxation]:
        """
        Get all staged relaxations for a session.

        Args:
            session_id: Session identifier.

        Returns:
            List of staged relaxations.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return []
            session.touch()
            return list(session.staged_relaxations)

    def get_staged_response(self, session_id: str) -> StagedRelaxationsResponse:
        """
        Get staged relaxations as a response object.

        Args:
            session_id: Session identifier.

        Returns:
            StagedRelaxationsResponse with staged relaxations and estimated impact.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return StagedRelaxationsResponse(
                    session_id=session_id,
                    staged=[],
                    estimated_impact={}
                )

            session.touch()

            # Compute estimated impact (simplified - count relaxations per type)
            impact: Dict[str, int] = {}
            for staged in session.staged_relaxations:
                relax = staged.relaxation
                key = f"{relax.type.value}:{relax.target.entity}"
                impact[key] = impact.get(key, 0) + relax.estimated_impact

            return StagedRelaxationsResponse(
                session_id=session_id,
                staged=list(session.staged_relaxations),
                estimated_impact=impact
            )

    def validate_staged(self, session_id: str) -> ValidationResult:
        """
        Validate staged relaxations server-side.

        Checks for:
        - Valid relaxation types
        - Non-empty targets
        - No conflicting relaxations

        Args:
            session_id: Session identifier.

        Returns:
            ValidationResult with validation status and any errors.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return ValidationResult(
                    valid=False,
                    errors=[f"Session not found: {session_id}"]
                )

            errors: List[str] = []
            warnings: List[str] = []

            for staged in session.staged_relaxations:
                relax = staged.relaxation

                # Validate type
                if relax.type is None:
                    errors.append(f"Relaxation {relax.id} has no type")
                    continue

                # Validate target
                if not relax.target or not relax.target.entity:
                    errors.append(f"Relaxation {relax.id} has empty target")
                    continue

                # Check for empty slots when required
                if relax.type.value == "person_availability" and not relax.target.slots:
                    warnings.append(
                        f"Relaxation {relax.id} for {relax.target.entity} has no specific slots"
                    )

            # Update validation status on staged items
            for staged in session.staged_relaxations:
                if any(relax.id in err for err in errors for relax in [staged.relaxation]):
                    staged.status = "error"
                    staged.validation_error = "Validation failed"
                else:
                    staged.status = "validated"
                    staged.validation_error = None

            session.touch()

            return ValidationResult(
                valid=len(errors) == 0,
                errors=errors,
                warnings=warnings
            )

    def clear_session(self, session_id: str) -> bool:
        """
        Clear all staged changes for a session.

        Args:
            session_id: Session identifier.

        Returns:
            True if session was found and cleared, False otherwise.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return False

            session.staged_relaxations = []
            session.last_explanation = None
            session.touch()
            return True

    def delete_session(self, session_id: str) -> bool:
        """
        Delete a session entirely.

        Args:
            session_id: Session identifier.

        Returns:
            True if deleted, False if not found.
        """
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
            return False

    def update_planned_defenses(
        self,
        session_id: str,
        planned_defense_ids: List[int]
    ) -> None:
        """
        Update the list of planned defense IDs for a session.

        Args:
            session_id: Session identifier.
            planned_defense_ids: New list of planned defense IDs.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.planned_defense_ids = list(planned_defense_ids)
                session.touch()

    def store_explanation(
        self,
        session_id: str,
        explanation: ExplanationResponse
    ) -> None:
        """
        Store the last explanation result for a session.

        Args:
            session_id: Session identifier.
            explanation: The explanation response to store.
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.last_explanation = explanation
                session.touch()

    def _cleanup_stale_sessions(self) -> int:
        """
        Remove sessions that have exceeded their TTL.

        Returns:
            Number of sessions removed.
        """
        cutoff = time.time() - self._ttl
        removed = 0

        with self._lock:
            stale = [
                sid for sid, session in self._sessions.items()
                if session.updated_at < cutoff
            ]
            for sid in stale:
                del self._sessions[sid]
                removed += 1

        if removed > 0:
            logger.info(f"Cleaned up {removed} stale session(s)")

        return removed

    def get_session_count(self) -> int:
        """Get the current number of active sessions."""
        with self._lock:
            return len(self._sessions)


# Global singleton instance
_manager: Optional[SessionManager] = None


def get_session_manager() -> SessionManager:
    """Get or create the session manager singleton."""
    global _manager
    if _manager is None:
        _manager = SessionManager()
        _manager.start_cleanup_task()
    return _manager
