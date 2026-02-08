import argparse
import json
import subprocess
import csv
from pathlib import Path
import pandas as pd
import re
import json
import csv
import shutil
from pathlib import Path
from copy import deepcopy
from datetime import datetime, timedelta


DEFAULT_INPUT_DATA = "documented_example_evaluator_conflict"
parser = argparse.ArgumentParser(description="Defense rostering script")
parser.add_argument(
    "--input-data",
    type=str,
    default=DEFAULT_INPUT_DATA,
    help=f"Name of the input CSV file (default: {DEFAULT_INPUT_DATA})"
)
def str2bool(v):
    if isinstance(v, bool):
        return v
    if v.lower() in ("true", "1", "yes"):
        return True
    if v.lower() in ("false", "0", "no"):
        return False
    raise argparse.ArgumentTypeError("Boolean value expected")

parser.add_argument(
    "--must-fix-defenses",
    type=str2bool,
    nargs="?",
    const=True,
    default=False,
    help="Whether planned defenses must be fixed in place"
)

# Parse arguments
args = parser.parse_args()
INPUT_DATA = args.input_data
must_fix_defenses = args.must_fix_defenses


def _parse_angle_brackets(text):
    """
    Extract all <...> parts from a string.
    Returns a list of strings without the brackets.
    """
    return re.findall(r"<([^>]+)>", text)

def apply_repair_choice(choice, stdout, num_repairs, input_data_name):
    """
    Apply the selected repair option to a deep copy of the input data.
    """

    # ---- extract the repair list from stdout ----
    pattern = rf"Repair option {choice}:\s*(.+)"
    match = re.search(pattern, stdout)
    if not match:
        raise ValueError(f"Repair option {choice} not found in stdout")

    repair_raw = match.group(1).strip()

    # Expecting something like: ['extra-day', 'extra-room R3', ...]
    repair_list = eval(repair_raw)  # assumes trusted output
    if not isinstance(repair_list, list):
        raise ValueError("Parsed repair is not a list")

    # ---- prepare repaired input directory ----
    base_dir = Path("input_data")
    original_dir = base_dir / input_data_name
    repaired_dir = base_dir / f"{input_data_name}_repaired"

    if repaired_dir.exists():
        shutil.rmtree(repaired_dir)

    shutil.copytree(original_dir, repaired_dir)

    # ---- apply each repair ----
    for repair in repair_list:
        if repair.startswith("extra-day"):
            _apply_extra_day(repaired_dir)

        elif repair.startswith("extra-room"):
            _, room = repair.split(maxsplit=1)
            _apply_extra_room(repaired_dir, room)

        elif repair.startswith("person-unavailable"):
            _apply_person_unavailable(repaired_dir, repair)

        elif repair.startswith("enable-room"):
            _apply_enable_room(repaired_dir, repair)

        else:
            raise ValueError(f"Unknown repair action: {repair}")


def _apply_extra_day(repaired_dir):
    path = repaired_dir / "timeslot_info.json"

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    data["number_of_days"] += 1

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _apply_extra_room(repaired_dir, room):
    path = repaired_dir / "rooms.json"

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if "rooms" not in data or not isinstance(data["rooms"], list):
        raise ValueError("rooms.json has unexpected structure")

    if room not in data["rooms"]:
        data["rooms"].append(room)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def _apply_enable_room(repaired_dir, repair):
    """
    Apply an "enable-room" repair by setting enabled: true.

    repair format: enable-room <Room Name>
    """
    parts = _parse_angle_brackets(repair)
    if len(parts) != 1:
        raise ValueError(f"Invalid enable-room repair: {repair}")

    room_name = parts[0]
    path = repaired_dir / "rooms.json"

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Find and enable the room
    for room in data["rooms"]:
        if isinstance(room, dict) and room.get("name") == room_name:
            room["enabled"] = True
            break

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _apply_person_unavailable(repaired_dir, repair):
    """
    Apply a "person-unavailable" repair to the CSV file.

    repair format:
        person-unavailable <Person Name> <YYYY-MM-DD HH:MM:SS>
    """
    repaired_dir = Path(repaired_dir)
    parts = _parse_angle_brackets(repair)

    if len(parts) != 2:
        raise ValueError(f"Invalid person-unavailable repair: {repair}")

    person, datetime_str = parts
    target_dt = datetime.strptime(datetime_str, "%Y-%m-%d %H:%M:%S")
    one_hour = timedelta(hours=1)

    csv_path = repaired_dir / "unavailabilities.csv"

    # Read all rows
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    new_rows = []

    for row in rows:
        # Skip rows that don't match person or date
        if row["name"] != person or row["day"] != target_dt.strftime("%Y-%m-%d"):
            new_rows.append(row)
            continue

        # Parse start and end datetimes
        start_dt = datetime.strptime(f'{row["day"]} {row["start_time"]}', "%Y-%m-%d %H:%M")
        end_dt = datetime.strptime(f'{row["day"]} {row["end_time"]}', "%Y-%m-%d %H:%M")

        # Check if the target hour overlaps
        repair_start = target_dt
        repair_end = target_dt + one_hour

        if repair_end <= start_dt or repair_start >= end_dt:
            # No overlap
            new_rows.append(row)
            continue

        # Split existing segment if necessary
        if start_dt < repair_start:
            new_rows.append({
                **row,
                "start_time": start_dt.strftime("%H:%M"),
                "end_time": repair_start.strftime("%H:%M")
            })

        if repair_end < end_dt:
            new_rows.append({
                **row,
                "start_time": repair_end.strftime("%H:%M"),
                "end_time": end_dt.strftime("%H:%M")
            })

    # Write back modified CSV
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(new_rows)

first_iteration = True

while first_iteration or unplanned:
    # --------------------------------------------------
    # Step 1: first call
    # --------------------------------------------------
    if first_iteration:
        cmd = [
            "python", "defense_rostering.py",
            "--input-data", INPUT_DATA,
            "--must-plan-all-defenses", "false",
            "--model", "scheduling",
            "--adjacency-objective", "false",
            "--show-optimal", "true"
        ]

    else:

        cmd = [
            "python", "defense_rostering.py",
            "--input-data", INPUT_DATA,
            "--must-plan-all-defenses", "false",
            "--model", "scheduling",
            "--adjacency-objective", "false",
            "--show-optimal", "true",
            "--planned-defenses", *map(str, planned),
            "--output-data", str(output_folder_solve),
            "--must-fix-defenses", str(must_fix_defenses),
        ]

    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=True,
    )

    # --------------------------------------------------
    # Extract output folder from stdout
    # --------------------------------------------------
    import re

    output_folder_solve = None
    pattern = re.compile(r"Output folder:\s*(.+)")

    for line in proc.stdout.splitlines():
        m = pattern.search(line)
        if m:
            output_folder_solve = Path(m.group(1))
            break

    if output_folder_solve is None:
        raise RuntimeError("Could not detect output folder from defense-rostering output")

    print('___________________________')
    print("Detected output folder:", output_folder_solve)
    print()

    # --------------------------------------------------
    # Step 2: inspect output.csv
    # --------------------------------------------------

    planned = []
    unplanned = []
    output_csv = output_folder_solve / "output.csv"
    with output_csv.open(newline="") as f:
        reader = csv.DictReader(f)
        defense_id = 0
        planned_names = []
        unplanned_names = []
        for row in reader:
            day = row.get("day")

            if day is not None and day != "":
                planned.append(defense_id)
                planned_names.append(row.get("student"))
            else:
                unplanned.append(defense_id)
                unplanned_names.append(row.get("student"))
            defense_id += 1

    # --------------------------------------------------
    # Step 3: branch
    # --------------------------------------------------

    print('Planned: ', planned_names)
    print('Unplanned: ', unplanned_names)
    print()


    if not unplanned:
        print("Satisfiable problem: solution streaming begins")
        cmd = [
            "python", "defense_rostering.py",
            "--input-data", INPUT_DATA,
            "--solution-streaming", "true",
            "--must-plan-all-defenses", "true",
            "--model", "allocation_intvar",
            "--adjacency-objective", "true",
            "--show-optimal", "true"
        ]

        proc = subprocess.run(
            cmd,
            check=True,
        )



    else:



        print("Unsatisfiable problem: explanations begin")
        print()

        for i, name in enumerate(unplanned_names, start=1):
            print(f"{i}. {name}")

        while True:
            choice = input("Select a name by number: ")
            if choice.isdigit():
                idx = int(choice) - 1
                if 0 <= idx < len(unplanned_names):
                    selected_name = unplanned_names[idx]
                    break
            print("Invalid choice. Please enter a number from the list.")

        print("You selected:", selected_name)

        input_folder = Path("input_data")

        csv_path = input_folder / INPUT_DATA / 'defences.csv'
        df = pd.read_csv(csv_path)

        # Find the row(s) where 'student' matches selected_name
        row = df[df['student'] == selected_name]

        if row.empty:
            print(f"No data found for student: {selected_name}")
        else:
            # Print all other columns with their headers on one line
            for _, r in row.iterrows():
                # Skip 'student' column
                other_columns = {col: r[col] for col in df.columns if col != 'student'}
                # Format as "Column: value"
                output = ", ".join(f"{k}: {v}" for k, v in other_columns.items())
                print(f"{selected_name} -> {output}")
                print()



        print(f"Why can {selected_name}'s defense not be planned, and what repair options are there?")
        print()

        cmd = [
            "python", "defense_rostering_explanation.py",
            "--input-data", str(INPUT_DATA),
            "--planned-defenses", *map(str, planned),
            "--output-data", str(output_folder_solve),
            "--must-fix-defenses", str(must_fix_defenses),
            "--defense-to-plan", str(unplanned[idx])
        ]

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
        )

        stdout = proc.stdout

        # ---- parse output folder ----
        m_folder = re.search(
            r"Explanations and repairs streamed to:\s*(.+)",
            stdout
        )
        if not m_folder:
            raise ValueError("Output folder not found in subprocess output")

        output_folder_explain = Path(m_folder.group(1).strip())

        # ---- parse number of repair options ----
        m_n = re.search(
            r"Number of repair options:\s*(\d+)",
            stdout
        )
        if not m_n:
            raise ValueError("Number of repair options not found in subprocess output")

        num_repairs = int(m_n.group(1))

        match = re.search(r"Explanation:\s*(.+)", stdout)
        if match:
            expl_content = match.group(1)
            print("Explanation: ", expl_content)
            print()



        patterns = {
            counter: re.compile(rf"Repair option {counter}:")
            for counter in range(1, num_repairs + 1)
        }

        lines = stdout.splitlines()

        for line in lines:
            for counter, pattern in patterns.items():
                if pattern.search(line):
                    print(line)

        # ---- user selection ----
        print("Explanations and repairs streamed to: ", output_folder_explain)
        print()
        print("Number of repair options: ", num_repairs)


        while True:
            try:
                choice = int(input(f"Choose a repair option (1–{num_repairs}): "))
                if 1 <= choice <= num_repairs:
                    break
                print("Invalid choice.")
            except ValueError:
                print("Please enter a number.")

        apply_repair_choice(
            choice=choice,
            stdout=stdout,
            num_repairs=num_repairs,
            input_data_name=INPUT_DATA,
        )

        INPUT_DATA = INPUT_DATA + '_repaired'

        first_iteration = False


