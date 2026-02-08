"""Defense Rostering Solver - Core Package

Constraint-based thesis defense scheduling system with explainability support.
"""

__version__ = "1.0.0"
__author__ = "xCoS Dashboard Research Team"

from .solver import (
    DefenseRosteringModel,
    DEFAULT_SETTINGS,
    create_run_folder,
    compute_utilization,
    compute_slack,
    compute_capacity_gaps,
    compute_blocking_reasons,
    compute_bottleneck_analysis,
    aggregate_relax_candidates,
)

__all__ = [
    "DefenseRosteringModel",
    "DEFAULT_SETTINGS",
    "create_run_folder",
    "compute_utilization",
    "compute_slack",
    "compute_capacity_gaps",
    "compute_blocking_reasons",
    "compute_bottleneck_analysis",
    "aggregate_relax_candidates",
]
