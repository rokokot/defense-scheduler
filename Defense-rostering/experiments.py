import subprocess
import csv

solvers = ['ortools', 'exact', 'gurobi']

csv_path = "experimental_results/solve_times_per_solver.csv"
try:
    with open(csv_path, "x", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["no_defenses", "solver", "solve_time"])
except FileExistsError:
    pass

for no_defenses in range(1,66):
    for solver in solvers:
        result = subprocess.run(
            rf"python defense-rostering.py --config .\example-configs\config-2021-without-obj.yaml --number-of-defenses-in-problem {no_defenses} --solver {solver}",
            capture_output=True,
            shell=True,
            text = True
        )

        solve_time = result.stdout.strip()

        # Append to CSV and flush so the row appears immediately
        with open(csv_path, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([no_defenses, solver, solve_time])
            f.flush()  # <--- force immediate write to disk

        print(f"Logged: no_defenses={no_defenses}, solver={solver}, time={solve_time}")