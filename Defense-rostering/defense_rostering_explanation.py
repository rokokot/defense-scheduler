from contextlib import contextmanager

import cpmpy as cp
import pandas as pd
import json
import datetime
import argparse
from pathlib import Path
import plotly.express as px
import colorsys
import numpy as np

import yaml

# ---------------------------------------------------------------------------
# Room helper functions
# ---------------------------------------------------------------------------

def get_room_name(room):
    """Extract room name from either string or dict format."""
    return room['name'] if isinstance(room, dict) else room

def is_room_enabled(room):
    """Check if room is enabled (default True for legacy string format)."""
    if isinstance(room, dict):
        return room.get('enabled', True)
    return True  # Legacy string format = always enabled

def filter_enabled_rooms(rooms):
    """Filter to only enabled rooms."""
    return [r for r in rooms if is_room_enabled(r)]

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_SETTINGS = {
    # General
    "input_data": None,
    "output_data" : None,

    # Input data limits
    "number_of_defenses_in_problem": "all",
    "number_of_unavailabilities_in_problem": "all",

    # Planned defenses
    "planned_defenses": None,      # list[int] or None
    "defense_to_plan": None,       # int or None

    # Solving / model
    "solver": 'ortools',
    "model": 'scheduling',

    # Use-case options
    "adjacency_objective": False,
    "must_plan_all_defenses": True,
    "must_fix_defenses": False,
    "allow_online_defenses": False,
    "upper_bound_enforced": False,
    "first_hour": 9,
    "last_hour": 17,
    "availability_odds": 0.75,
    "online_odds": 0.75,
    "no_rooms": None,
    "no_days": None,

    # Randomness
    "random_sample": False,
    "random_seed": 0,

    # Showing solutions
    "show_feasible": False,
    "show_optimal": False,
}


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def load_config_file(path):
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def build_parser():
    p = argparse.ArgumentParser(description="Defense scheduling configuration")

    # General
    p.add_argument("--config", type=str)

    # Regarding the input data ( & output data of previous satisfiability problem)
    p.add_argument("--input-data")
    p.add_argument("--output-data")
    p.add_argument("--number-of-defenses-in-problem", type=str)
    p.add_argument("--number-of-unavailabilities-in-problem", type=str)


    # Planned defenses
    p.add_argument("--planned-defenses", type=int, nargs="+",
                   help="List of defense IDs that are already planned")
    p.add_argument("--defense-to-plan", type=int,
                   help="Single defense ID to plan")

    # Solving / model
    p.add_argument("--solver")
    p.add_argument("--model", type=str)

    # Use-case options
    p.add_argument("--adjacency-objective", type=str)
    p.add_argument("--must-plan-all-defenses", type=str)
    p.add_argument("--must-fix-defenses", type=str)
    p.add_argument("--allow-online-defenses", type=str)
    p.add_argument("--first-hour", type=int)
    p.add_argument("--last-hour", type=int)
    p.add_argument("--availability-odds", type=float)
    p.add_argument("--online-odds", type=float)
    p.add_argument("--max-rooms", type=int)
    p.add_argument("--max-days", type=str)
    p.add_argument("--upper-bound-enforced", type=str)

    # Randomness / sampling
    p.add_argument("--random-sample", type=str)
    p.add_argument("--random-seed", type=int)

    p.add_argument("--show-feasible", type=str)
    p.add_argument("--show-optimal", type=str)

    return p


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def str_to_bool(x):
    if isinstance(x, bool):
        return x
    if x is None:
        return None
    return x.lower() in ["1", "true", "yes", "y"]


# ---------------------------------------------------------------------------
# Settings resolution
# ---------------------------------------------------------------------------

def get_settings():
    settings = DEFAULT_SETTINGS.copy()

    parser = build_parser()
    args = parser.parse_args()

    # Load YAML config first
    if args.config:
        file_cfg = load_config_file(args.config)
        settings.update(file_cfg)

    # CLI overrides
    for key in settings:
        value = getattr(args, key, None)
        if value is None:
            continue

        # Boolean options passed as strings
        if key in [
            "adjacency_objective",
            "must_plan_all_defenses",
            "must_fix_defenses",
            "allow_online_defenses",
            "random_sample",
            "upper_bound_enforced",
            "show_feasible",
            "show_optimal",
        ]:
            value = str_to_bool(value)

        # Integer-like string options
        if key in [
            "number_of_defenses_in_problem",
            "number_of_unavailabilities_in_problem",
            "no_days",
        ] and isinstance(value, str) and value.isdigit():
            value = int(value)

        settings[key] = value

    return settings



def timeslot_illegal(t, earliest_start, latest_start):
    return ((t % 24) < earliest_start) | ((t % 24) >= latest_start)


from datetime import datetime, date, time, timedelta

def int_to_datetime(hour_index: int, first_day):

    if isinstance(first_day, date) and not isinstance(first_day, datetime):
        start = datetime.combine(first_day, time(0, 0))
    else:
        start = first_day.replace(minute=0, second=0, microsecond=0)

    return start + timedelta(hours=hour_index)



class DefenseRosteringModel(cp.Model):

    def prepare_input_data(self, cfg):
        if cfg['number_of_unavailabilities_in_problem'] != 'all':
            df = pd.read_csv(f"input_data/{cfg['input_data']}/unavailabilities.csv")

            if cfg['random_sample']:
                self.df_av = df.sample(
                    n=cfg['number_of_unavailabilities_in_problem'],
                    random_state=cfg['random_seed']
                )
            else:
                self.df_av = df.head(cfg['number_of_unavailabilities_in_problem'])
            self.df_av = self.df_av.reset_index(drop=True)
        else:
            self.df_av = pd.read_csv(f"input_data/{cfg['input_data']}/unavailabilities.csv")
        if cfg['number_of_defenses_in_problem'] != 'all':
            df = pd.read_csv(f"input_data/{cfg['input_data']}/defences.csv")

            if cfg['random_sample']:
                self.df_def = df.sample(
                    n=cfg['number_of_defenses_in_problem'],
                    random_state=cfg['random_seed']
                )
            else:
                self.df_def = df.head(cfg['number_of_defenses_in_problem'])
            self.df_def = self.df_def.reset_index(drop=True)
        else:
            self.df_def = pd.read_csv(f"input_data/{cfg['input_data']}/defences.csv")

        with open(f"input_data/{cfg['input_data']}/timeslot_info.json") as f:
            self.timeslot_info = json.load(f)

        with open(f"input_data/{cfg['input_data']}/rooms.json") as f:
            data = json.load(f)

        # Keep all rooms in the model, track which are disabled
        all_rooms = data['rooms']
        self.max_rooms = len(all_rooms)
        self.rooms = all_rooms
        self.room_names = [get_room_name(r) for r in all_rooms]

        # Track disabled room indices for blocking constraints
        self.disabled_room_indices = [i for i, r in enumerate(all_rooms) if not is_room_enabled(r)]
        self.disabled_room_names = [get_room_name(all_rooms[i]) for i in self.disabled_room_indices]

        # Determining the first and last day that defenses take place

        self.first_day = datetime.strptime(self.timeslot_info['first_day'], "%Y-%m-%d")


        self.max_days = self.timeslot_info['number_of_days']

        self.df_av['start_id'] = ((pd.to_datetime(self.df_av['day']) + pd.to_timedelta(
            self.df_av['start_time'] + ':00') - self.first_day)
                                  / pd.Timedelta(hours=1)).astype(int)

        self.df_av['end_id'] = (
                (pd.to_datetime(self.df_av['day']) + pd.to_timedelta(self.df_av['end_time'] + ':00') - self.first_day)
                / pd.Timedelta(hours=1)).astype(int)

        # Grouping all people together in one column
        self.df_def['person'] = self.df_def[['student', 'supervisor', 'co_supervisor', 'assessor1', 'assessor2',
                                             'mentor1', 'mentor2', 'mentor3', 'mentor4']].astype(str).agg('|'.join,
                                                                                                          axis=1)
        self.df_def['person'] = self.df_def['person'].apply(
            lambda x: ' | '.join(
                s.strip() for s in str(x).split('|')
                if s.strip().lower() != 'nan'
            )
        )

        # Grouping all evaluators together in one column
        evaluator_types = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3',
                           'mentor4']

        self.df_def['evaluators'] = self.df_def[evaluator_types].astype(str).agg('|'.join, axis=1)

        self.df_evaluators = (
            self.df_def['evaluators']
            .str.split('|')
            .explode()
            .str.strip()
            .replace('nan', pd.NA)
            .dropna()
            .to_frame(name='evaluators')
        )
        self.evaluator_list = self.df_evaluators['evaluators'].unique()

        self.df_def['defense_id'] = range(len(self.df_def))

        # self.df_rav['rid'] = pd.factorize(self.df_rav['room_id'])[0]

        mask = self.df_av['type'] == 'room'

        self.df_av['room_id'] = pd.NA

        self.df_av.loc[mask, 'room_id'] = pd.factorize(self.df_av.loc[mask, 'name'])[0]


    def __init__(self, cfg):
        self.cfg = cfg  # Store config for use in constraint methods
        self.prepare_input_data(cfg)
        self.groups = {}
        self.started_group = None
        self.no_timeslots = 24 * self.max_days
        self.no_defenses = self.df_def['defense_id'].max() + 1


        self.constraints = []
        self.groups = {}

        self.planned = cp.boolvar(shape=(self.no_defenses, self.max_rooms + 1, self.no_timeslots + 24))

        self.evaluator_availability_constraints_allocation_boolvar()
        self.evaluator_overlap_constraints_allocation_boolvar()
        self.room_availability_constraints_allocation_boolvar()
        self.room_overlap_constraints_allocation_boolvar()
        self.unused_rooms_constraints_allocation_boolvar()
        self.disabled_room_constraints()
        self.timeslot_constraints_allocation_boolvar()
        self.consistency_constraints_allocation_boolvar()

        if cfg['adjacency_objective']:
            self.adj_obj, self.adj_obj_ub = self.adjacency_objective_allocation_boolvar()
            #self.constraints.append([self.adj_obj <= self.adj_obj_ub])
            self.maximize(self.adj_obj)
        else:
            dummy = cp.intvar(lb=1, ub=1)
            self.maximize(dummy)

    #_________________________________________________________________________________________________________

    # Auxiliary functions to work with groups of constraints

    @contextmanager
    def add_group(self, name):
        if name not in self.groups:
            self.groups[name] = []

        self.started_group = name
        try:
            yield
        finally:
            self.constraints.extend(self.groups[self.started_group])
            self.started_group = None

    def add(self, constraint):
        if self.started_group is not None:
            self.groups[self.started_group].append(constraint)
        else:
            self.constraints.extend(constraint)



    #_________________________________________________________________________________________________________


    # Adds constraints to enforce that a person cannot attend a defense during a timeslot that they are unavailable.
    def evaluator_availability_constraints_allocation_boolvar(self):

        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            for idx, av in self.df_av.iterrows():
                if av['name'] == evaluator and av['type'] == 'person':
                    for t in range(av['start_id'], av['end_id']):
                        with self.add_group(f"person-unavailable <{evaluator}> <{int_to_datetime(t, first_day=self.first_day)}>"):
                            self.add(cp.all(~self.planned[defenses, :, t]))

    # Split as follows into groups:
    #  - For every evaluator & start-end pair -> evaluator {name} cannot attend defenses between {start_id} and {end_id}

    # Or even (especially for MCS): evaluator {name} cannot attend defenses on timeslot {t}

    # Different levels of granularity:
    #  - A person cannot attend a defense during a timeslot if the person is unavailable during that timeslot
    #  - Evaluator {e} cannot attend during a timeslot if the person is unavailable during that timeslot
    #  - Evaluator {e} is unavailable during timeslot {t}



    # _________________________________________________________________________________________________________

    # Adds constraints to enforce that a person cannot attend more than one defense during the same timeslot.
    def evaluator_overlap_constraints_allocation_boolvar(self):

        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            for t in range(self.no_timeslots):
                with self.add_group(f"person-overlap <{evaluator}> <{int_to_datetime(t, first_day=self.first_day)}>"):
                    self.add(cp.sum(self.planned[defenses, :, t]) <= 1)


    # Split as follows into groups:
    #  - For every evaluator and timeslot -> evaluator {name} cannot attend more than one defense during timeslot {t}

    # Different levels of granularity:
    #  - An evaluator cannot have more than one defense during the same timeslot
    #  - Evaluator {e} cannot have more than one defense during the same timeslot
    #  - Evaluator {e} cannot have more than one defense during timeslot {t}



    # _________________________________________________________________________________________________________

    # Adds constraints to enforce that a defense cannot take place in a room during a timeslot if the room is unavailable during that timeslot.
    def room_availability_constraints_allocation_boolvar(self):

        for r in range(self.max_rooms):
            for idx, av in self.df_av.iterrows():
                if av['type'] == 'room' and av['room_id'] == r:
                    for t in range(av['start_id'], av['end_id']):
                        with self.add_group(f"room-unavailable <{get_room_name(self.rooms[r])}> <{int_to_datetime(t, first_day=self.first_day)}>"):
                            self.add(cp.all(~self.planned[:, r, t]))


    # Split as follows into groups:
    #  - For every room and timeslot -> room {r} is unavailable during timeslot {t}

    # Different levels of granularity:
    #  - A room cannot be used during a timeslot if the room is unavailable during that timeslot
    #  - Room {r} cannot be used during a timeslot if the room is unavailable during that timeslot
    #  - Room {r} is unavailable during timeslot {t}



    # _________________________________________________________________________________________________________

    # Adds constraints to enforce that a room cannot host more than one defense during the same timeslot.
    def room_overlap_constraints_allocation_boolvar(self):


        for r in range(self.max_rooms):
            for t in range(self.no_timeslots):
                with self.add_group(f"room-overlap <{get_room_name(self.rooms[r])}> <{int_to_datetime(t, first_day=self.first_day)}>"):
                    self.add(cp.sum(self.planned[:, r, t]) <= 1)

    # Split as follows into groups:
    #  - For every room and timeslot -> room {r} cannot be used for two defenses on timeslot {t}

    # Different levels of granularity:
    #  - A room cannot have more than one defense during the same timeslot
    #  - Room {r} cannot have more than one defense during the same timeslot
    #  - Room {r} cannot have more than one defense during timeslot {t}


    # _________________________________________________________________________________________________________

    # Adds constraints to disallow unused rooms

    def unused_rooms_constraints_allocation_boolvar(self):
        with self.add_group(f"extra-room <Room {self.max_rooms}>"):
            self.add(cp.all(~self.planned[:, self.max_rooms, :]))


    # _________________________________________________________________________________________________________

    # Adds constraints for disabled rooms (relaxable for repairs)

    def disabled_room_constraints(self):
        """Add constraints saying disabled rooms cannot be used (relaxable for repairs)."""
        for i, room_idx in enumerate(self.disabled_room_indices):
            room_name = self.disabled_room_names[i]
            with self.add_group(f"enable-room <{room_name}>"):
                # Block all defenses from using this room - relaxing this enables the room
                self.add(cp.all(~self.planned[:, room_idx, :]))


    # _________________________________________________________________________________________________________

    # Adds constraints to disallow illegal timeslots (e.g. at night)

    def timeslot_constraints_allocation_boolvar(self):

        for t in range(self.no_timeslots + 24):
            if timeslot_illegal(t, self.timeslot_info['start_hour'], self.timeslot_info['end_hour']):
                with self.add_group(f"timeslot-illegal <{int_to_datetime(t, first_day=self.first_day)}>"):
                    self.add(cp.all(~self.planned[:, :, t]))
            elif self.max_days <= (t // 24) and (t % 24) == self.timeslot_info['start_hour']:
                for timeslot in range(t, t + self.timeslot_info['end_hour'] - self.timeslot_info['start_hour']):
                    with self.add_group(f"extra-day <{int_to_datetime(timeslot, first_day=self.first_day)}>"):
                        self.add(cp.all(~self.planned[:, :, timeslot]))


    # Different levels of granularity:
    #  - An illegal timeslot cannot be used for planning defenses
    #  - Timeslot {t} is illegal and cannot be used for planning defenses

    # But probably not in MUS


    # _________________________________________________________________________________________________________

    # Adds constraints to enforce that every defense is planned during exactly one (room, timeslot) pair (or at most one in case of relaxation)
    # Also adds constraints to fix defenses in place (if this option is chosen)
    def consistency_constraints_allocation_boolvar(self):
        planned_defenses = self.cfg['planned_defenses'] or []
        if self.cfg['must_fix_defenses']:

            output_file = Path(self.cfg['output_data']) / "output.csv"
            df = pd.read_csv(output_file)

            for d in range(self.no_defenses):
                if d in planned_defenses:
                    day = df.loc[d]["day"]
                    start_time = df.loc[d]["start_time"]
                    room = df.loc[d]["room"]

                    # Skip defenses without valid assignments in output.csv
                    if pd.isna(day) or pd.isna(start_time) or pd.isna(room):
                        continue
                    day = str(day).strip()
                    start_time = str(start_time).strip()
                    room = str(room).strip()
                    if not day or not start_time or not room:
                        continue

                    hours = (
                            pd.to_datetime(day)
                            + pd.to_timedelta(start_time + ":00")
                            - self.first_day
                    )

                    time_idx = int(hours / pd.Timedelta(hours=1))
                    # Find room index by name (room from CSV is a string)
                    room_idx = self.room_names.index(room)

                    with self.add_group(f"must-fix <{d}> <{room}> <{day} {start_time}>"):
                        self.add(self.planned[d,room_idx,time_idx])


        for d in range(self.no_defenses):
            if d in planned_defenses or d == self.cfg['defense_to_plan']:
                with self.add_group(f"must-plan <{d}>"):
                    self.add(cp.sum(self.planned[d, :, :]) == 1)
            else:
                with self.add_group(f"consistency <{d}>"):
                    self.add(cp.sum(self.planned[d, :, :]) <= 1)









    # Different levels of granularity:
    #  - A defense can only be planned during one room and one timeslot
    #  - Defense {d} can only be planned ...


    # _________________________________________________________________________________________________________






# decide on granularity only when calling .mus() or .mcs(), at that point the subgroup structure is 'collapsed' into something the function can work with

# For MUS, for defense d attended by people {e_1, ..., e_n}:
#   - Evaluator {e_i} cannot attend during a timeslot if they are unavailable during that timeslot
#   - Evaluator {e_i} cannot attend more than one defense during the same timeslot
#   - A room cannot be used for a timeslot if the room is unavailable during that timeslot
#   - A room cannot be used for two defenses at the same time

import re

def get_constraints_by_regex_patterns(model, regex_list=None):
    """
    Return all constraints from groups whose name matches any regex in 'regex_list'.
    All matched groups are merged into a single flat list.

    Parameters:
        regex_list (list of str or compiled re.Pattern): list of regex patterns to match group names

    Returns:
        list: flattened list of all matching constraints
    """
    if regex_list is None:
        regex_list = []

    # compile any strings to regex patterns
    compiled_patterns = [
        re.compile(p) if isinstance(p, str) else p
        for p in regex_list
    ]

    selected_groups = []

    for name, group in model.groups.items():
        if any(pattern.match(name) for pattern in compiled_patterns):
            selected_groups.append(name)

    return [c for g in selected_groups for c in model.groups[g]]

def get_group_for_constraint(groups, e):

    for key, constraints in groups.items():
        if any(e is c for c in constraints):
            return key
    return None

import time
import cpmpy as cp
from cpmpy.tools.explain.mus import mus

from cpmpy.tools.explain.mcs import mcs

from cpmpy.tools.explain.marco import marco


import json
import os
from collections import defaultdict


def create_run_folder(run_id, base="output_data", counter=0):
    new_run_id = f'{run_id}_{counter}'
    folder_path = os.path.join(base, new_run_id)
    os.makedirs(folder_path, exist_ok=True)
    # print(f"Run ID: {run_id}")
    return folder_path

ANGLE_RE = re.compile(r"<([^>]*)>")

def constraint_set_json(rules, output_folder=None, name=None):
    explanations = {
        "person-unavailable": defaultdict(list),
        "person-overlap": defaultdict(list),
        "room-unavailable": defaultdict(list),
        "room-overlap": defaultdict(list),
        "extra-room": [],
        "extra-day": [],
        "enable-room": []
    }

    for rule in rules:
        rule = rule.strip()
        if not rule:
            continue

        rule_type = rule.split(maxsplit=1)[0]
        args = ANGLE_RE.findall(rule)

        if rule_type == "person-unavailable":
            p, t = args
            explanations["person-unavailable"][p].append(t)

        elif rule_type == "person-overlap":
            p, t = args
            explanations["person-overlap"][p].append(t)

        elif rule_type == "room-unavailable":
            r, t = args
            explanations["room-unavailable"][r].append(t)

        elif rule_type == "room-overlap":
            r, t = args
            explanations["room-overlap"][r].append(t)

        elif rule_type == "extra-room":
            (r,) = args
            if r not in explanations["extra-room"]:
                explanations["extra-room"].append(r)

        elif rule_type == "extra-day":
            (t,) = args
            if t not in explanations["extra-day"]:
                explanations["extra-day"].append(t)

        elif rule_type == "enable-room":
            (r,) = args
            if r not in explanations["enable-room"]:
                explanations["enable-room"].append(r)

        else:
            raise ValueError(f"Unknown rule type: {rule_type}")

    for key in [
        "person-unavailable",
        "person-overlap",
        "room-unavailable",
        "room-overlap",
    ]:

        explanations[key] = {k: sorted(v) for k, v in explanations[key].items()}


    explanations["extra-room"].sort()
    explanations["extra-day"].sort()
    explanations["enable-room"].sort()


    if output_folder is not None:
        os.makedirs(output_folder, exist_ok=True)
        output_path = os.path.join(output_folder, f"{name}.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(explanations, f, indent=2)

    return explanations


if __name__ == "__main__":
    cfg = get_settings()

    model = DefenseRosteringModel(cfg)

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_folder = create_run_folder(run_id)

    print("Explanations and repairs streamed to: ", output_folder)


    mus_soft_cons = get_constraints_by_regex_patterns(model,
                                                     [r"^person-unavailable .*$",
                                                      r"^person-overlap .*$",
                                                      r"^room-unavailable .*$",
                                                      r"^room-overlap .*$"
                                                      ])

    mus_hard_cons = get_constraints_by_regex_patterns(model, [r"^consistency .*$",
                                                              r"^must-plan .*$",
                                                              r"^must-fix .*$",
                                                              r"^timeslot-illegal .*$",
                                                              r"^extra-room .*$",
                                                              r"^extra-day .*$",
                                                              r"^enable-room .*$"
                                                              ])

    expl = mus(soft=mus_soft_cons, hard=mus_hard_cons)


    expl_high_level = [get_group_for_constraint(model.groups, e) for e in expl]

    print("Explanation: ", expl_high_level)



    constraint_set_json(expl_high_level, output_folder, name='explanation')


    mcs_soft_cons = get_constraints_by_regex_patterns(model,
                                                  [r"^person-unavailable .*$",
                                                   r"^extra-room .*$",
                                                   r"^extra-day .*$",
                                                   r"^enable-room .*$"
                                                   ])

    mcs_hard_cons = get_constraints_by_regex_patterns(model,
                                                      [
                                                          r"^person-overlap .*$",
                                                          r"^room-unavailable .*$",
                                                          r"^room-overlap .*$",
                                                          r"^consistency .*$",
                                                          r"^must-plan .*$",
                                                          r"^must-fix .*$",
                                                          r"^timeslot-illegal .*$"

                                                       ])

    marco = marco(soft=mcs_soft_cons, hard=mcs_hard_cons, solver='ortools', return_mus=False, return_mcs=True)

    mcs_folder = os.path.join(output_folder, f"resolution_options")
    os.makedirs(mcs_folder, exist_ok=True)
    counter = 0
    for mcs in marco:
        counter += 1
        resolution_high_level = [get_group_for_constraint(model.groups, e) for e in mcs[1]]
        print(f"Repair option {counter}: ", resolution_high_level)
        constraint_set_json(
            resolution_high_level,
            output_folder=mcs_folder,
            name=f'resolution_{counter}'
        )

    print("Number of repair options: ", counter)


# Uniform naming

# Person p is unavailable during timeslot t
#  - person-unavailable <p> <t>

# Person p cannot attend more than one defense during timeslot t
#  - person-overlap <p> <t>

# Room r is unavailable during timeslot t
#  - room-unavailable <r> <t>

# Room r cannot host more than one defense during timeslot t
#  - room-overlap <r> <t>

# Extra room r
#  - extra-room <r>

# Extra day d
#  - extra-day <d>


# Always background:
#  - All defenses planned
#  - Unrelaxable timeslot constraints (e.g. at night)
