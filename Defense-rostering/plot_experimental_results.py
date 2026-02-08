import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

def plot_cactus(csv_path, rows_col=None, time_col=None,
                log_scale=False, annotate_every=0, figsize=(8,5)):
    """
    Create a cactus-style plot from a CSV file with two columns:
    - amount of rows
    - run time (seconds)

    Parameters
    ----------
    csv_path : str
        Path to CSV file
    rows_col : str or int (optional)
        Column for "amount of rows". If None, use first column.
    time_col : str or int (optional)
        Column for "run time". If None, use second column.
    log_scale : bool
        Whether to use log-scale on runtime axis.
    annotate_every : int
        Annotate every N-th point with its 'rows' value (0 = no annotations).
    figsize : tuple
        Matplotlib figure size.
    """

    # Load data
    df = pd.read_csv(csv_path)

    # Auto-detect columns if not provided
    if rows_col is None:
        rows_col = df.columns[0]
    if time_col is None:
        time_col = df.columns[1]

    # Ensure numeric & clean
    data = df[[rows_col, time_col]].copy()
    data.columns = ["rows", "time"]
    data["rows"] = pd.to_numeric(data["rows"], errors="coerce")
    data["time"] = pd.to_numeric(data["time"], errors="coerce")
    data = data.dropna().reset_index(drop=True)

    # Sort by runtime (fastest first)
    data = data.sort_values("time").reset_index(drop=True)
    data["rank"] = np.arange(1, len(data) + 1)

    # Plotting
    fig, ax = plt.subplots(figsize=figsize)
    ax.plot(data["rank"], data["time"], marker="o", markersize=4, linewidth=1)

    ax.set_xlabel("Instances (sorted by runtime) — rank")
    ax.set_ylabel("Run time (seconds)")
    ax.set_title("Cactus-style Plot")

    if log_scale:
        ax.set_yscale("log")

    # Optional annotations (e.g., annotate every 10th point)
    if annotate_every > 0:
        for i, row in data.iloc[::annotate_every].iterrows():
            ax.annotate(
                str(int(row["rows"])),
                (row["rank"], row["time"]),
                textcoords="offset points",
                xytext=(0, 6),
                ha="center",
                fontsize=8
            )

    # Secondary x-axis showing rows at selected ranks
    def identity(x):
        return x

    secax = ax.secondary_xaxis("top", functions=(identity, identity))
    if len(data) <= 10:
        tick_positions = data["rank"].tolist()
    else:
        tick_positions = data["rank"].iloc[::max(1, len(data)//10)].tolist()

    secax.set_xticks(tick_positions)
    secax.set_xticklabels(
        [str(int(data.loc[t-1, "rows"])) for t in tick_positions],
        rotation=45,
        fontsize=8
    )
    secax.set_xlabel("Amount of rows")

    ax.grid(True, linestyle=":", linewidth=0.5)
    plt.tight_layout()
    plt.show()

    return data


import pandas as pd
import matplotlib.pyplot as plt
import numpy as np


def plot_cactus_multi(csv_path, rows_col=None, solver_col=None, time_col=None,
                      log_scale=False, annotate_every=0, figsize=(10, 6)):
    """
    Create a cactus-style plot where each solver gets its own curve.

    Expected CSV column order:
        1. amount of rows
        2. solver
        3. runtime (seconds)
    """

    # Load data
    df = pd.read_csv(csv_path)

    # Auto-detect column positions
    # -----------------------------------
    if rows_col is None:
        rows_col = df.columns[0]  # first column

    if solver_col is None:
        solver_col = df.columns[1]  # second column  (NEW)

    if time_col is None:
        time_col = df.columns[2]  # third column
    # -----------------------------------

    # Keep only needed columns
    df = df[[rows_col, solver_col, time_col]].copy()
    df.columns = ["rows", "solver", "time"]

    # Numeric conversion
    df["rows"] = pd.to_numeric(df["rows"], errors="ignore")
    df["time"] = pd.to_numeric(df["time"], errors="coerce")
    df = df.dropna().reset_index(drop=True)

    # Plot setup
    fig, ax = plt.subplots(figsize=figsize)

    # One cactus line per solver
    solvers = df["solver"].unique()
    for solver in solvers:
        subset = df[df["solver"] == solver].copy()

        # Sort by runtime
        subset = subset.sort_values("time").reset_index(drop=True)
        subset["rank"] = np.arange(1, len(subset) + 1)

        ax.plot(subset["rank"], subset["time"],
                marker="o", linewidth=1, markersize=4, label=solver)

        # Optional annotations
        if annotate_every > 0:
            for _, row in subset.iloc[::annotate_every].iterrows():
                ax.annotate(
                    str(int(row["rows"])),
                    (row["rank"], row["time"]),
                    textcoords="offset points",
                    xytext=(0, 6),
                    ha="center",
                    fontsize=8,
                )

    # Labels, legend, grid
    ax.set_xlabel("Instances solved")
    ax.set_ylabel("Run time (seconds)")
    ax.set_title("Defense Rostering (June 2021) - Cactus Plot")

    if log_scale:
        ax.set_yscale("log")

    ax.grid(True, linestyle=":", linewidth=0.5)
    ax.legend(title="Solver")

    plt.tight_layout()
    plt.show()


# Example usage

import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt



def plot_cactus_ecdf(csv_path, rows_col=None, solver_col=None, time_col=None,
                     log_scale=False, figsize=(10, 6)):
    """
    Cactus plot using seaborn.ecdfplot, one curve per solver,
    with proper legend showing solver names from the CSV.
    """

    # Load CSV
    df = pd.read_csv(csv_path)

    # Auto-detect columns
    if rows_col is None:
        rows_col = df.columns[0]
    if solver_col is None:
        solver_col = df.columns[1]
    if time_col is None:
        time_col = df.columns[2]

    df = df[[rows_col, solver_col, time_col]].copy()
    df.columns = ["rows", "solver", "time"]

    # Ensure numeric
    df["time"] = pd.to_numeric(df["time"], errors="coerce")
    df = df.dropna().reset_index(drop=True)

    # Plot ECDF: one call per solver with explicit label
    plt.figure(figsize=figsize)
    solvers = df["solver"].unique()
    for solver in solvers:
        subset = df[df["solver"] == solver]
        sns.ecdfplot(data=subset, x="time", label=solver, marker="o", stat='count')

    # Labels and title
    plt.xlabel("Run time (seconds)")
    plt.ylabel("Instances solved (CDF)")
    plt.title("Defense Rostering June 2021 - Inverse Cactus Plot (ECDF)")

    if log_scale:
        plt.xscale("log")

    plt.grid(True, linestyle=":", linewidth=0.5)
    plt.legend(title="Solver", loc="lower right")
    plt.tight_layout()
    plt.show()

# Example usage
plot_cactus_ecdf("experimental_results/solve_times_per_solver.csv")