import argparse
import json
import yaml
import os
import csv
import random
from datetime import date, timedelta

# --- Expected columns / keys ---
EXPECTED_DEFENCES_COLUMNS = [
    "student",
    "title",
    "supervisor",
    "co_supervisor",
    "assessor1",
    "assessor2",
    "mentor1",
    "mentor2",
    "mentor3",
    "mentor4"
]

EXPECTED_UNAVAIL_COLUMNS = ["name", "type", "day", "start_time", "end_time"]
EXPECTED_ROOMS_KEYS = ["rooms"]
EXPECTED_TIMESLOT_KEYS = ["first_day", "number_of_days", "start_hour", "end_hour"]


# --- Config loading ---
def load_config_file(path):
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Config file not found: {path}")

    ext = os.path.splitext(path)[1].lower()
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()

    if not content:
        print(f"Warning: config file '{path}' is empty. Skipping.")
        return {}

    try:
        if ext in [".yaml", ".yml"]:
            return yaml.safe_load(content) or {}
        elif ext == ".json":
            return json.loads(content)
        else:
            raise ValueError(f"Unsupported config format '{ext}'. Use .json, .yaml, or .yml.")
    except Exception as e:
        raise ValueError(f"Error parsing config file '{path}': {e}") from e


# --- Argument parsing ---
def parse_args():
    parser = argparse.ArgumentParser()

    # Instance naming
    parser.add_argument("--name", type=str, default="instance01")

    # Problem size
    parser.add_argument("--number-of-evaluators", type=int, default=20)
    parser.add_argument("--number-of-defenses", type=int, default=30)
    parser.add_argument("--number-of-rooms", type=int, default=5)
    parser.add_argument("--number-of-days", type=int, default=3)

    # Time window
    parser.add_argument("--first-day", type=str, default="2025-06-01")
    parser.add_argument("--start-hour", type=int, default=9)
    parser.add_argument("--end-hour", type=int, default=17)

    # Cluster
    parser.add_argument("--number-of-clusters", type=int, default=5)
    parser.add_argument("--cluster-odds", type=float, default=0.8)

    # Availability
    parser.add_argument("--room-available-odds", type=float, default=0.75)
    parser.add_argument("--person-available-odds", type=float, default=0.75)

    # Co-supervisor / mentor odds
    parser.add_argument("--co-supervisor-odds", type=float, default=0.5)
    parser.add_argument("--mentor1-odds", type=float, default=0.9)
    parser.add_argument("--mentor2-odds", type=float, default=0.3)
    parser.add_argument("--mentor3-odds", type=float, default=0.1)
    parser.add_argument("--mentor4-odds", type=float, default=0.1)

    # Config file
    parser.add_argument("--config", type=str, default=None)

    args = parser.parse_args()

    if args.config:
        cfg = load_config_file(args.config)
        for k, v in cfg.items():
            if hasattr(args, k):
                setattr(args, k, v)

    return args


# --- Helper: pick a person from cluster or globally ---
def pick_from_cluster_or_all(person_list, person_cluster, cluster, odds, used=None):
    if used is None:
        used = set()
    if random.random() < odds:
        pool = [p for p in person_list if person_cluster[p] == cluster and p not in used]
    else:
        pool = [p for p in person_list if p not in used]
    if not pool:
        return None
    choice = random.choice(pool)
    used.add(choice)
    return choice


# --- Generate random unavailability spans ---
def generate_unavailability_spans(name, type_, days, start_hour, end_hour, available_odds):
    """
    Generate unavailability spans for a room or person.
    Each span is a random contiguous block of hours.
    """
    entries = []
    total_window = end_hour - start_hour

    for day in days:
        hour = start_hour
        while hour < end_hour:
            span_length = random.randint(1, total_window)
            span_end = min(end_hour, hour + span_length)

            if random.random() > available_odds:
                entries.append([
                    name,
                    type_,
                    day.strftime("%Y-%m-%d"),
                    f"{hour:02d}:00",
                    f"{span_end:02d}:00"
                ])
            hour = span_end

    return entries


# --- Generate the full dataset ---
def generate_data(args):
    random.seed(0)

    # Evaluators
    eval_names = [f"Person_{i+1}" for i in range(args.number_of_evaluators)]
    person_cluster = {p: random.randint(0, args.number_of_clusters - 1) for p in eval_names}

    # Students
    students = [f"Student_{i+1}" for i in range(args.number_of_defenses)]
    defense_cluster = {s: random.randint(0, args.number_of_clusters - 1) for s in students}

    defenses = []
    for idx, student in enumerate(students):
        cluster = defense_cluster[student]
        used_roles = set()

        title = ""  # empty title
        supervisor = pick_from_cluster_or_all(eval_names, person_cluster, cluster, 1.0, used_roles)
        co_supervisor = pick_from_cluster_or_all(eval_names, person_cluster, cluster, args.cluster_odds, used_roles) if random.random() < args.co_supervisor_odds else ""
        assessor1 = pick_from_cluster_or_all(eval_names, person_cluster, cluster, args.cluster_odds, used_roles)
        assessor2 = pick_from_cluster_or_all(eval_names, person_cluster, cluster, args.cluster_odds, used_roles)

        # Mentors
        mentors = []
        if random.random() < args.mentor1_odds:
            m1 = pick_from_cluster_or_all(eval_names, person_cluster, cluster, args.cluster_odds, used_roles)
            mentors.append(m1)
        else:
            mentors.append("")
        if mentors[0] and random.random() < args.mentor2_odds:
            m2 = pick_from_cluster_or_all(eval_names, person_cluster, cluster, args.cluster_odds, used_roles)
            mentors.append(m2)
        else:
            mentors.append("")
        if mentors[1] and random.random() < args.mentor3_odds:
            m3 = pick_from_cluster_or_all(eval_names, person_cluster, cluster, args.cluster_odds, used_roles)
            mentors.append(m3)
        else:
            mentors.append("")
        if mentors[2] and random.random() < args.mentor4_odds:
            m4 = pick_from_cluster_or_all(eval_names, person_cluster, cluster, args.cluster_odds, used_roles)
            mentors.append(m4)
        else:
            mentors.append("")

        defenses.append([
            student, title, supervisor, co_supervisor, assessor1, assessor2,
            mentors[0], mentors[1], mentors[2], mentors[3]
        ])

    # Rooms
    rooms = [{"name": f"Room_{i+1}"} for i in range(args.number_of_rooms)]
    timeslot_info = {
        "first_day": args.first_day,
        "number_of_days": args.number_of_days,
        "start_hour": args.start_hour,
        "end_hour": args.end_hour
    }

    # Days for availability
    days_list = [date.fromisoformat(args.first_day) + timedelta(days=d) for d in range(args.number_of_days)]

    # Unavailabilities
    person_unavail = []
    for person in eval_names:
        person_unavail.extend(generate_unavailability_spans(
            person, "person", days_list, args.start_hour, args.end_hour, args.person_available_odds
        ))

    room_unavail = []
    for room in rooms:
        room_unavail.extend(generate_unavailability_spans(
            room["name"], "room", days_list, args.start_hour, args.end_hour, args.room_available_odds
        ))

    unavailabilities = person_unavail + room_unavail

    return defenses, unavailabilities, rooms, timeslot_info


# --- Write files ---
def write_output(name, defenses, unavailabilities, rooms, timeslot_info):
    base = f"input_data/{name}/"
    os.makedirs(base, exist_ok=True)

    # defenses.csv
    with open(base + "defences.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(EXPECTED_DEFENCES_COLUMNS)
        for row in defenses:
            writer.writerow(row)

    # unavailabilities.csv
    with open(base + "unavailabilities.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(EXPECTED_UNAVAIL_COLUMNS)
        for row in unavailabilities:
            writer.writerow(row)

    # rooms.json
    with open(base + "rooms.json", "w", encoding="utf-8") as f:
        room_names = [r["name"] for r in rooms]  # convert to list of strings
        json.dump({"rooms": room_names}, f, indent=2)

    # timeslot_info.json
    with open(base + "timeslot_info.json", "w", encoding="utf-8") as f:
        json.dump(timeslot_info, f, indent=2)


# --- Main ---
def main():
    args = parse_args()
    defenses, unavailabilities, rooms, timeslot_info = generate_data(args)
    write_output(args.name, defenses, unavailabilities, rooms, timeslot_info)


if __name__ == "__main__":
    main()

# To do: have n clusters of people, these clusters decide the odds of being assigned to a certain defense
# cluster-odds chance that someone chosen as evaluator is from the same cluster as the cluster that the defense belongs to
# except: 100% for the supervisor


# To do: use random spans to simulate room and person availability
# Random number between 1 and (end_hour - start_hour), and the following choice (available/unavailable) holds for that whole timespan

# To do: do not simulate room and person availability for timeslots before start_hour or after/equal to end_hour

# Configuration settings
# --name : name of the instance
# --number-of-evaluators : number of evaluators considered in the problem
# --number-of-defenses : number of defenses considered in the problem
# --number-of-rooms: number of rooms considered in the problem
# --number-of-days: number of days considered in the problem
# --first-day: the first day considered in the problem
# --start-hour: the first hour that defenses can be planned (integer) (default = 9)
# --end-hour: the hour at which no more defenses can be planned (integer) (default = 17)
# --number-of-clusters : number of clusters considered in the problem (default = 5)
# --cluster-odds: odds that the co-supervisor, assessor and mentor are selected from the same cluster as the defense (default = 0.8)
# --room-available-odds : the odds that a room is available at a certain moment (default = 0.75)
# --person-available-odds : the odds that a person is available at a certain moment (default = 0.75)
# --co-supervisor-odds: the odds that a person has a co-supervisor (default = 0.5)
# --mentor1-odds: the odds that a person has a first mentor (default = 0.9)
# --mentor2-odds: the odds that a person has a second mentor (default = 0.3) (only after first mentor has been assigned)
# --mentor3-odds: the odds that a person has a third mentor (default = 0.1) (only after first and second mentors have been assigned)
# --mentor4-odds: the odds that a person has a fourth mentor (default = 0.1) (only after first, second and third mentors have been assigned)