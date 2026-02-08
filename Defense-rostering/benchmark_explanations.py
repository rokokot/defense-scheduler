"""
Scalability benchmarks for the defense rostering explanation pipeline.

Measures wall-clock time for: model construction, solving, MUS extraction,
and MARCO MCS enumeration across problem sizes.

Usage:
    python benchmark_explanations.py
    python benchmark_explanations.py --marco-timeout 30
    python benchmark_explanations.py --max-mcs 20
"""

import csv
import sys
import time
import argparse
import traceback
from copy import deepcopy

from defense_rostering_explanations_test import (
    DEFAULT_SETTINGS,
    DefenseRosteringModel,
    convert_result,
    get_constraints_by_regex_patterns,
    get_group_for_constraint,
)
from cpmpy.tools.explain.mus import mus
from cpmpy.tools.explain.marco import marco


# ---------------------------------------------------------------------------
# Benchmark configurations
# ---------------------------------------------------------------------------

# Each entry: (dataset, no_rooms, no_days, must_plan_all)
# must_plan_all=True forces consistency == 1 (more likely UNSAT on tight instances)
BENCHMARK_CONFIGS = [
    # Toy examples (1 day, few rooms)
    ("documented_example_trivial",        2, 1, True),
    ("documented_example_room_conflict",  2, 1, True),

    # 50 defenses — vary rooms and days
    ("intermediate_2026_50",  2, 1, True),
    ("intermediate_2026_50",  5, 1, True),
    ("intermediate_2026_50",  5, 3, True),
    ("intermediate_2026_50",  5, 5, True),
    ("intermediate_2026_50", 10, 5, True),

    # 100 defenses — vary rooms and days
    ("intermediate_2026_100",  2, 1, True),
    ("intermediate_2026_100",  5, 1, True),
    ("intermediate_2026_100",  5, 3, True),
    ("intermediate_2026_100",  5, 5, True),
    ("intermediate_2026_100", 10, 5, True),

    # Designed-UNSAT 100
    ("unsat_hard_100",  5, 5, True),
    ("unsat_hard_100", 10, 5, True),
]


def make_cfg(dataset, no_rooms, no_days, must_plan_all):
    cfg = deepcopy(DEFAULT_SETTINGS)
    cfg["input_data"] = dataset
    cfg["no_rooms"] = no_rooms
    cfg["no_days"] = no_days
    cfg["must_plan_all_defenses"] = must_plan_all
    cfg["solver"] = "ortools"
    cfg["adjacency_objective"] = False
    cfg["show_feasible"] = False
    cfg["show_optimal"] = False
    return cfg


def run_benchmark(cfg, marco_timeout=60.0, max_mcs=50):
    """Run a single benchmark configuration. Returns a dict of measurements."""
    result = {
        "dataset": cfg["input_data"],
        "no_rooms": cfg["no_rooms"],
        "no_days": cfg["no_days"],
        "must_plan_all": cfg["must_plan_all_defenses"],
        "solver": cfg["solver"],
        "n_defenses": None,
        "n_max_rooms": None,
        "n_timeslots": None,
        "n_boolvars": None,
        "n_groups": None,
        "model_time_s": None,
        "solve_time_s": None,
        "sat_result": None,
        "mus_time_s": None,
        "mus_size": None,
        "marco_first_mcs_s": None,
        "marco_10_mcs_s": None,
        "marco_total_mcs": None,
        "marco_elapsed_s": None,
        "error": None,
    }

    # --- Model construction ---
    try:
        print("    Building model...", flush=True)
        t0 = time.perf_counter()
        model = DefenseRosteringModel(cfg)
        result["model_time_s"] = round(time.perf_counter() - t0, 4)
        print(f"    Model built in {result['model_time_s']}s", flush=True)
    except Exception as e:
        result["error"] = f"model_construction: {e}"
        return result

    result["n_defenses"] = model.no_defenses
    result["n_max_rooms"] = model.max_rooms
    result["n_timeslots"] = model.no_timeslots
    result["n_boolvars"] = model.no_defenses * model.max_rooms * model.no_timeslots
    result["n_groups"] = len(model.groups)

    # --- Solve ---
    try:
        print("    Solving...", flush=True)
        t0 = time.perf_counter()
        sat = model.solve()
        result["solve_time_s"] = round(time.perf_counter() - t0, 4)
        result["sat_result"] = "SAT" if sat else "UNSAT"
        print(f"    Solved in {result['solve_time_s']}s -> {result['sat_result']}", flush=True)
    except Exception as e:
        result["error"] = f"solve: {e}"
        return result

    if sat:
        # SAT — no explanation needed
        return result

    # --- UNSAT: MUS ---
    try:
        print("    Running MUS...", flush=True)
        mus_soft = get_constraints_by_regex_patterns(model, [
            r"^person-unavailable .*$",
            r"^person-overlap .*$",
            r"^room-unavailable .*$",
            r"^room-overlap .*$",
            r"^room-unused .*$",
            r"^day-unused .*$",
        ])
        mus_hard = get_constraints_by_regex_patterns(model, [
            r"^consistency .*$",
            r"^timeslot-illegal .*$",
        ])

        t0 = time.perf_counter()
        expl = mus(soft=mus_soft, hard=mus_hard)
        result["mus_time_s"] = round(time.perf_counter() - t0, 4)
        result["mus_size"] = len(expl)
    except Exception as e:
        result["error"] = f"mus: {e}"
        # Continue to MARCO anyway

    # --- UNSAT: MARCO (MCS enumeration with timeout) ---
    try:
        print("    Running MARCO...", flush=True)
        mcs_soft = get_constraints_by_regex_patterns(model, [
            r"^person-unavailable .*$",
            r"^room-unused .*$",
            r"^day-unused .*$",
        ])
        mcs_hard = get_constraints_by_regex_patterns(model, [
            r"^person-overlap .*$",
            r"^room-unavailable .*$",
            r"^room-overlap .*$",
            r"^consistency .*$",
            r"^timeslot-illegal .*$",
        ])

        marco_gen = marco(
            soft=mcs_soft,
            hard=mcs_hard,
            solver="ortools",
            return_mus=False,
            return_mcs=True,
        )

        t_start = time.perf_counter()
        mcs_count = 0

        for item in marco_gen:
            mcs_count += 1
            elapsed = time.perf_counter() - t_start

            if mcs_count == 1:
                result["marco_first_mcs_s"] = round(elapsed, 4)
            if mcs_count == 10:
                result["marco_10_mcs_s"] = round(elapsed, 4)

            if elapsed > marco_timeout or mcs_count >= max_mcs:
                break

        result["marco_total_mcs"] = mcs_count
        result["marco_elapsed_s"] = round(time.perf_counter() - t_start, 4)

    except Exception as e:
        if result.get("error"):
            result["error"] += f" | marco: {e}"
        else:
            result["error"] = f"marco: {e}"

    return result


def main():
    parser = argparse.ArgumentParser(description="Benchmark defense rostering explanations")
    parser.add_argument("--marco-timeout", type=float, default=60.0,
                        help="Timeout in seconds for MARCO enumeration per config (default: 60)")
    parser.add_argument("--max-mcs", type=int, default=50,
                        help="Max MCSes to enumerate per config (default: 50)")
    parser.add_argument("--output", type=str, default="benchmark_results.csv",
                        help="Output CSV path (default: benchmark_results.csv)")
    args = parser.parse_args()

    fieldnames = [
        "dataset", "no_rooms", "no_days", "must_plan_all", "solver",
        "n_defenses", "n_max_rooms", "n_timeslots", "n_boolvars", "n_groups",
        "model_time_s", "solve_time_s", "sat_result",
        "mus_time_s", "mus_size",
        "marco_first_mcs_s", "marco_10_mcs_s", "marco_total_mcs", "marco_elapsed_s",
        "error",
    ]

    results = []

    for i, (dataset, no_rooms, no_days, must_plan_all) in enumerate(BENCHMARK_CONFIGS):
        label = f"[{i+1}/{len(BENCHMARK_CONFIGS)}] {dataset} rooms={no_rooms} days={no_days}"
        print(f"\n{'='*70}")
        print(f"  {label}")
        print(f"{'='*70}")

        cfg = make_cfg(dataset, no_rooms, no_days, must_plan_all)

        try:
            row = run_benchmark(cfg, marco_timeout=args.marco_timeout, max_mcs=args.max_mcs)
        except Exception as e:
            print(f"  FATAL: {e}")
            traceback.print_exc()
            row = {k: None for k in fieldnames}
            row["dataset"] = dataset
            row["no_rooms"] = no_rooms
            row["no_days"] = no_days
            row["error"] = f"fatal: {e}"

        results.append(row)

        # Print summary
        print(f"  Model:  {row.get('model_time_s', '?')}s  |  "
              f"Solve:  {row.get('solve_time_s', '?')}s  |  "
              f"Result: {row.get('sat_result', '?')}")
        if row.get("sat_result") == "UNSAT":
            print(f"  MUS:    {row.get('mus_time_s', '?')}s  (size={row.get('mus_size', '?')})")
            print(f"  MARCO:  {row.get('marco_elapsed_s', '?')}s  "
                  f"(MCSes={row.get('marco_total_mcs', '?')}, "
                  f"first={row.get('marco_first_mcs_s', '?')}s)")
        if row.get("error"):
            print(f"  ERROR:  {row['error']}")

    # Write CSV
    output_path = args.output
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    print(f"\n{'='*70}")
    print(f"Results written to {output_path}")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
