import datetime
import itertools
import json

from pathlib import Path
import cpmpy as cp
import pandas as pd
import numpy as np
from defense_visualization import get_unavailable_intervals, gantt_chart_room_perspective, gantt_chart_evaluator_perspective

import time

from cpmpy.solvers import CPM_ortools
from cpmpy.tools.explain.mus import mus

# Parameter settings


## integer ipv boolean matrix voor rooms
## or-tools: Large Neighborhood search, maar seed moet gezet worden (belangrijk voor experimenten)
# Hoeveel defenses zijn niet adjacent
# Room availabilities van Toledo


import argparse
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
    "input_data": 'june-2021',
    "output_data" : None,

    # Input data limits
    "number_of_defenses_in_problem": "all",
    "number_of_unavailabilities_in_problem": "all",

    "planned_defenses": None,

    # Solving / model
    "solver": 'ortools',
    "model": 'scheduling',

    # Use-case options
    "adjacency_objective": False,
    "must_plan_all_defenses": False,
    "must_fix_defenses": False,
    "allow_online_defenses": False,
    "upper_bound_enforced": False,
    "first_hour": 9,
    "last_hour": 17,
    "availability_odds": 0.75,
    "online_odds": 0.75,
    "max_rooms": None,
    "max_days": None,

    # Randomness
    "random_sample": False,
    "random_seed": 0,

    # Solution streaming (alternative solutions)
    "solution_streaming" : False,

    # Show solutions (Gantt charts)
    "show_feasible" : False,
    "show_optimal" : False,
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
    p.add_argument("--config", type=str,
                   help="Path to YAML configuration file")

    # Regarding the input data
    p.add_argument("--input-data")
    p.add_argument("--output-data")
    p.add_argument("--number-of-defenses-in-problem", type=str)
    p.add_argument("--number-of-unavailabilities-in-problem", type=str)

    p.add_argument("--planned-defenses", type=int, nargs="+",
                   help="List of defense IDs that are already planned")

    # Regarding the solving method
    p.add_argument("--solver")
    p.add_argument("--model", type=str)

    # Regarding the use case
    p.add_argument("--adjacency-objective", type=str,
                   help="true/false")
    p.add_argument("--must-plan-all-defenses", type=str,
                   help="true/false")
    p.add_argument("--must-fix-defenses", type=str,
                   help="true/false")
    p.add_argument("--allow-online-defenses", type=str,
                   help="true/false")
    p.add_argument("--first-hour", type=int)
    p.add_argument("--last-hour", type=int)
    p.add_argument("--availability-odds", type=float)
    p.add_argument("--online-odds", type=float)
    p.add_argument("--max-rooms", type=int)
    p.add_argument("--max-days", type=str)
    p.add_argument("--upper-bound-enforced", type=str,
                   help="true/false")

    # Randomness / sampling
    p.add_argument("--random-sample", type=str,
                   help="true/false: randomly sample rows instead of taking first n")
    p.add_argument("--random-seed", type=int,
                   help="Random seed for reproducibility")

    p.add_argument("--solution-streaming", type=str,
                   help="true/false")

    p.add_argument("--show-feasible", type=str,
                   help="true/false")
    p.add_argument("--show-optimal", type=str,
                   help="true/false")

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
            "upper_bound_enforced",
            "random_sample",
            "solution_streaming",
            "show_feasible",
            "show_optimal"
        ]:
            value = str_to_bool(value)

        # Integer-like string options
        if key in [
            "number_of_defenses_in_problem",
            "number_of_unavailabilities_in_problem",
            "max_days",
        ] and isinstance(value, str) and value.isdigit():
            value = int(value)

        settings[key] = value

    return settings



## integer ipv boolean matrix voor rooms
## or-tools: Large Neighborhood search, maar seed moet gezet worden (belangrijk voor experimenten)
# Hoeveel defenses zijn niet adjacent
# Room availabilities van Toledo




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

        # Filter to only enabled rooms for scheduling
        all_rooms = data['rooms']
        enabled_rooms = filter_enabled_rooms(all_rooms)
        self.max_rooms = len(enabled_rooms)
        self.rooms = enabled_rooms  # Only enabled rooms
        self.room_names = [get_room_name(r) for r in enabled_rooms]  # String names

        # Determining the first and last day that defenses take place

        self.first_day = datetime.datetime.strptime(self.timeslot_info['first_day'], "%Y-%m-%d")

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
        self.prepare_input_data(cfg)
        self.groups = {}
        self.started_group = None
        self.no_timeslots = 24 * self.max_days
        self.no_defenses = self.df_def['defense_id'].max() + 1



        self.constraints = []

        if cfg['model'] == 'allocation_intvar':
            self.start_times = cp.intvar(lb=0, ub=self.no_timeslots - 1, shape=self.no_defenses, name='start_times')
            self.in_room = cp.intvar(lb=0, ub=self.max_rooms - 1, shape=self.no_defenses,
                                     name='in_room')
            self.add(self.evaluator_availability_constraints_allocation_intvar())
            self.add(self.evaluator_overlap_constraints_allocation_intvar())

            self.add(self.room_availability_constraints_allocation_intvar())
            self.add(self.room_overlap_constraints_allocation_intvar())

            self.add(self.timeslot_constraints_allocation_intvar())

            if cfg['must_fix_defenses']:
                self.fixed_defenses()

            if cfg['adjacency_objective']:
                self.adj_obj, self.adj_obj_ub = self.adjacency_objective_allocation_intvar()
                # print("Upper bound: ", self.adj_obj_ub)
                if isinstance(self.adj_obj, int):
                    self.dummy = cp.intvar(lb=0, ub=1)
                    self.add([self.dummy == 1])
                    self.maximize(self.dummy)
                else:
                    if cfg['upper_bound_enforced']:
                        self.add([self.adj_obj <= self.adj_obj_ub])
                    self.maximize(self.adj_obj)
            else:
                self.dummy = cp.intvar(lb=0, ub=1)
                self.add([self.dummy == 1])
                self.maximize(self.dummy)
        elif cfg['model'] == 'allocation_boolvar':
            self.planned = cp.boolvar(shape=(self.no_defenses, self.max_rooms, self.no_timeslots))
            self.add(self.evaluator_availability_constraints_allocation_boolvar())

            self.add(self.evaluator_overlap_constraints_allocation_boolvar())

            self.add(self.room_availability_constraints_allocation_boolvar())
            self.add(self.room_overlap_constraints_allocation_boolvar())

            self.add(self.timeslot_constraints_allocation_boolvar())

            self.add(self.consistency_constraints_allocation_boolvar(relaxed=not cfg['must_plan_all_defenses']))

            if cfg['must_fix_defenses']:
                self.fixed_defenses()


            if cfg['adjacency_objective']:

                self.adj_obj, self.adj_obj_ub = self.adjacency_objective_allocation_boolvar()
                # print("Upper bound: ", self.adj_obj_ub)
                if cfg['must_plan_all_defenses']:
                    if isinstance(self.adj_obj, int):
                        self.dummy = cp.intvar(lb=0, ub=1)
                        self.add([self.dummy == 1])
                        self.maximize(self.dummy)
                    else:
                        if cfg['upper_bound_enforced']:
                            self.add([self.adj_obj <= self.adj_obj_ub])
                        self.maximize(self.adj_obj)
                else:
                    self.defenses_obj = cp.sum(cp.any(self.planned[d, :, :]) for d in range(self.no_defenses))
                    self.maximize((self.adj_obj_ub + 1) * self.defenses_obj + self.adj_obj)
            else:
                if cfg['must_plan_all_defenses']:
                    self.dummy = cp.intvar(lb=0, ub=1)
                    self.add([self.dummy == 1])
                    self.maximize(self.dummy)
                else:
                    self.defenses_obj = cp.sum(cp.any(self.planned[d, :, :]) for d in range(self.no_defenses))
                    self.maximize(self.defenses_obj)

        elif cfg['model'] == 'scheduling':
            self.start_times = cp.intvar(lb=0, ub=self.no_timeslots - 1, shape=self.no_defenses, name='start_times')
            self.in_room = cp.intvar(lb=0, ub=self.max_rooms - 1, shape=self.no_defenses,
                                     name='in_room')  # add 'online room' to possible rooms
            self.is_planned = cp.boolvar(shape=self.no_defenses, name='is_planned')
            self.add(self.evaluator_availability_and_overlap_constraints())
            self.add(self.room_availability_and_overlap_constraints())

            # Minimize the amount of rooms used

            # self.defenses_obj = cp.NValue(self.in_room)
            # self.minimize(cp.sum(~cp.AllEqual(self.start_times[:,r]) for r in range(self.max_rooms)))

            # Maximize the number of assigned defenses

            # self.maximize(cp.sum(cp.any(self.in_room[d,:]) for d in range(self.no_defenses)) - adjacency_obj)

            if cfg['must_fix_defenses']:
                self.fixed_defenses()

            # Adjacency objective test
            if cfg['adjacency_objective']:
                if cfg['must_plan_all_defenses']:
                    self.add([cp.all(self.is_planned)])
                    self.adj_obj, self.no_pairs, self.adj_obj_ub = self.adjacency_objectives()
                    # self.add([self.adj_obj <= self.adj_obj_ub])

                    if isinstance(self.adj_obj, int):
                        self.dummy = cp.intvar(lb=0, ub=1)
                        self.add([self.dummy == 1])
                        self.maximize(self.dummy)
                    else:
                        if cfg['upper_bound_enforced']:
                            self.add([self.adj_obj <= self.adj_obj_ub])
                        self.maximize(self.adj_obj)
                else:
                    self.defenses_obj = cp.sum(self.is_planned)
                    self.adj_obj, self.no_pairs, self.adj_obj_ub = self.adjacency_objectives()
                    # self.add([self.adj_obj <= self.adj_obj_ub])

                    self.maximize((self.adj_obj_ub + 1) * self.defenses_obj + self.adj_obj)
            else:
                if cfg['must_plan_all_defenses']:
                    self.add([cp.all(self.is_planned)])

                    self.dummy = cp.intvar(lb=0, ub=1)
                    self.add([self.dummy == 1])
                    self.maximize(self.dummy)
                else:
                    self.defenses_obj = cp.sum(self.is_planned)
                    self.maximize(self.defenses_obj)

        # else:
        #    self.defenses_obj = cp.sum(self.is_planned)
        #    if cfg['allow_online_defenses']:
        #        self.online_obj = cp.sum(self.in_room[:,self.max_rooms])
        #        self.maximize(10*self.defenses_obj - self.online_obj)
        #    else:
        #        self.maximize(self.defenses_obj)
        # with UB, nrows=25 : 70.80209565162659
        # without UB, nrows=25 : 89.51717042922974

        # tradeoff: equal weights, with 2021, nrows=20, rooms=5, ortools, T=26, R=55
        #           t=100, r=1: T=27, R=54
        #           t=2, r=1: T=27, R=54
        #           t=1, r=2: T=26, R=55
        #           t=1, r=100: T=26, R=55

    def evaluator_availability_constraints_allocation_intvar(self):
        constraints = []
        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            for idx, av in self.df_av.iterrows():
                if av['name'] == evaluator and av['type'] == 'person':
                    for t in range(av['start_id'], av['end_id']):
                        constraints += [self.start_times[defenses] != t]
        return constraints

    def evaluator_availability_constraints_allocation_boolvar(self):
        constraints = []
        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            for idx, av in self.df_av.iterrows():
                if av['name'] == evaluator and av['type'] == 'person':
                    for t in range(av['start_id'], av['end_id']):
                        constraints += [~self.planned[defenses, :, t]]
        return constraints

    def evaluator_overlap_constraints_allocation_intvar(self):
        constraints = []

        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            constraints += [cp.AllDifferent(self.start_times[defenses])]

        return constraints

    def evaluator_overlap_constraints_allocation_boolvar(self):
        constraints = []

        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            for t in range(self.no_timeslots):
                constraints += [cp.sum(self.planned[defenses, :, t]) <= 1]

        return constraints

    def room_availability_constraints_allocation_intvar(self):
        constraints = []
        for r in range(self.max_rooms):
            for idx, av in self.df_av.iterrows():
                if av['type'] == 'room' and av['room_id'] == r:
                    for t in range(av['start_id'], av['end_id']):
                        constraints += [(self.in_room == r).implies(self.start_times != t)]
        return constraints

    def room_availability_constraints_allocation_boolvar(self):
        constraints = []
        for r in range(self.max_rooms):
            for idx, av in self.df_av.iterrows():
                if av['type'] == 'room' and av['room_id'] == r:
                    for t in range(av['start_id'], av['end_id']):
                        constraints += [~self.planned[:, r, t]]
        return constraints

    def room_overlap_constraints_allocation_intvar(self):
        constraints = []

        for d1, d2 in itertools.combinations(list(range(self.no_defenses)), 2):
            constraints += [
                (self.in_room[d1] == self.in_room[d2]).implies(self.start_times[d1] != self.start_times[d2])]

        return constraints

    def room_overlap_constraints_allocation_boolvar(self):
        constraints = []

        for r in range(self.max_rooms):
            for t in range(self.no_timeslots):
                constraints += [cp.sum(self.planned[:, r, t]) <= 1]

        return constraints

    def timeslot_constraints_allocation_intvar(self):
        constraints = []
        for t in range(self.no_timeslots):
            if timeslot_illegal(t, self.timeslot_info['start_hour'], self.timeslot_info['end_hour']):
                constraints += [self.start_times != t]
        return constraints

    def timeslot_constraints_allocation_boolvar(self):
        constraints = []
        for t in range(self.no_timeslots):
            if timeslot_illegal(t, self.timeslot_info['start_hour'], self.timeslot_info['end_hour']):
                constraints += [~self.planned[:, :, t]]
        return constraints

    def consistency_constraints_allocation_boolvar(self, relaxed=False):
        constraints = []
        if relaxed:
            for d in range(self.no_defenses):
                constraints += [cp.sum(self.planned[d, :, :]) <= 1]
        else:
            for d in range(self.no_defenses):
                constraints += [cp.sum(self.planned[d, :, :]) == 1]
        return constraints


    def fixed_defenses(self):
        output_file = Path(cfg['output_data']) / "output.csv"
        df = pd.read_csv(output_file)

        for d in range(self.no_defenses):
            if d in cfg['planned_defenses']:
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

                if cfg['model'] == 'allocation_intvar':
                    self.add([self.start_times[d] == time_idx])
                    self.add([self.in_room[d] == room_idx])
                elif cfg['model'] == 'allocation_boolvar':
                    self.add([self.planned[d, time_idx, room_idx]])
                elif cfg['model'] == 'scheduling':
                    self.add([self.start_times[d] == time_idx])
                    self.add([self.in_room[d] == room_idx])
                    self.add([self.is_planned[d]])  # Force defense to be planned



    def adjacency_objective_allocation_intvar(self):
        adjacency_objective = 0
        time_objective_ub = 0
        pairs_count = 0
        df_evaluators = (
            self.df_def['evaluators']
            .str.split('|')
            .explode()
            .str.strip()
            .replace('nan', pd.NA)
            .dropna()
            .to_frame(name='evaluators')
        )
        evaluator_list = df_evaluators['evaluators'].unique()

        for evaluator in evaluator_list:

            defenses = df_evaluators.index[df_evaluators['evaluators'] == evaluator].unique().tolist()

            d = len(defenses)
            if d < self.timeslot_info['end_hour'] - self.timeslot_info['start_hour']:
                time_objective_ub -= (1 / 2) * (d ** 2) - (
                        3 / 2) * d + 1  # amount of defense pairs that cannot be planned consecutively
            else:
                # time_objective_ub -= (1 / 2) * (d ** 2) - (3 / 2) * d + 1
                time_objective_ub -= (
                        (1 / 2) * (d ** 2) - (1 / 2) * d - self.timeslot_info['end_hour'] + self.timeslot_info[
                    'start_hour'] + 1)
            for d1 in defenses:
                for d2 in defenses:
                    if d1 != d2:
                        adjacency_objective += (((self.start_times[d1] - self.start_times[d2]) == 1) & (
                                self.in_room[d1] == self.in_room[d2]))
                        pairs_count += 1

        pairs_count //= 2

        time_objective_ub += pairs_count
        time_objective_ub = int(time_objective_ub)
        return adjacency_objective, time_objective_ub


    def adjacency_objective_allocation_boolvar(self):
        adjacency_objective = 0
        time_objective_ub = 0
        pairs_count = 0
        df_evaluators = (
            self.df_def['evaluators']
            .str.split('|')
            .explode()
            .str.strip()
            .replace('nan', pd.NA)
            .dropna()
            .to_frame(name='evaluators')
        )
        evaluator_list = df_evaluators['evaluators'].unique()

        self.shifted_planned = cp.boolvar(shape=(self.no_defenses, self.max_rooms, self.no_timeslots))

        for t in range(self.no_timeslots - 1):
            self.add([self.shifted_planned[:, :, t] == self.planned[:, :, t + 1]])
        self.add([~self.shifted_planned[:, :, self.no_timeslots - 1]])

        for evaluator in evaluator_list:
            defenses = df_evaluators.index[df_evaluators['evaluators'] == evaluator].unique().tolist()

            d = len(defenses)
            if d < self.timeslot_info['end_hour'] - self.timeslot_info['start_hour']:
                time_objective_ub -= (1 / 2) * (d ** 2) - (
                        3 / 2) * d + 1  # amount of defense pairs that cannot be planned consecutively
            else:
                # time_objective_ub -= (1 / 2) * (d ** 2) - (3 / 2) * d + 1
                time_objective_ub -= (
                        (1 / 2) * (d ** 2) - (1 / 2) * d - self.timeslot_info['end_hour'] + self.timeslot_info[
                    'start_hour'] + 1)
            for d1 in defenses:
                for d2 in defenses:
                    if d1 != d2:
                        adjacency_objective += cp.any(self.planned[d1, :, :] & self.shifted_planned[d2, :, :])
                        pairs_count += 1

        pairs_count //= 2

        time_objective_ub += pairs_count
        time_objective_ub = int(time_objective_ub)
        return adjacency_objective, time_objective_ub

    def evaluator_availability_and_overlap_constraints(self):
        constraints = []

        df_evaluators = (
            self.df_def['evaluators']
            .str.split('|')
            .explode()
            .str.strip()
            .replace('nan', pd.NA)
            .dropna()
            .to_frame(name='evaluators')
        )
        evaluator_list = df_evaluators['evaluators'].unique()

        for evaluator in evaluator_list:

            defenses = df_evaluators.index[df_evaluators['evaluators'] == evaluator].unique().tolist()

            start = self.start_times[defenses].tolist()
            duration = [1 for _ in defenses]
            end = [start[i] + duration[i] for i in range(len(start))]
            heights = self.is_planned[defenses].tolist()
            for idx, av in self.df_av.iterrows():
                if av['name'] == evaluator and av['type'] == 'person':
                    start += [av['start_id']]
                    duration += [av['end_id'] - av['start_id']]
                    end += [av['end_id']]
                    heights += [1]
                    # if av['status'] == 'online':
                    #   start += [av['timeslot_id']]
                    #    duration += [1]
                    #    end += [av['timeslot_id'] + 1]
                    #    heights += [1]
                    # heights += [cp.any(cp.any(self.in_room[d,:-1]) for d in defenses)] (?)

            constraints += [cp.Cumulative(start=start, duration=duration, end=end, demand=heights, capacity=1)]

        return constraints

    def room_availability_and_overlap_constraints(self):
        constraints = []
        # for d in range(self.no_defenses):
        #    constraints += [cp.sum(self.in_room[d,:]) <= 1]

        for r in range(self.max_rooms):

            start = self.start_times.tolist()
            duration = [1 for _ in range(len(self.start_times))]
            end = [start[i] + duration[i] for i in range(len(self.start_times))]

            heights = (self.is_planned & (self.in_room == r)).tolist()

            for idx, av in self.df_av.iterrows():
                if av['type'] == 'room' and av['room_id'] == r:
                    start += [av['start_id']]
                    duration += [av['end_id'] - av['start_id']]
                    end += [av['end_id']]
                    heights += [1]

            dur = 0
            for t in range(self.no_timeslots):
                if (t % 24) < self.timeslot_info['start_hour'] or (t % 24) >= self.timeslot_info['end_hour']:
                    dur += 1
                elif dur > 0:
                    start += [t - dur]
                    duration += [dur]
                    end += [t]
                    heights += [1]
                    dur = 0

            start += [self.no_timeslots - dur]
            duration += [dur]
            end += [self.no_timeslots]
            heights += [1]

            constraints += [cp.Cumulative(start=start, duration=duration, end=end, demand=heights, capacity=1)]

        # for t in range(self.no_timeslots):
        #    if timeslot_illegal(t):
        #        for d in range(self.no_defenses):
        #            constraints += [self.start_times[d] != t]

        return constraints

    def adjacency_objectives(self):

        adjacency_objective = 0
        # room_objective = 0
        time_objective_ub = 0
        pairs_count = 0

        df_evaluators = (
            self.df_def['evaluators']
            .str.split('|')
            .explode()
            .str.strip()
            .replace('nan', pd.NA)
            .dropna()
            .to_frame(name='evaluators')
        )
        evaluator_list = df_evaluators['evaluators'].unique()

        for evaluator in evaluator_list:
            defenses = df_evaluators.index[df_evaluators['evaluators'] == evaluator].unique().tolist()
            d = len(defenses)
            if d < self.timeslot_info['end_hour'] - self.timeslot_info['start_hour']:
                time_objective_ub -= (1 / 2) * (d ** 2) - (
                        3 / 2) * d + 1  # amount of defense pairs that cannot be planned consecutively
            else:
                # time_objective_ub -= (1 / 2) * (d ** 2) - (3 / 2) * d + 1
                time_objective_ub -= (1 / 2) * (d ** 2) - (1 / 2) * d - self.timeslot_info['end_hour'] + \
                                     self.timeslot_info['start_hour'] + 1

            # Motivation:

            # d*(d-1)/2 is the amount of ordered pairs (without 2x same element) that can be taken from d defenses
            # max(d-1, last_hour-first_hour-1) is the maximal amount of consecutive pairs that can be planned (at most),
            # since there can never be defenses planned at the same time (due to evaluator overlap)
            # so d*(d-1)/2 - (d-1) = (1/2)(d^2) - (3/2)*d + 1 if d < last_hour - first_hour
            # else (1/2)*(d^2) - (1/2)d - (last_hour - first_hour - 1)


            group_constraint = 0
            for d1 in defenses:
                for d2 in defenses:
                    if d1 != d2:
                        adjacency_objective += ((self.is_planned[d1] & self.is_planned[d2]) &
                                                ((self.start_times[d1] - self.start_times[d2]) == 1) & (
                                                        self.in_room[d1] == self.in_room[d2]))
                        pairs_count += 1
            # self.add([group_constraint <= d - 1])
        pairs_count //= 2

        time_objective_ub += pairs_count
        time_objective_ub = int(time_objective_ub)

        return adjacency_objective, pairs_count, time_objective_ub

        # Formulating the time adjacency objective as:
        #       maximize the amount of defenses with a common evaluator that are adjacent (e.g. 8s for nrows=20, nrooms=5, ortools)
        # is more efficient than
        #       minimize the distance between defenses with a common evaluator (e.g. 98s for nrows=20, nrooms=5, ortools)

    def evaluator_availability_and_overlap_constraints(self):
        constraints = []

        df_evaluators = (
            self.df_def['evaluators']
            .str.split('|')
            .explode()
            .str.strip()
            .replace('nan', pd.NA)
            .dropna()
            .to_frame(name='evaluators')
        )
        evaluator_list = df_evaluators['evaluators'].unique()

        for evaluator in evaluator_list:

            defenses = df_evaluators.index[df_evaluators['evaluators'] == evaluator].unique().tolist()

            start = self.start_times[defenses].tolist()
            duration = [1 for _ in defenses]
            end = [start[i] + duration[i] for i in range(len(start))]
            heights = self.is_planned[defenses].tolist()
            for idx, av in self.df_av.iterrows():
                if av['name'] == evaluator and av['type'] == 'person':
                    start += [av['start_id']]
                    duration += [av['end_id'] - av['start_id']]
                    end += [av['end_id']]
                    heights += [1]
                    # if av['status'] == 'online':
                    #   start += [av['timeslot_id']]
                    #    duration += [1]
                    #    end += [av['timeslot_id'] + 1]
                    #    heights += [1]
                    # heights += [cp.any(cp.any(self.in_room[d,:-1]) for d in defenses)] (?)

            constraints += [cp.Cumulative(start=start, duration=duration, end=end, demand=heights, capacity=1)]

        return constraints

    def room_availability_and_overlap_constraints(self):
        constraints = []
        # for d in range(self.no_defenses):
        #    constraints += [cp.sum(self.in_room[d,:]) <= 1]

        for r in range(self.max_rooms):

            start = self.start_times.tolist()
            duration = [1 for _ in range(len(self.start_times))]
            end = [start[i] + duration[i] for i in range(len(self.start_times))]

            heights = (self.is_planned & (self.in_room == r)).tolist()

            for idx, av in self.df_av.iterrows():
                if av['type'] == 'room' and av['room_id'] == r:
                    start += [av['start_id']]
                    duration += [av['end_id'] - av['start_id']]
                    end += [av['end_id']]
                    heights += [1]

            dur = 0
            for t in range(self.no_timeslots):
                if (t % 24) < self.timeslot_info['start_hour'] or (t % 24) >= self.timeslot_info['end_hour']:
                    dur += 1
                elif dur > 0:
                    start += [t - dur]
                    duration += [dur]
                    end += [t]
                    heights += [1]
                    dur = 0

            start += [self.no_timeslots - dur]
            duration += [dur]
            end += [self.no_timeslots]
            heights += [1]

            constraints += [cp.Cumulative(start=start, duration=duration, end=end, demand=heights, capacity=1)]

        # for t in range(self.no_timeslots):
        #    if timeslot_illegal(t):
        #        for d in range(self.no_defenses):
        #            constraints += [self.start_times[d] != t]

        return constraints

    def adjacency_objectives(self):

        adjacency_objective = 0
        #room_objective = 0
        time_objective_ub = 0
        pairs_count = 0

        df_evaluators = (
            self.df_def['evaluators']
            .str.split('|')
            .explode()
            .str.strip()
            .replace('nan', pd.NA)
            .dropna()
            .to_frame(name='evaluators')
        )
        evaluator_list = df_evaluators['evaluators'].unique()

        for evaluator in evaluator_list:
            defenses = df_evaluators.index[df_evaluators['evaluators'] == evaluator].unique().tolist()
            d = len(defenses)
            if d < self.timeslot_info['end_hour'] - self.timeslot_info['start_hour']:
                time_objective_ub -= (1/2)*(d**2) - (3/2)*d + 1 # amount of defense pairs that cannot be planned consecutively
            else:
                #time_objective_ub -= (1 / 2) * (d ** 2) - (3 / 2) * d + 1
                time_objective_ub -= (1/2)*(d**2) - (1/2)*d - self.timeslot_info['end_hour'] + self.timeslot_info['start_hour'] + 1

            # Motivation:

            # d*(d-1)/2 is the amount of ordered pairs (without 2x same element) that can be taken from d defenses
            # max(d-1, last_hour-first_hour-1) is the maximal amount of consecutive pairs that can be planned (at most),
            # since there can never be defenses planned at the same time (due to evaluator overlap)
            # so d*(d-1)/2 - (d-1) = (1/2)(d^2) - (3/2)*d + 1 if d < last_hour - first_hour
            # else (1/2)*(d^2) - (1/2)d - (last_hour - first_hour - 1)


            group_constraint = 0
            for d1 in defenses:
                for d2 in defenses:
                    if d1 != d2:
                        adjacency_objective += ((self.is_planned[d1] & self.is_planned[d2]) &
                                                 ((self.start_times[d1] - self.start_times[d2]) == 1) & (self.in_room[d1] == self.in_room[d2]))
                        pairs_count += 1
            #self.add([group_constraint <= d - 1])
        pairs_count //= 2

        time_objective_ub += pairs_count
        time_objective_ub = int(time_objective_ub)

        return adjacency_objective, pairs_count, time_objective_ub

import os

def create_run_folder(run_id, base="output_data", counter=0):
    new_run_id = f'{run_id}_{counter}'
    folder_path = os.path.join(base, new_run_id)
    os.makedirs(folder_path, exist_ok=True)
    # print(f"Run ID: {run_id}")
    return folder_path


def output_csv(model, res, output_folder):
    df = model.df_def.copy(deep=True)
    df.drop(["person", "evaluators"], axis=1, inplace=True)

    # Convert scheduling columns to object dtype to avoid FutureWarning
    # when assigning string values to columns that may contain NaN (float64)
    for col in ['day', 'start_time', 'end_time', 'room']:
        if col in df.columns:
            df[col] = df[col].astype(object)

    for d in range(model.no_defenses):
        for r in range(model.max_rooms + 1):
            if res['is_planned'][d] and res['in_room'][d] == r:
                t = res['start_times'][d]
                timestamp = pd.to_datetime(model.first_day) + pd.to_timedelta(t, unit="h")
                day = timestamp.date()
                start = str(timestamp.hour) + ':00'
                end = str(timestamp.hour + 1) + ':00'
                room = get_room_name(model.rooms[r])

                df.loc[df['defense_id'] == d, ['day', 'start_time', 'end_time', 'room']] = [day, start, end, room]
    df = df.drop(columns=['defense_id'])
    df.to_csv(f'{output_folder}/output.csv', index=False)



def timeslot_illegal(t, earliest_start, latest_start):
    return ((t % 24) < earliest_start) | ((t % 24) >= latest_start)

def unused_timeslots_csv(model, res, output_folder):
    df = pd.DataFrame(columns=["name", "day", "start_time", "end_time"])

    for r in range(model.max_rooms):

        start_times = []
        for d in range(model.no_defenses):
            if res['in_room'][d] == r:
                start_times.append(res['start_times'][d])

        unav = model.df_av.loc[(model.df_av['room_id'] == r), ['day', 'start_time', 'end_time']]

        for idx, row in unav.iterrows():
            day = pd.Timestamp(row['day']).normalize()
            start_hour = int(row['start_time'].split(':')[0])
            end_hour = int(row['end_time'].split(':')[0])

            for hour in range(start_hour, end_hour):
                timestamp = day + pd.Timedelta(hours=hour)
                t = int((timestamp - pd.Timestamp(model.first_day)) / pd.Timedelta(hours=1))
                start_times.append(t)

        for t in range(model.no_timeslots):
            if not timeslot_illegal(t, model.timeslot_info['start_hour'],
                                    model.timeslot_info['end_hour']) and t not in start_times:
                timestamp = pd.to_datetime(model.first_day) + pd.to_timedelta(t, unit="h")
                room = get_room_name(model.rooms[r])
                day = timestamp.date()
                start = f"{timestamp.hour}:00"
                end = f"{timestamp.hour + 1}:00"
                df.loc[len(df)] = [room, day, start, end]

    def unused_timeslots_csv_evaluators(model, output_folder):
        df = pd.DataFrame(columns=["evaluator", "day", "start_time", "end_time"])

    # gather all unique evaluators from scheduled defenses
    evaluators_set = set()
    columns_to_include = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3',
                          'mentor4']
    for d in range(model.no_defenses):
        if res['is_planned'][d]:
            info = model.df_def.loc[d]
            for col in columns_to_include:
                val = info.get(col)
                if val is not None and not pd.isna(val):
                    evaluators_set.add(val)

    unavailable_intervals = get_unavailable_intervals(model, cfg, f'input_data/{cfg["input_data"]}/unavailabilities.csv',
                                                      'person')
    for evaluator in evaluators_set:
        start_times = []

        # add scheduled defense times
        for d in range(model.no_defenses):
            if res['is_planned'][d]:
                info = model.df_def.loc[d]
                st = res['start_times'][d]
                if st is None:
                    continue
                en = st + 1
                row_evaluators = []
                for col in columns_to_include:
                    val = info.get(col)
                    if val is not None and not pd.isna(val):
                        row_evaluators.append(val)
                if evaluator in row_evaluators:
                    start_times.append(st)

        # add unavailable intervals
        intervals = unavailable_intervals.get(evaluator, [])
        for u_start, u_end in intervals:
            current = u_start
            while current < u_end:
                t = int((current - pd.Timestamp(model.first_day)) / pd.Timedelta(hours=1))
                start_times.append(t)
                current += pd.Timedelta(hours=1)


        # fill unused timeslots
        for t in range(model.no_timeslots):
            if not timeslot_illegal(t, model.timeslot_info['start_hour'],
                                    model.timeslot_info['end_hour']) and t not in start_times:
                timestamp = pd.to_datetime(model.first_day) + pd.to_timedelta(t, unit="h")
                day = timestamp.date()
                start = f"{timestamp.hour}:00"
                end = f"{timestamp.hour + 1}:00"
                df.loc[len(df)] = [evaluator, day, start, end]


    df.to_csv(f'{output_folder}/unused_timeslots.csv', index=False)



def objective_csv(model, res, output_folder):
    objectives = []

    if cfg['adjacency_objective']:
        objectives.append({
            "adjacent-pairs":  model.adj_obj.value()
        })
        objectives.append({
            "number-pairs" : model.no_pairs
        })

    if not cfg['must_plan_all_defenses']:
        objectives.append({
            "planned-defenses" : model.defenses_obj.value()
        })
        objectives.append({
            "number-defenses" : int(model.no_defenses)
        })

    with open(f"{output_folder}/objectives.json", "w") as f:
        json.dump(objectives, f, indent=2)


def convert_result(model):
    """
    Extracts variable values from a CPMpy solution into a uniform dictionary.

    Args:
        model: cpmpy Model (used to check which variables exist)
        solution: cpmpy solver solution object (or model.value(var) values)

    Returns:
        dict with keys: 'in_room', 'start_times', and optionally 'is_planned'
    """
    data = {}

    # Extract in_room values
    if hasattr(model, "in_room"):
        data["in_room"] = [var.value() for var in model.in_room.flat]

    # Extract start_times values
    if hasattr(model, "start_times"):
        data["start_times"] = [var.value() for var in model.start_times.flat]

    # Extract is_planned values if it exists
    if hasattr(model, "is_planned"):
        data["is_planned"] = [var.value() for var in model.is_planned.flat]
    else:
        data['is_planned'] = [True]*model.no_defenses

    if hasattr(model, "planned"):
        room_and_time = []
        for d in range(model.no_defenses):
            possible_assignments = model.planned[d,:,:].value()
            i_arr, j_arr = np.where(possible_assignments == 1)
            if len(i_arr) == 0:
                i, j = None, None
            else:
                i, j = int(i_arr[0]), int(j_arr[0])
            room_and_time.append([i, j])
        data['in_room'] = [elem[0] if elem[0] != None else 0 for elem in room_and_time]
        data['start_times'] = [elem[1] if elem[0] != None else 0 for elem in room_and_time]
        data['is_planned'] = [elem[0] != None for elem in room_and_time]

    return data


from cpmpy.solvers.ortools import OrtSolutionPrinter

class MySolutionPrinter(OrtSolutionPrinter):
    def __init__(self, solver, **kwargs):
        super().__init__(solver, **kwargs)
        self.solution_counter = 0
        self.start_time = time.time()
        self.sol_time = time.time()
        self.run_id = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.output_folder = None

    def on_solution_callback(self):

        wall_time = time.time()
        if wall_time > self.sol_time:
            self.sol_time = wall_time

            self.solution_counter += 1

            print("Solution count:", self.solution_counter)
            print(f"Solution found in {wall_time - self.start_time} seconds.")

            self.output_folder = create_run_folder(self.run_id, counter=self.solution_counter)

            super().on_solution_callback()







if __name__ == "__main__":
    cfg = get_settings()

    model = DefenseRosteringModel(cfg)

    #empty_timetable(model)
    #gantt_chart_room_perspective(model, cfg, empty=True)
    #gantt_chart_evaluator_perspective(model, cfg, empty=True)


    start_solve = time.time()
    if cfg['solution_streaming']:
        start_solve = time.time()


        def callback_func():  # no arguments!

            if cfg['adjacency_objective']:
                print(f'Adjacency objective: {model.adj_obj.value()} out of {model.adj_obj_ub}')
                if cfg['must_plan_all_defenses']:
                    print(f'Current upper bound: {callback.best_objective_bound}')
                    print(f'Current optimality gap: {callback.best_objective_bound - model.adj_obj.value()}')

            if not cfg['must_plan_all_defenses']:
                print(f'Defenses planned: {model.defenses_obj.value()} out of {model.no_defenses}')

            res = convert_result(model)
            unused_timeslots_csv(model, res, callback.output_folder)

            output_csv(model, res, callback.output_folder)

            if cfg['show_feasible']:
                gantt_chart_room_perspective(model, cfg, empty=False, res=res)
                gantt_chart_evaluator_perspective(model, cfg, empty=False, res=res)


        solver = cp.SolverLookup.get("ortools", model)
        callback = MySolutionPrinter(solver, display=callback_func)

        solved = solver.solve(solution_callback=callback)

        end_solve = time.time()

        if solved:
            print(f"Optimal solution found in {end_solve - start_solve} seconds")
            if cfg['adjacency_objective']:
                print(f'Adjacency objective: {model.adj_obj.value()} out of {model.adj_obj_ub}')
            if not cfg['must_plan_all_defenses']:
                print(f'Defenses planned: {model.defenses_obj.value()} out of {model.no_defenses}')
            print('_______________________')

            # Final variable values
            res = convert_result(model)

            if cfg['show_optimal']:
                gantt_chart_room_perspective(model, cfg, empty=False, res=res)
                gantt_chart_evaluator_perspective(model, cfg, empty=False, res=res)

            output_folder = create_run_folder(callback.run_id, counter=callback.solution_counter)
            unused_timeslots_csv(model, res, output_folder)
            output_csv(model, res, output_folder)
        else:
            print("UNSAT time:", end_solve - start_solve)
    else:
        if cfg['solver'] == 'ortools':
            solved = model.solve(solver='ortools', num_workers=1, use_lns=False) # for experiments, num_workers = 1, use_lns = False
        else:
            solved = model.solve(solver=cfg['solver'])
        if solved:
            end_solve = time.time()
            #print("Objective: ", model.objective_value())
            print('Solve time: ', end_solve - start_solve, flush=True)
            res = convert_result(model)
            if cfg['show_optimal']:

                gantt_chart_room_perspective(model, cfg, empty=False, res=res)
                gantt_chart_evaluator_perspective(model, cfg, empty=False, res=res)

            run_id = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            output_folder = create_run_folder(run_id)
            print('Output folder: ', output_folder)
            #objective_csv(model, res, output_folder)
            unused_timeslots_csv(model, res, output_folder)
            output_csv(model, res, output_folder)
        else:
            end_solve = time.time()
            print('UNSAT time: ', end_solve - start_solve, flush=True)
            #print('unsat')
            #print(mus(soft=[model.is_planned[i] for i in range(len(model.is_planned))]))
