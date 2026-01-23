import colorsys
import datetime
import itertools
from collections import Counter
import json
import math
import random
import sys

import cpmpy as cp
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import plotly.io as pio
import csv
import argparse
import yaml

import os
import time
from cpmpy.tools.explain.mus import mus

# Ensure a non-notebook renderer to avoid nbformat dependency in CLI runs
pio.renderers.default = os.environ.get("PLOTLY_RENDERER", "svg")

# Parameter settings


## integer ipv boolean matrix voor rooms
## or-tools: Large Neighborhood search, maar seed moet gezet worden (belangrijk voor experimenten)
# Hoeveel defenses zijn niet adjacent
# Room availabilities van Toledo



DEFAULT_SETTINGS = {
    # Regarding the input data
    "input_data": "examples/medium",
    "output_dir": "data/output",
    "number_of_defenses_in_problem": "all",
    "number_of_unavailabilities_in_problem": "all",

    # Regarding the solving method
    "solver": "ortools",

    "allocation_model" : False,

    # Regarding the use case
    "adjacency_objective": False,
    "must_plan_all_defenses" : False,
    "allow_online_defenses": False,
    "availability_odds": 0.75,
    "online_odds": 0,
    "max_rooms": 12,
    "max_days": "NA",

    # Explainability/output
    "explain": False,
    "no_plots": True
}


def load_config_file(path):
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}


def build_parser():
    p = argparse.ArgumentParser(description="Defense scheduling configuration")

    # General
    p.add_argument("--config", type=str,
                   help="Path to YAML configuration file")

    # Regarding the input data
    p.add_argument("--input-data")
    p.add_argument("--number-of-defenses-in-problem", type=str)
    p.add_argument("--number-of-unavailabilities-in-problem", type=str)

    # Regarding the solving method
    p.add_argument("--solver")


    p.add_argument("--allocation-model", type=str, help="true/false")

    # Regarding the use case
    p.add_argument("--adjacency-objective", type=str,
                   help="true/false")
    p.add_argument("--must-plan-all-defenses", type=str,
                   help="true/false")
    p.add_argument("--allow-online-defenses", type=str,
                   help="true/false")
    p.add_argument("--first-hour", type=int)
    p.add_argument("--last-hour", type=int)
    p.add_argument("--availability-odds", type=float)
    p.add_argument("--online-odds", type=float)
    p.add_argument("--max-rooms", type=int)

    p.add_argument("--max-days", type=str)
    p.add_argument("--explain", action="store_true", help="Enable explainability exports (cores/util/slack)")
    p.add_argument("--no-plots", action="store_true", help="Skip Plotly figure rendering")

    return p


def str_to_bool(x):
    if isinstance(x, bool):
        return x
    if x is None:
        return None
    return x.lower() in ["1", "true", "yes", "y"]


def get_settings():
    settings = DEFAULT_SETTINGS.copy()

    parser = build_parser()
    args = parser.parse_args()

    if args.config:
        file_cfg = load_config_file(args.config)
        settings.update(file_cfg)

    for key in settings:
        value = getattr(args, key, None)
        if value is None:
            continue

        # Skip store_true flags (no_plots, explain) if they weren't explicitly set
        # These default to False in argparse but we want config/defaults to take precedence
        if key in ["no_plots", "explain"] and isinstance(value, bool) and not value:
            # Check if flag was actually in sys.argv
            flag_name = f"--{key.replace('_', '-')}"
            if flag_name not in sys.argv:
                continue

        if key in ["adjacency_objective", "allow_online_defenses", "allocation_model", "must_plan_all_defenses"]:
            value = str_to_bool(value)


        if key in ["number_of_defenses_in_problem",
                   "number_of_unavailabilities_in_problem"] and isinstance(value, str) and value.isdigit():
            value = int(value)

        if key == "max_days" and isinstance(value, str) and value.isdigit():
            value = int(value)

        settings[key] = value

    return settings









## integer ipv boolean matrix voor rooms
## or-tools: Large Neighborhood search, maar seed moet gezet worden (belangrijk voor experimenten)
# Hoeveel defenses zijn niet adjacent
# Room availabilities van Toledo




class DefenseRosteringModel(cp.Model):
    def __init__(self, cfg):
        super().__init__()

        # Resolve input data path
        input_path = cfg['input_data']
        if not os.path.isabs(input_path) and not input_path.startswith('data/'):
            # Relative path without data/ prefix - prepend data/input/
            input_path = os.path.join('data', 'input', input_path)
        self.input_path = input_path

        #rewrite_availabilities(availabilities, cfg)

        #rewrite_defenses(defenses, cfg)
        if cfg['number_of_defenses_in_problem'] != 'all':
            self.df_av = pd.read_csv(f'{input_path}/unavailabilities.csv', nrows=cfg['number_of_defenses_in_problem'])
        else:
            self.df_av = pd.read_csv(f'{input_path}/unavailabilities.csv')
        if cfg['number_of_unavailabilities_in_problem'] != 'all':
            self.df_def = pd.read_csv(f'{input_path}/defences.csv', nrows=cfg['number_of_unavailabilities_in_problem'])
        else:
            self.df_def = pd.read_csv(f'{input_path}/defences.csv')

        def _merge_unavailabilities(df):
            if df.empty:
                return df
            df = df.copy()
            if "status" in df.columns:
                group_cols = ["name", "type", "day", "status"]
            else:
                group_cols = ["name", "type", "day"]
            df["start_dt"] = pd.to_datetime(df["day"].astype(str) + " " + df["start_time"].astype(str))
            df["end_dt"] = pd.to_datetime(df["day"].astype(str) + " " + df["end_time"].astype(str))
            df = df.sort_values(group_cols + ["start_dt"])

            merged_rows = []
            for _, group in df.groupby(group_cols, sort=False):
                current = None
                for _, row in group.iterrows():
                    if current is None:
                        current = row.copy()
                        continue
                    if row["start_dt"] == current["end_dt"]:
                        current["end_dt"] = row["end_dt"]
                        current["end_time"] = row["end_time"]
                    else:
                        merged_rows.append(current)
                        current = row.copy()
                if current is not None:
                    merged_rows.append(current)
            merged = pd.DataFrame(merged_rows)
            merged["day"] = pd.to_datetime(merged["day"]).dt.strftime("%Y-%m-%d")
            merged["start_time"] = pd.to_datetime(merged["start_dt"]).dt.strftime("%H:%M")
            merged["end_time"] = pd.to_datetime(merged["end_dt"]).dt.strftime("%H:%M")
            return merged.drop(columns=["start_dt", "end_dt"])

        self.df_av = _merge_unavailabilities(self.df_av)

        with open(f'{input_path}/timeslot_info.json') as f:
            self.timeslot_info = json.load(f)

        self.max_rooms = cfg['max_rooms']

        with open(f'{input_path}/rooms.json') as f:
            data = json.load(f)

        raw_rooms = data.get("rooms", [])
        normalized_rooms = []
        for idx, room in enumerate(raw_rooms):
            if isinstance(room, dict):
                if not room.get("enabled", True):
                    continue
                name = room.get("name") or room.get("id") or f"Room {idx+1}"
            else:
                name = str(room)
            normalized_rooms.append(name)
        self.rooms = normalized_rooms[: self.max_rooms]

        def _normalize_room_name(value):
            return " ".join(str(value).strip().split()).lower()

        room_index = {_normalize_room_name(name): idx for idx, name in enumerate(self.rooms)}

        # Determining the first and last day that defenses take place


        self.first_day = datetime.datetime.strptime(self.timeslot_info['first_day'], "%Y-%m-%d")

        self.df_av['start_id'] = ((pd.to_datetime(self.df_av['day']) + pd.to_timedelta(self.df_av['start_time'] + ':00') - self.first_day)
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
        evaluator_types = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']

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
        self.evaluator_to_defenses = {
            ev: self.df_evaluators.index[self.df_evaluators['evaluators'] == ev].unique().tolist()
            for ev in self.evaluator_list
        }

        self.df_def = self.df_def.reset_index(drop=True)
        # Use a stable per-row defense id to avoid collisions on duplicate student names.
        self.df_def['defense_id'] = range(len(self.df_def))

        #self.df_rav['rid'] = pd.factorize(self.df_rav['room_id'])[0]

        mask = self.df_av['type'] == 'room'
        self.df_av['room_id'] = pd.NA
        if mask.any():
            self.df_av.loc[mask, 'room_id'] = self.df_av.loc[mask, 'name'].map(
                lambda name: room_index.get(_normalize_room_name(name))
            )

        if cfg['max_days'] == 'NA':
            self.no_days = self.timeslot_info['number_of_days']
        else:
            self.no_days = cfg['max_days']

        self.no_timeslots = 24*self.no_days
        self.no_defenses = len(self.df_def)

        self._person_unavail = {}
        self._room_unavail = {}
        for row in self.df_av.itertuples(index=False):
            row_type = getattr(row, "type", None)
            start_id = getattr(row, "start_id", None)
            end_id = getattr(row, "end_id", None)
            if start_id is None or end_id is None or pd.isna(start_id) or pd.isna(end_id):
                continue
            if row_type == "person":
                name = getattr(row, "name", None)
                if not name or pd.isna(name):
                    continue
                self._person_unavail.setdefault(name, []).append((int(start_id), int(end_id)))
            elif row_type == "room":
                room_id = getattr(row, "room_id", None)
                if room_id is None or pd.isna(room_id):
                    continue
                rid = int(room_id)
                if rid < 0:
                    continue
                self._room_unavail.setdefault(rid, []).append((int(start_id), int(end_id)))

        self._illegal_blocks = []
        dur = 0
        for t in range(self.no_timeslots):
            if timeslot_illegal(t, self.timeslot_info['start_hour'], self.timeslot_info['end_hour']):
                dur += 1
            elif dur > 0:
                self._illegal_blocks.append((t - dur, dur, t))
                dur = 0
        if dur > 0:
            self._illegal_blocks.append((self.no_timeslots - dur, dur, self.no_timeslots))


        shape = (self.no_defenses,)
        self.start_times = cp.intvar(lb=0, ub=self.no_timeslots-1, shape=shape, name='start_times')
        self.in_room = cp.intvar(lb=0, ub=len(self.rooms)-1, shape=shape, name='in_room') # use actual number of loaded rooms
        self.is_planned = cp.boolvar(shape=shape, name='is_planned')


        self.constraints = []
        self.constraint_labels = []
        self.assumption_constraints = []
        self.assumption_literals = []
        self.assumption_labels = {}
        self._track_labels = bool(cfg.get("explain", False))

        if cfg['allocation_model']:
            self.add_labeled("evaluator_availability", self.evaluator_availability_constraints_allocation())
            self.add_labeled("evaluator_overlap", self.evaluator_overlap_constraints_allocation())

            self.add_labeled("room_availability", self.room_availability_constraints_allocation())
            self.add_labeled("room_overlap", self.room_overlap_constraints_allocation())

            self.add_labeled("timeslot", self.timeslot_constraints_allocation())
        else:
            self.add_labeled("evaluator_availability_overlap", self.evaluator_availability_and_overlap_constraints())
            self.add_labeled("room_availability_overlap", self.room_availability_and_overlap_constraints())

        # Minimize the amount of rooms used

        #self.defenses_obj = cp.NValue(self.in_room)
        #self.minimize(cp.sum(~cp.AllEqual(self.start_times[:,r]) for r in range(self.max_rooms)))

        # Maximize the number of assigned defenses
        #self.maximize(cp.sum(cp.any(self.in_room[d,:]) for d in range(self.no_defenses)) - adjacency_obj)

        # Adjacency objective test
        if cfg['adjacency_objective']:
            if cfg['must_plan_all_defenses']:
                self.add_labeled("must_plan_all", [cp.all(self.is_planned)])
                self.adj_obj, self.no_pairs, self.adj_obj_ub = self.adjacency_objectives()
                self.add_labeled("adjacency_bound", [self.adj_obj <= self.adj_obj_ub])

                self.maximize(self.adj_obj)
            else:
                self.defenses_obj = cp.sum(self.is_planned)
                self.adj_obj, self.no_pairs, self.adj_obj_ub = self.adjacency_objectives()
                self.add_labeled("adjacency_bound", [self.adj_obj <= self.adj_obj_ub])
                # Weight must be large enough that scheduling ANY additional defense
                # is always better than ANY adjacency improvement. Use a large constant
                # to ensure numerical stability with OR-Tools.
                defense_weight = max(self.adj_obj_ub + 1, 10000)
                self.maximize(defense_weight * self.defenses_obj + self.adj_obj)
        else:
            if cfg['must_plan_all_defenses']:
                self.add_labeled("must_plan_all", [cp.all(self.is_planned)])

                self.dummy = cp.intvar(lb=0, ub=1)
                self.add_labeled("dummy", [self.dummy == 1])
                self.maximize(self.dummy)
            else:
                self.defenses_obj = cp.sum(self.is_planned)
                self.maximize(self.defenses_obj)

        if cfg.get("explain", False):
            self.add_assumption_constraints()

    def add_labeled(self, label, constraints):
        """Add constraints to the model and keep a label for explainability grouping."""
        super().add(constraints)
        if self._track_labels:
            self.constraint_labels.extend((c, label) for c in constraints)

    def add_assumption_constraints(self):
        """Add per-interval assumption constraints for more granular cores when explaining UNSAT."""
        assumptions = []

        # Room unavailability per timeslot
        for _, av in self.df_av.iterrows():
            start_id = av.get('start_id')
            end_id = av.get('end_id')
            if start_id is None or end_id is None or pd.isna(start_id) or pd.isna(end_id):
                continue
            if av['type'] == 'room' and av['room_id'] == av['room_id'] and av['room_id'] < self.max_rooms:
                if av['room_id'] is None or pd.isna(av['room_id']):
                    continue
                r = int(av['room_id'])
                label_base = f"room:{av['name']}@{av['day']} {av['start_time']}-{av['end_time']}"
                for t in range(int(start_id), int(end_id)):
                    a = cp.boolvar(name=f"assume_room_{r}_t{t}")
                    cons = [
                        a.implies(self.is_planned[d].implies((self.in_room[d] != r) | (self.start_times[d] != t)))
                        for d in range(self.no_defenses)
                    ]
                    self.assumption_literals.append(a)
                    self.assumption_labels[a] = f"{label_base} slot={t}"
                    self.assumption_constraints.extend((c, f"{label_base} slot={t}") for c in cons)
                    super().add(cons)

        # Evaluator unavailability per timeslot
        for _, av in self.df_av.iterrows():
            start_id = av.get('start_id')
            end_id = av.get('end_id')
            if start_id is None or end_id is None or pd.isna(start_id) or pd.isna(end_id):
                continue
            if av['type'] == 'person':
                name = av['name']
                defenses = self.evaluator_to_defenses.get(name, [])
                if not defenses:
                    continue
                label_base = f"person:{name}@{av['day']} {av['start_time']}-{av['end_time']}"
                for t in range(int(start_id), int(end_id)):
                    a = cp.boolvar(name=f"assume_person_{abs(hash(name)) % 10000}_t{t}")
                    cons = [
                        a.implies(self.is_planned[d].implies(self.start_times[d] != t))
                        for d in defenses
                    ]
                    self.assumption_literals.append(a)
                    self.assumption_labels[a] = f"{label_base} slot={t}"
                    self.assumption_constraints.extend((c, f"{label_base} slot={t}") for c in cons)
                    super().add(cons)

        # Illegal timeslots (start hour/end hour)
        for t in range(self.no_timeslots):
            if timeslot_illegal(t, self.timeslot_info['start_hour'], self.timeslot_info['end_hour']):
                a = cp.boolvar(name=f"assume_illegal_t{t}")
                cons = [a.implies(self.start_times[d] != t) for d in range(self.no_defenses)]
                self.assumption_literals.append(a)
                self.assumption_labels[a] = f"timeslot_illegal:{t}"
                self.assumption_constraints.extend((c, f"timeslot_illegal:{t}") for c in cons)
                super().add(cons)








        #else:
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

    def evaluator_availability_constraints_allocation(self):
        constraints = []
        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            for idx, av in self.df_av.iterrows():
                if av['name'] == evaluator and av['type'] == 'person':
                    start_id = av.get('start_id')
                    end_id = av.get('end_id')
                    if start_id is None or end_id is None or pd.isna(start_id) or pd.isna(end_id):
                        continue
                    for t in range(int(start_id), int(end_id)):
                        constraints += [self.is_planned[defenses].implies(self.start_times[defenses] != t)]
        return constraints



    def evaluator_overlap_constraints_allocation(self):
        constraints = []

        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            constraints += [cp.AllDifferentExcept0(self.is_planned[defenses]*(self.start_times[defenses]+1))]

        return constraints


    def room_availability_constraints_allocation(self):
        constraints = []
        for r in range(len(self.rooms)):
            for idx, av in self.df_av.iterrows():
                if av['type'] == 'room' and av['room_id'] == r:
                    start_id = av.get('start_id')
                    end_id = av.get('end_id')
                    if start_id is None or end_id is None or pd.isna(start_id) or pd.isna(end_id):
                        continue
                    for t in range(int(start_id), int(end_id)):
                        constraints += [self.is_planned.implies((self.in_room != r) | (self.start_times != t))]
        return constraints

    def room_overlap_constraints_allocation(self):
        constraints = []
        # Use len(self.rooms) to match actual room count
        num_rooms = len(self.rooms)
        constraints += [cp.AllDifferentExcept0((num_rooms + 2)*self.is_planned*self.start_times + self.is_planned*(self.in_room+1))]

        return constraints

    def timeslot_constraints_allocation(self):
        constraints = []
        for t in range(self.no_timeslots):
            if timeslot_illegal(t, self.timeslot_info['start_hour'], self.timeslot_info['end_hour']):
                constraints += [self.start_times != t]
        return constraints

    def evaluator_availability_and_overlap_constraints(self):
        constraints = []

        for evaluator, defenses in self.evaluator_to_defenses.items():
            if not defenses:
                continue

            start = [self.start_times[idx] for idx in defenses]
            duration = [1 for _ in defenses]
            end = [start[i] + duration[i] for i in range(len(start))]
            heights = [self.is_planned[idx] for idx in defenses]
            for start_id, end_id in self._person_unavail.get(evaluator, []):
                start.append(start_id)
                duration.append(end_id - start_id)
                end.append(end_id)
                heights.append(1)

            constraints += [cp.Cumulative(start=start, duration=duration, end=end, demand=heights, capacity=1)]

        return constraints

    def room_availability_and_overlap_constraints(self):
        constraints = []
        # for d in range(self.no_defenses):
        #    constraints += [cp.sum(self.in_room[d,:]) <= 1]

        # Iterate over actual rooms loaded (in_room domain is 0..len(self.rooms)-1)
        for r in range(len(self.rooms)):
            start = list(self.start_times)
            duration = [1 for _ in range(self.no_defenses)]
            end = [start[i] + duration[i] for i in range(len(start))]

            heights = [self.is_planned[idx] * (self.in_room[idx] == r) for idx in range(self.no_defenses)]

            for start_id, end_id in self._room_unavail.get(r, []):
                start.append(start_id)
                duration.append(end_id - start_id)
                end.append(end_id)
                heights.append(1)

            for start_id, dur, end_id in self._illegal_blocks:
                if dur <= 0:
                    continue
                start.append(start_id)
                duration.append(dur)
                end.append(end_id)
                heights.append(1)

            constraints += [cp.Cumulative(start=start, duration=duration, end=end, demand=heights, capacity=1)]

        # for t in range(self.no_timeslots):
        #    if timeslot_illegal(t):
        #        for d in range(self.no_defenses):
        #            constraints += [self.start_times[d] != t]

        return constraints

    def adjacency_objectives(self, scheduled_only=None):
        """
        Build adjacency objective for evaluator pairs.

        Args:
            scheduled_only: Optional set of defense indices. When provided,
                only considers defenses in this set and omits is_planned products
                (assumes all are planned). This dramatically improves performance
                for two-phase solving.
        """
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

            # Filter to scheduled defenses only if provided
            if scheduled_only is not None:
                defenses = [d for d in defenses if d in scheduled_only]

            d = len(defenses)
            if d < 2:
                continue

            if d < self.timeslot_info['end_hour'] - self.timeslot_info['start_hour']:
                time_objective_ub -= (1/2)*(d**2) - (3/2)*d + 1
            else:
                time_objective_ub -= (1/2)*(d**2) - (1/2)*d - self.timeslot_info['end_hour'] + self.timeslot_info['start_hour'] + 1

            for d1 in defenses:
                for d2 in defenses:
                    if d1 != d2:
                        if scheduled_only is not None:
                            # Phase 2: all defenses are planned, skip is_planned products
                            adjacency_objective += (
                                ((self.start_times[d1] - self.start_times[d2]) == 1) *
                                (self.in_room[d1] == self.in_room[d2])
                            )
                        else:
                            # Original: include is_planned products
                            adjacency_objective += (
                                self.is_planned[d1] * self.is_planned[d2] *
                                ((self.start_times[d1] - self.start_times[d2]) == 1) *
                                (self.in_room[d1] == self.in_room[d2])
                            )
                        pairs_count += 1

        pairs_count //= 2
        time_objective_ub += pairs_count
        time_objective_ub = int(time_objective_ub)

        return adjacency_objective, pairs_count, time_objective_ub

        # Formulating the time adjacency objective as:
        #       maximize the amount of defenses with a common evaluator that are adjacent (e.g. 8s for nrows=20, nrooms=5, ortools)
        # is more efficient than
        #       minimize the distance between defenses with a common evaluator (e.g. 98s for nrows=20, nrooms=5, ortools)



def get_unavailable_intervals(model, cfg, csv_path, type):
    if cfg['number_of_unavailabilities_in_problem'] != 'all':
        df = pd.read_csv(csv_path, nrows=cfg['number_of_unavailabilities_in_problem'])
    else:
        df = pd.read_csv(csv_path)


    # Only keep rows of this type
    df = df[df['type'] == type]

    # Combine day + time into full datetime
    df["start_dt"] = pd.to_datetime(df["day"] + " " + df["start_time"])
    df["end_dt"]   = pd.to_datetime(df["day"] + " " + df["end_time"])

    results = {}

    for name, group in df.groupby("name"):

        # create list of (start_datetime, end_datetime)
        intervals = list(zip(group["start_dt"], group["end_dt"]))

        if type == "room":
            # map room name → room_id

            if name in model.rooms:
                room_id = model.rooms.index(name)
                if room_id < model.max_rooms:
                    results[room_id] = intervals

        elif type == "person":
            # store by person name
            results[name] = intervals

    return results




def add_striped_block(fig, room, start, end, color="black"):
    y0 = room - 0.4
    y1 = room + 0.4

    fig.add_shape(
        type="rect",
        x0=start, x1=end,
        y0=y0, y1=y1,
        fillcolor=color,
        opacity=0.5,
        line_width=0,
        layer="below",
    )

'''def add_striped_block(fig, room, start, end, color="gray"):
    y0 = room - 0.4
    y1 = room + 0.4

    # Draw the translucent background block
    fig.add_shape(
        type="rect",
        x0=start, x1=end,
        y0=y0, y1=y1,
        fillcolor=color,
        opacity=0.15,
        line_width=0,
        layer="below",
    )

    # Compute stripe positions (every 30 minutes)
    stripe_times = pd.date_range(start, end, freq="30min")

    # Build a single trace for all vertical stripes
    xs = []
    ys = []

    for t in stripe_times:
        xs.extend([t, t, None])  # None splits segments
        ys.extend([y0, y1, None])

    fig.add_trace(go.Scattergl(
        x=xs,
        y=ys,
        mode="lines",
        line=dict(color=color, width=0.7),
        hoverinfo="skip",
        showlegend=False
    ))'''







'''def empty_room_perspective(model, cfg):
    max_rooms = cfg['max_rooms']

    # Create a dummy time range (required by px.timeline)
    first_day = model.timeslot_info['first_day']
    n_days = model.timeslot_info['number_of_days']

    start = pd.to_datetime(first_day)
    end = pd.to_datetime(first_day) + datetime.timedelta(days=n_days)

    rows = []
    for r in range(max_rooms):
        rows.append({
            "room_id": r,
            "room": model.df_av.loc[model.df_av["room_id"] == r, "name"].iloc[0],
            "start": start,
            "end": end,
        })

    df = pd.DataFrame(rows)

    fig = px.timeline(
        df,
        x_start="start",
        x_end="end",
        y="room_id",
        color="room_id",
        hover_data=["room"],
        title="Initial room view"
    )

    # Optional: nicer appearance
    fig.update_yaxes(title="Rooms")
    fig.update_xaxes(title="Timeline")
    fig.update_traces(marker_opacity=0)

    room_mapping = dict(zip(df["room_id"], df["room"]))

    fig.update_yaxes(
        tickvals=list(room_mapping.keys()),
        ticktext=list(room_mapping.values()),
        title_text="Rooms",
        autorange='reversed'
    )

    add_room_unavailabilities(fig)

    fig.show()



def empty_evaluator_perspective(model, cfg):
    end = (model.timeslot_info['start_hour'] + 1) % 24
    start = model.timeslot_info['end_hour']
    rows = []
    for d in range(model.no_defenses):
        if model.is_planned[d].value():
            st = model.start_times[d].value()
            if st is not None:
                info = model.df_def.loc[d]
                en = st + 1

                room_id = None
                for r in range(len(model.rooms)):
                    if model.in_room[d].value() == r:
                        room_id = r
                        break
                # room_name = model.df_rav.loc[model.df_rav["room_id"] == f'room-{room_id}', "name"].iloc[0]


    df = pd.DataFrame(rows)
    fig = px.timeline(
        df,
        x_start="start",
        x_end="end",
        y="evaluator",
        color="room",
        hover_data=["student"],
        title=f"Defense Schedule Gantt Chart – {model.adj_obj.value()} adjacent defenses out of {model.adj_obj_ub}." if
        cfg['adjacency_objectives'] else
        "Defense Schedule Gantt Chart"
    )'''

def generate_color_palette(n):
    """Generate n visually distinct colors in HEX format."""
    colors = []
    for i in range(n):
        hue = i / n
        r, g, b = colorsys.hsv_to_rgb(hue, 0.65, 0.95)
        colors.append('#{:02x}{:02x}{:02x}'.format(int(r*255), int(g*255), int(b*255)))
    return colors


def get_hour_points(model):
    raw_first_day = model.timeslot_info["first_day"]
    n_days = model.no_days
    start_hour = model.timeslot_info["start_hour"]
    end_hour = model.timeslot_info["end_hour"]

    # Parse first_day if needed
    if isinstance(raw_first_day, str):
        first_day = datetime.datetime.strptime(raw_first_day, "%Y-%m-%d").date()
    else:
        first_day = raw_first_day

    hour_points = []

    # Loop over days (no hourly iteration)
    for i in range(n_days):
        day = first_day + datetime.timedelta(days=i)

        start_dt = datetime.datetime.combine(day, datetime.time(start_hour, 0))
        end_dt = datetime.datetime.combine(day, datetime.time(end_hour, 0))

        hour_points.append(start_dt)
        hour_points.append(end_dt)

    return hour_points


def layout(fig, title, is_room, is_empty):
    fig.update_layout(
        margin=dict(l=40, r=40, t=80, b=40)
    )

    fig.update_layout(
        font=dict(
            family="Arial, Helvetica, sans-serif",
            size=14
        ),
        title_font=dict(size=20)
    )

    fig.update_xaxes(showgrid=True, gridwidth=1, gridcolor="LightGray")
    fig.update_yaxes(showgrid=False)

    legend_title = ""
    if not is_empty and is_room:
        legend_title = "Student"
    elif not is_empty and not is_room:
        legend_title = "Room"

    fig.update_layout(
        legend=dict(
            title=legend_title,
            orientation="h",
            yanchor="bottom",
            y=-0.25,
            xanchor="left",
            x=0
        )
    )

    fig.update_traces(
        marker=dict(line=dict(width=0.5, color="black"))
    )

    fig.update_layout(
        plot_bgcolor="rgba(245,245,245,0.4)"
    )

    fig.update_layout(
        title=dict(
            text=title,
            x=0.5,
            xanchor="center",
            yanchor="top"
        )
    )




def gantt_chart_room_perspective(model, cfg, empty):
    rows = []
    if not empty:
        for d in range(model.no_defenses):
            if model.is_planned[d].value():
                for r in range(len(model.rooms)):
                    if model.in_room[d].value() == r:
                        st = model.start_times[d].value()
                        if st != None:
                            info = model.df_def.loc[d]
                            en = st + 1
                            rows.append({
                                "defense_id": d+1,
                                "room": model.rooms[r],
                                "room_id" : r,
                                "student": info["student"],
                                "supervisor" : info["supervisor"],
                                **({ "co_supervisor": info["co_supervisor"] } if not pd.isna(info['co_supervisor']) else {}),
                                "start": pd.to_datetime(st, unit="h", origin=model.first_day),
                                "end": pd.to_datetime(en, unit="h", origin=model.first_day)
                            })

    unavailable_intervals = get_unavailable_intervals(model, cfg, f'{model.input_path}/unavailabilities.csv',
                                                      'room')

    for room, intervals in unavailable_intervals.items():

        for u_start, u_end in intervals:
            rows.append({
                "defense_id": pd.NA,
                "room": model.rooms[room],
                "room_id": room,
                "student" : 'UNAVAILABLE',
                "supervisor" : pd.NA,
                "co_supervisor": pd.NA,
                "start": u_start,
                "end": u_end
            })

    df = pd.DataFrame(rows)

    color_map = {
        'UNAVAILABLE': 'grey'  # <-- Assign the desired color (e.g., lightgrey, #808080)
    }
    color_sequence = generate_color_palette(model.no_defenses)
    # 4. Map the valid IDs to the standard color sequence
    for d in range(model.no_defenses):
        # Use the modulo operator (%) to cycle through the color_sequence if there are more IDs than colors
        color_map[model.df_def.loc[d]['student']] = color_sequence[d % len(color_sequence)]


    title = None
    if empty:
        title = "Initial room view"
    elif not cfg['must_plan_all_defenses']:
        title = f"Defense Schedule Gantt Chart – {model.defenses_obj.value()} of {model.no_defenses} defenses planned"
    else:
        title = f"Defense Schedule Gantt Chart"

    if df.empty:
        first_day = datetime.datetime.strptime(model.timeslot_info["first_day"], "%Y-%m-%d").date()
        start_hour = model.timeslot_info["start_hour"]
        end_hour = model.timeslot_info["end_hour"]
        dummy_start = datetime.datetime.combine(first_day, datetime.time(start_hour, 0))
        dummy_end = datetime.datetime.combine(first_day, datetime.time(end_hour, 0))

        dummy = {
            "start": dummy_start,
            "end": dummy_end,
            "room_id": "_dummy_",  # unique value
            "room" : "_dummy_",
            "student": "_dummy_",
            "supervisor": "",
            "co_supervisor": ""
        }
        df = pd.DataFrame([dummy])
        color_map["_dummy_"] = "rgba(0,0,0,0)"


    fig = px.timeline(
        df,
        x_start="start",
        x_end="end",
        y="room_id",
        color="student",
        hover_data=["student", "supervisor", "co_supervisor"],
        title=title,
              #f"Adjacency score: {model.time_obj.value()}\n"
              #f"Room similarity score: {model.room_obj.value()}",
        color_discrete_map=color_map
    )


    for trace in fig.data:
        if trace.name == "_dummy_":
            trace.opacity = 0
            trace.showlegend = False

    hour_points = get_hour_points(model)
    for t in hour_points:
        fig.add_vline(
            x=t,
            line_width=5,
            line_color="black",
            opacity=1,
            layer="below"  # keep bars clearly visible
        )



    layout(fig, title, is_room=True, is_empty=empty)



    room_mapping = dict(zip(df["room_id"], df["room"]))


    fig.update_yaxes(
        tickvals=list(room_mapping.keys()),
        ticktext=list(room_mapping.values()),
        title_text="Rooms",
        autorange='reversed'
    )

    fig.show()




def gantt_chart_evaluator_perspective(model, cfg, empty):

    rows = []
    if not empty:
        for d in range(model.no_defenses):
            if model.is_planned[d].value():
                st = model.start_times[d].value()
                if st is not None:
                    info = model.df_def.loc[d]
                    en = st + 1


                    room_id = None
                    for r in range(len(model.rooms)):
                        if model.in_room[d].value() == r:
                            room_id = r
                            break
                    #room_name = model.df_rav.loc[model.df_rav["room_id"] == f'room-{room_id}', "name"].iloc[0]
                    columns_to_include = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']

                    evaluators = []

                    for col in columns_to_include:
                        val = info.get(col)
                        if val is not None and not pd.isna(val):
                            evaluators.append(val)


                    for evaluator in evaluators:
                        rows.append({
                            "evaluator": evaluator,
                            "student": info["student"],
                            "room": model.rooms[room_id],
                            "start": pd.to_datetime(st, unit="h", origin=model.first_day),
                            "end": pd.to_datetime(en, unit="h", origin=model.first_day)
                        })
    unavailable_intervals = get_unavailable_intervals(model, cfg, f'{model.input_path}/unavailabilities.csv',
                                                      'person')
    for person, intervals in unavailable_intervals.items():
        for u_start, u_end in intervals:

            rows.append({
                "evaluator": person,
                "student": pd.NA,
                "room": 'UNAVAILABLE',
                "start": u_start,
                "end": u_end
            })

    df = pd.DataFrame(rows)

    color_map = {
        'UNAVAILABLE': 'grey'
    }
    color_sequence = generate_color_palette(model.max_rooms)
    # 4. Map the valid IDs to the standard color sequence
    for r in range(len(model.rooms)):
        room = model.rooms[r]
        # Use the modulo operator (%) to cycle through the color_sequence if there are more IDs than colors
        color_map[room] = color_sequence[r % len(color_sequence)]

    title = None
    if empty:
        title = f"Initial evaluator view"
    elif cfg['adjacency_objective']:
        title = f"Defense Schedule Gantt Chart – {model.adj_obj.value()} adjacent defenses out of {model.adj_obj_ub} possible pairs."
    else:
        title = f"Defense Schedule Gantt Chart"

    if df.empty:

        first_day = datetime.datetime.strptime(model.timeslot_info["first_day"], "%Y-%m-%d").date()
        start_hour = model.timeslot_info["start_hour"]
        end_hour = model.timeslot_info["end_hour"]
        dummy_start = datetime.datetime.combine(first_day, datetime.time(start_hour, 0))
        dummy_end = datetime.datetime.combine(first_day, datetime.time(end_hour, 0))

        dummy = {
            "start": dummy_start,
            "end": dummy_end,
            "evaluator": "_dummy_",  # unique value
            "student": "_dummy_",
            "room":  "_dummy_"
        }
        df = pd.DataFrame([dummy])
        color_map["_dummy_"] = "rgba(0,0,0,0)"

    fig = px.timeline(
        df,
        x_start="start",
        x_end="end",
        y="evaluator",
        color="room",
        hover_data=["student"],
        title=title,
        color_discrete_map=color_map
    )


    for trace in fig.data:
        if trace.name == "_dummy_":
            trace.opacity = 0
            trace.showlegend = False


    hour_points = get_hour_points(model)

    for t in hour_points:
        fig.add_vline(
            x=t,
            line_width=5,
            line_color="black",
            opacity=1,
            layer="below"  # keep bars clearly visible
        )

    layout(fig, title, is_room=False, is_empty=empty)


    fig.update_yaxes(title_text='People',
        autorange='reversed')

    fig.show()



def empty_timetable(model):
    first_day = model.timeslot_info["first_day"]
    n_days = model.no_days
    start_hour = model.timeslot_info["start_hour"]
    end_hour = model.timeslot_info["end_hour"]

    days = pd.date_range(first_day, periods=n_days)
    day_labels = days.strftime("%a %d %b")  # e.g., "Mon 01 Jan"

    # Hours
    hours = list(range(start_hour, end_hour))
    hour_labels = [f"{h:02d}:00" for h in hours]

    # Empty grid (values only used for cell backgrounds)
    data = [[0 for _ in day_labels] for _ in hour_labels]

    fig = px.imshow(
        data,
        x=day_labels,
        y=hour_labels,
        aspect="auto",
        color_continuous_scale=[[0, "#f5f5f5"], [1, "#e5e5e5"]],  # subtle grey
    )

    # --- Layout improvements ---
    fig.update_layout(
        title="Timetable view",
        title_x=0.5,
        font=dict(size=14),
        xaxis_title="Day",
        yaxis_title="Hour",
        coloraxis_showscale=False,
        margin=dict(l=60, r=20, t=60, b=40),
        plot_bgcolor="white",
    )

    # Add gridlines by forcing tick lines to show
    fig.update_xaxes(
        showgrid=True, gridwidth=1, gridcolor="#cccccc",
        ticks="outside", ticklen=5
    )
    fig.update_yaxes(
        showgrid=True, gridwidth=1, gridcolor="#cccccc",
        ticks="outside", ticklen=5,
        autorange="reversed"  # timetable convention: earlier at top
    )

    # Thin borders around cells
    fig.update_traces(
        hovertemplate="Day: %{x}<br>Hour: %{y}<extra></extra>",
        xgap=1,  # spacing between cells
        ygap=1,
    )

    fig.show()

import os

def create_run_folder(base="output_data"):
    run_id = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    folder_path = os.path.join(base, run_id)
    os.makedirs(folder_path, exist_ok=True)
    print(f"Run ID: {run_id}")
    return folder_path, run_id

def output_csv(model, output_folder):
    df = model.df_def
    df.drop(["person", "evaluators"], axis=1, inplace=True)

    for d in range(model.no_defenses):
        if model.is_planned[d].value():
            r = model.in_room[d].value()
            if r < len(model.rooms):  # Safety check
                t = model.start_times.value()[d]
                timestamp = pd.to_datetime(model.first_day) + pd.to_timedelta(t, unit="h")
                day = timestamp.date()
                start = str(timestamp.hour) + ':00'
                end = str(timestamp.hour + 1) + ':00'
                room = model.rooms[r]

                df.loc[df['defense_id'] == d, ['day', 'start_time', 'end_time', 'room']] = [day, start, end, room]
    df = df.drop(columns=['defense_id'])

    df.to_csv(f'{output_folder}/output.csv', index=False)


def timeslot_illegal(t, earliest_start, latest_start):
    return ((t % 24) < earliest_start) | ((t % 24) >= latest_start)

def unused_timeslots_csv(model, output_folder):
    df = pd.DataFrame(columns=["name", "day", "start_time", "end_time"])

    for r in range(len(model.rooms)):

        start_times = []
        for d in range(model.no_defenses):
            if model.in_room[d].value() == r:
                start_times.append(model.start_times[d].value())

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
                room = model.rooms[r]
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
        if model.is_planned[d].value():
            info = model.df_def.loc[d]
            for col in columns_to_include:
                val = info.get(col)
                if val is not None and not pd.isna(val):
                    evaluators_set.add(val)

    unavailable_intervals = get_unavailable_intervals(model, cfg, f'{model.input_path}/unavailabilities.csv',
                                                      'person')
    for evaluator in evaluators_set:
        start_times = []

        # add scheduled defense times
        for d in range(model.no_defenses):
            if model.is_planned[d].value():
                info = model.df_def.loc[d]
                st = model.start_times[d].value()
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


def _blocked_sets(model):
    """Return per-room and per-person blocked timeslot sets (including illegal hours)."""
    blocked_rooms = {r: set() for r in range(len(model.rooms))}
    blocked_people = {}

    for _, av in model.df_av.iterrows():
        start_id = av.get('start_id')
        end_id = av.get('end_id')
        if start_id is None or end_id is None or pd.isna(start_id) or pd.isna(end_id):
            continue
        if av['type'] == 'room' and av['room_id'] == av['room_id'] and av['room_id'] < model.max_rooms:
            room_id = av['room_id']
            if room_id is None or pd.isna(room_id):
                continue
            for t in range(int(start_id), int(end_id)):
                blocked_rooms[int(room_id)].add(int(t))
        elif av['type'] == 'person':
            name = av['name']
            if name is None or pd.isna(name):
                continue
            blocked_people.setdefault(name, set())
            for t in range(int(start_id), int(end_id)):
                blocked_people[name].add(int(t))

    global_blocked = set()
    for t in range(model.no_timeslots):
        if timeslot_illegal(t, model.timeslot_info['start_hour'], model.timeslot_info['end_hour']):
            global_blocked.add(t)
    for s in blocked_rooms.values():
        s.update(global_blocked)
    for s in blocked_people.values():
        s.update(global_blocked)
    legal_slots = {t for t in range(model.no_timeslots) if t not in global_blocked}
    return blocked_rooms, blocked_people, legal_slots


def compute_utilization(model):
    """Compute availability and busy hours per room and evaluator."""
    blocked_rooms, blocked_people, legal_slots = _blocked_sets(model)

    # Busy counts
    room_busy = {r: 0 for r in range(len(model.rooms))}
    people_busy = {name: 0 for name in blocked_people.keys()}

    df_def = model.df_def
    evaluator_cols = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']

    # Ensure all evaluators from the data are represented even if no unavailability is listed (meaning fully available)
    for col in evaluator_cols:
        for name in df_def[col].dropna().astype(str).str.strip():
            if name == '':
                continue
            blocked_people.setdefault(name, set())
            people_busy.setdefault(name, 0)

    for d in range(model.no_defenses):
        if not model.is_planned[d].value():
            continue
        start_val = model.start_times[d].value()
        room_val = model.in_room[d].value()
        if start_val is None or room_val is None:
            continue
        t = int(start_val)
        r = int(room_val)
        room_busy[r] = room_busy.get(r, 0) + 1

        row = df_def.loc[d]
        for col in evaluator_cols:
            name = row.get(col)
            if pd.notna(name) and str(name).strip() != '':
                people_busy[name] = people_busy.get(name, 0) + 1

    # Availability counts (only legal slots)
    room_util = []
    for r in range(len(model.rooms)):
        legal_avail = legal_slots - blocked_rooms.get(r, set())
        available = len(legal_avail)
        busy = room_busy.get(r, 0)
        util = busy / available if available else 0
        room_util.append({
            "resource": model.rooms[r],
            "type": "room",
            "available_hours": available,
            "busy_hours": busy,
            "utilization": util
        })

    people_util = []
    for person, blocked in blocked_people.items():
        legal_avail = legal_slots - blocked
        available = len(legal_avail)
        busy = people_busy.get(person, 0)
        util = busy / available if available else 0
        people_util.append({
            "resource": person,
            "type": "person",
            "available_hours": available,
            "busy_hours": busy,
            "utilization": util
        })

    return {"rooms": room_util, "people": people_util}


def compute_capacity_gaps(model):
    """Return evaluators whose defenses exceed their legal-slot availability."""
    blocked_rooms, blocked_people, legal_slots = _blocked_sets(model)
    evaluator_cols = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']

    need = Counter()
    for col in evaluator_cols:
        for name in model.df_def[col].dropna().astype(str).str.strip():
            if name and name.lower() != 'nan':
                need[name] += 1

    first_day = datetime.datetime.strptime(model.timeslot_info["first_day"], "%Y-%m-%d")

    def slot_to_str(t):
        ts = first_day + datetime.timedelta(hours=int(t))
        return ts.strftime("%a %Y-%m-%d %H:00")

    gaps = []
    for name, required in need.most_common():
        blocked = blocked_people.get(name, set())
        legal_avail = legal_slots - blocked
        available = len(legal_avail)
        if available < required:
            free_slots = sorted(list(legal_avail))
            gaps.append({
                "resource": name,
                "type": "person",
                "defenses_needed": int(required),
                "available_slots": int(available),
                "deficit": int(required - available),
                "free_slots": free_slots,
                "free_slots_human": [slot_to_str(s) for s in free_slots]
            })

    return gaps


def compute_slack(model):
    """Compute minimal slack to next unavailability/illegal slot for each scheduled defense."""
    blocked_rooms, blocked_people, _ = _blocked_sets(model)
    df_def = model.df_def
    evaluator_cols = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']

    def next_blocked(blocked, start, horizon):
        end = start + 1
        future = [b for b in blocked if b >= end]
        if not future:
            return horizon
        return min(future)

    slack_rows = []
    for d in range(model.no_defenses):
        if not model.is_planned[d].value():
            continue
        start_val = model.start_times[d].value()
        room_val = model.in_room[d].value()
        if start_val is None or room_val is None:
            continue
        t = int(start_val)
        r = int(room_val)
        row = df_def.loc[d]

        resources = []
        resources.append(("room", model.rooms[r], blocked_rooms.get(r, set())))
        for col in evaluator_cols:
            name = row.get(col)
            if pd.notna(name) and str(name).strip() != '':
                resources.append(("person", name, blocked_people.get(name, set())))

        end = t + 1
        min_slack = model.no_timeslots - end
        details = []
        for r_type, r_name, blocked in resources:
            nb = next_blocked(blocked, t, model.no_timeslots)
            slack_val = nb - end
            min_slack = min(min_slack, slack_val)
            details.append({
                "resource": r_name,
                "type": r_type,
                "slack_hours": slack_val
            })

        slack_rows.append({
            "defense_id": int(d),
            "student": row["student"],
            "start_slot": t,
            "min_slack_hours": min_slack,
            "by_resource": details
        })

    return slack_rows


def compute_bottleneck_analysis(model):
    """Analyze capacity bottlenecks when must_plan_all causes UNSAT.

    Returns slots with demand > capacity and evaluators near saturation.
    """
    blocked_rooms, blocked_people, legal_slots = _blocked_sets(model)
    df_def = model.df_def
    evaluator_cols = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']

    # Count demand per slot
    slot_demand = {}
    defense_slots = {}

    for idx, row in df_def.iterrows():
        evaluators = [row.get(col) for col in evaluator_cols
                     if pd.notna(row.get(col)) and str(row.get(col)).strip() != '']

        possible = []
        for t in legal_slots:
            can_schedule = all(
                ev not in blocked_people or t not in blocked_people[ev]
                for ev in evaluators if ev
            )
            if can_schedule:
                possible.append(t)

        defense_slots[idx] = possible
        for t in possible:
            slot_demand[t] = slot_demand.get(t, 0) + 1

    # Find bottleneck slots (demand > room capacity)
    bottleneck_slots = []
    for t in sorted(slot_demand.keys(), key=lambda x: slot_demand[x], reverse=True):
        demand = slot_demand[t]
        capacity = model.max_rooms
        if demand > capacity or demand >= model.no_defenses * 0.3:  # High utilization threshold
            day = t // 24
            hour = t % 24
            bottleneck_slots.append({
                "slot": int(t),
                "day": int(day),
                "hour": int(hour),
                "demand": int(demand),
                "capacity": int(capacity),
                "pressure": round(demand / capacity, 2)
            })

    # Find defenses with fewest slot options
    constrained_defenses = []
    for idx, possible in defense_slots.items():
        if len(possible) <= 5:  # Fewer than 5 possible slots
            row = df_def.loc[idx]
            constrained_defenses.append({
                "defense_id": int(idx),
                "student": row["student"],
                "supervisor": row["supervisor"],
                "possible_slots": len(possible),
                "slots": sorted(possible)
            })

    constrained_defenses.sort(key=lambda x: x["possible_slots"])

    return {
        "bottleneck_slots": bottleneck_slots[:15],
        "constrained_defenses": constrained_defenses[:20]
    }


def compute_blocking_reasons(model):
    """Report blocking resources for unscheduled defenses.

    After solving, includes all defenses where is_planned[d] is False.
    Defenses with zero feasible slots get full blocking_resources detail.
    Defenses with some feasible slots (unscheduled due to capacity) get
    empty blocking_resources to indicate they are schedulable in principle.
    """
    blocked_rooms, blocked_people, legal_slots = _blocked_sets(model)
    df_def = model.df_def
    evaluator_cols = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']

    # Pre-compute room pool blocked union (same for all defenses)
    room_blocked_union = set()
    for r in range(len(model.rooms)):
        room_blocked_union |= blocked_rooms.get(r, set())

    # Determine which defenses are unplanned (after solving)
    has_solution = False
    try:
        val = model.is_planned[0].value() if hasattr(model.is_planned[0], 'value') else None
        has_solution = val is not None
    except Exception:
        pass

    results = []
    for d in range(model.no_defenses):
        # If model has been solved, only report on unplanned defenses
        if has_solution:
            planned_val = model.is_planned[d].value() if hasattr(model.is_planned[d], 'value') else None
            if planned_val is not None and bool(planned_val):
                continue

        row = df_def.loc[d]

        # Get evaluators for this defense
        evaluators = []
        for col in evaluator_cols:
            name = row.get(col)
            if pd.notna(name) and str(name).strip() != '':
                evaluators.append(name)

        # Check if defense has ANY feasible slot
        blocked_union = set(room_blocked_union)
        for ev in evaluators:
            if ev in blocked_people:
                blocked_union |= blocked_people[ev]

        feasible = legal_slots - blocked_union

        if not feasible:
            # Fully blocked: report all blocking resources
            blocking = []
            legal_blocked = lambda slots: sorted([t for t in slots if t in legal_slots])

            if room_blocked_union:
                blocking.append({
                    "resource": "all_rooms",
                    "type": "room_pool",
                    "blocked_slots": legal_blocked(room_blocked_union)
                })

            for r in range(len(model.rooms)):
                blk = blocked_rooms.get(r, set())
                if blk:
                    blocking.append({
                        "resource": model.rooms[r],
                        "type": "room",
                        "blocked_slots": legal_blocked(blk)
                    })

            for ev in evaluators:
                if ev in blocked_people:
                    blocking.append({
                        "resource": ev,
                        "type": "person",
                        "blocked_slots": legal_blocked(blocked_people[ev])
                    })

            results.append({
                "defense_id": int(d),
                "student": row["student"],
                "blocking_resources": blocking
            })
        elif has_solution:
            # Unplanned but has feasible slots: capacity-limited, not constraint-blocked
            results.append({
                "defense_id": int(d),
                "student": row["student"],
                "blocking_resources": []
            })
    return results


def aggregate_relax_candidates(blocking, top_k=None, top_k_per_type=None):
    """
    Aggregate blocking info into candidate relaxations.
    Returns list of {resource, type, slot, count} sorted by count desc.
    If top_k and top_k_per_type are None, return the full list.
    Otherwise take top_k overall plus top_k_per_type per resource type.
    """
    counter = {}
    for item in blocking:
        for res in item.get("blocking_resources", []):
            r = res["resource"]
            r_type = res["type"]
            for t in res.get("blocked_slots", []):
                key = (r_type, r, t)
                counter[key] = counter.get(key, 0) + 1
    candidates = []
    for (r_type, r, t), count in counter.items():
        candidates.append({
            "resource": r,
            "type": r_type,
            "slot": int(t),
            "blocked_count": count
        })
    candidates.sort(key=lambda x: x["blocked_count"], reverse=True)
    if top_k is None and top_k_per_type is None:
        return candidates

    top_overall = candidates[:top_k] if top_k else []

    top_by_type = []
    if top_k_per_type:
        by_type = {}
        for c in candidates:
            by_type.setdefault(c["type"], []).append(c)
        for type_cands in by_type.values():
            top_by_type.extend(type_cands[:top_k_per_type])

    # deduplicate while preserving order
    seen = set()
    merged = []
    for c in top_overall + top_by_type:
        key = (c["resource"], c["type"], c["slot"])
        if key in seen:
            continue
        seen.add(key)
        merged.append(c)
    return merged


def find_single_relaxations(model, cfg, assumption_literals, max_relaxations=5):
    """Try relaxing one assumption at a time to see if the model becomes SAT."""
    relaxations = []
    if not assumption_literals:
        return relaxations

    for a in assumption_literals:
        ass = [lit for lit in assumption_literals if lit is not a]
        if model.solve(solver=cfg['solver'], log_search_progress=False, assumptions=ass):
            planned = sum(int(bool(model.is_planned[d].value())) for d in range(model.no_defenses))
            adj = None
            if cfg.get("adjacency_objective") and hasattr(model, "adj_obj"):
                adj = int(model.adj_obj.value())
            relaxations.append({
                "dropped_assumption": getattr(model, "assumption_labels", {}).get(a, str(a)),
                "planned_defenses": planned,
                "adjacency_score": adj
            })
            if len(relaxations) >= max_relaxations:
                break
    return relaxations


def save_summary(model, cfg, output_folder, solve_status, solve_time=None):
    summary = {
        "status": "SAT" if solve_status else "UNSAT",
        "total_defenses": int(model.no_defenses),
        "planned_defenses": int(sum(int(bool(model.is_planned[d].value())) for d in range(model.no_defenses))) if solve_status else 0,
        "adjacency_score": int(model.adj_obj.value()) if solve_status and cfg.get("adjacency_objective") and hasattr(model, "adj_obj") else None,
        "adjacency_possible": int(model.adj_obj_ub) if cfg.get("adjacency_objective") and hasattr(model, "adj_obj_ub") else None,
        "solve_time_sec": solve_time
    }
    with open(f"{output_folder}/summary.json", "w") as f:
        json.dump(summary, f, indent=2)


def save_cores_from_literals(core_literals, assumption_labels, fallback_labels, output_folder):
    """Export cores given a list of core literals or fallback labels."""
    cores_out = []
    if core_literals:
        labels = [assumption_labels.get(lit, str(lit)) for lit in core_literals]
        cores_out.append(sorted(set(labels)))
    else:
        cores_out.append(sorted(fallback_labels))

    with open(f"{output_folder}/cores.json", "w") as f:
        json.dump({"cores": cores_out}, f, indent=2)


def objective_csv(model, output_folder):
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



if __name__ == "__main__":
    cfg = get_settings()

    model = DefenseRosteringModel(cfg)

    # Use configured output directory
    output_base = cfg.get('output_dir', 'data/output')
    output_folder, run_id = create_run_folder(base=output_base)

    if not cfg.get("no_plots", True) and os.environ.get("NO_PLOTS") != "1":
        empty_timetable(model)
        gantt_chart_room_perspective(model, cfg, empty=True)
        gantt_chart_evaluator_perspective(model, cfg, empty=True)


    start_solve = time.time()
    assumptions = model.assumption_literals if cfg.get("explain", False) else None
    if model.solve(solver=cfg['solver'], log_search_progress=True, assumptions=assumptions):
        end_solve = time.time()
        print('Solving time: ', end_solve - start_solve)
        if not cfg.get("no_plots", False) and os.environ.get("NO_PLOTS") != "1":
            gantt_chart_room_perspective(model, cfg, empty=False)
            gantt_chart_evaluator_perspective(model, cfg, empty=False)

        #unused_timeslots_csv(model, output_folder)
        objective_csv(model, output_folder)
        unused_timeslots_csv(model, output_folder)
        output_csv(model, output_folder)

        # Additional exports for dashboard
        save_summary(model, cfg, output_folder, True, solve_time=end_solve - start_solve)
        util = compute_utilization(model)
        with open(f"{output_folder}/utilization.json", "w") as f:
            json.dump(util, f, indent=2)
        gaps = compute_capacity_gaps(model)
        with open(f"{output_folder}/capacity_gaps.json", "w") as f:
            json.dump(gaps, f, indent=2)
        slack = compute_slack(model)
        with open(f"{output_folder}/slack.json", "w") as f:
            json.dump(slack, f, indent=2)
    else:
        print("Model is unsatisfiable")
        save_summary(model, cfg, output_folder, False, solve_time=time.time() - start_solve)
        if cfg.get("explain", False):
            # Fast heuristic core: extract unique constraint labels (skip expensive MUS)
            print("Extracting constraint groups from UNSAT core...")
            unique_labels = sorted(set(lbl for (_, lbl) in model.constraint_labels))
            print(f"Core constraint groups: {unique_labels}")

            with open(f"{output_folder}/cores.json", "w") as f:
                json.dump({"cores": [unique_labels]}, f, indent=2)

            # Bottleneck analysis (for capacity-based UNSAT)
            print("Analyzing capacity bottlenecks...")
            bottlenecks = compute_bottleneck_analysis(model)
            with open(f"{output_folder}/bottlenecks.json", "w") as f:
                json.dump(bottlenecks, f, indent=2)

            # Blocking analysis (for defenses with zero feasible slots)
            blocking = compute_blocking_reasons(model)
            with open(f"{output_folder}/blocking.json", "w") as f:
                json.dump(blocking, f, indent=2)

            # Generate relax candidates: prioritize blocking-based, add capacity-based
            candidates = []

            if blocking:
                # Blocking-based relaxations (free specific resource/slot combinations)
                candidates.extend(aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=10))

            # Always add capacity-based suggestions for must_plan_all scenarios
            if cfg.get("must_plan_all_defenses", True):
                constrained = bottlenecks.get("constrained_defenses", [])

                # Build map of all defenses by flexibility (for choosing drop candidates from unconstrained pool)
                # Reuse the blocked_sets from earlier analysis
                blocked_rooms, blocked_people, legal_slots = _blocked_sets(model)
                all_defense_flexibility = {}
                evaluator_cols = ['supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']
                for idx, row in model.df_def.iterrows():
                    evaluators = [row.get(col) for col in evaluator_cols
                                 if pd.notna(row.get(col)) and str(row.get(col)).strip() != '']
                    possible_count = 0
                    for t in legal_slots:
                        blocked_by_room = any(t in blocked_rooms.get(r, set()) for r in range(len(model.rooms)))
                        if blocked_by_room:
                            continue
                        can_schedule = all(
                            ev not in blocked_people or t not in blocked_people[ev]
                            for ev in evaluators if ev
                        )
                        if can_schedule:
                            possible_count += 1
                    all_defense_flexibility[idx] = possible_count

                # Identify constrained defense IDs
                constrained_ids = {d["defense_id"] for d in constrained} if constrained else set()

                # Get unconstrained defenses (those not in bottleneck list)
                unconstrained = [
                    {"defense_id": idx, "student": model.df_def.loc[idx]["student"],
                     "supervisor": model.df_def.loc[idx]["supervisor"], "possible_slots": slots}
                    for idx, slots in all_defense_flexibility.items()
                    if idx not in constrained_ids and slots > 1
                ]
                unconstrained.sort(key=lambda x: x["possible_slots"], reverse=True)

                # Strategy: suggest dropping HIGH-flexibility defenses (easier to reschedule)
                for defense in unconstrained[:10]:
                    candidates.append({
                        "action": "drop_defense",
                        "defense_id": defense["defense_id"],
                        "student": defense["student"],
                        "supervisor": defense["supervisor"],
                        "possible_slots": defense["possible_slots"],
                        "flexibility": "high" if defense["possible_slots"] > 20 else "medium",
                        "impact": f"Easiest to reschedule ({defense['possible_slots']} slot options)"
                    })

                # Highlight the most critically constrained defenses (awareness only)
                if constrained:
                    for defense in constrained[:5]:
                        candidates.append({
                            "action": "review_constraints",
                            "defense_id": defense["defense_id"],
                            "student": defense["student"],
                            "supervisor": defense["supervisor"],
                            "possible_slots": defense["possible_slots"],
                            "flexibility": "critical",
                            "impact": f"Only {defense['possible_slots']} slot(s) available - cannot drop without availability changes"
                        })

            with open(f"{output_folder}/relax_candidates.json", "w") as f:
                json.dump(candidates, f, indent=2)

            gaps = compute_capacity_gaps(model)
            with open(f"{output_folder}/capacity_gaps.json", "w") as f:
                json.dump(gaps, f, indent=2)
        else:
            for c in mus(model.constraints):
                print(c)
                print('___________')





    
# Problems:
# Some people (e.g. Dirk Speelman) are always unavailable, leading to unsatisfiability being inevitable
# Sometimes different names are used for (what I assume to be) the same person (e.g. Fred Truyen and Frederik Truyen)

# To do:
# - simulate input_data_original (e.g. room availabilities) (V)
# - add room availabilities (V)
# - add adjacency objective (V)
# - add online option (+ simulate input_data_original for this)
# - room preferences, room distance
# -
# - visualize from evaluator view 
# - room /evaluator view

# Meeting Robin 21/11:
# Possible legal timeslots added to output.csv (V)
# Add objectives to objectives.csv (V)



# Start: front end, input input_data_original is selected, start & end hours, exclude weekends, objectives are chosen
# Solving
# Return to front end: output input_data_original, the objectives + objective values

# For every evaluator, we know in which building their office is
# For every room, we know if it is near that building


# 2021, nrows=60, nrooms=5, solver=ortools, timeslot constraints as Cumulative, correct: 144.13697576522827
# 2021, nrows=60, nrooms=5, solver=ortools, timeslot constraints as separate constraints: 66.79028034210205
# 2021, nrows=60, nrooms=5, solver=ortools, both as Cumulative and separate: 51.33789658546448


# 2021, nrows=60, nrooms=5, solver=z3, both as Cumulative and separate: timeout

# 2021, nrows=60, nrooms=5, solver=exact, both as Cumulative and separate: 23.677228927612305
# 2021, nrows=60, nrooms=5, solver=exact, Cumulative: 18.88290810585022
# 2021, nrows=60, nrooms=5, solver=exact, separate: 20.570964813232422


# Without adjacency objective: exact > ortools
# With adjacency objective: ortools > exact

# Gurobi and Z3 are relatively inefficient



# Ideas:
# - find ways to split the problem and merge later, since problem quickly becomes untractable with adjacency objectives
# - ideally find different way to represent adjacency objectives

# Done
#  - Constraints (almost all) converted to Cumulative
#  - Room availability simulated + constraints added
#  - Two students with same topic: modelled as a two-hour defense
#  - Adjacency objectives (works, but still inefficient) (UB only slightly improves it)
#  - Online option (still has a bug)
#  - Compare efficiency, most important findings
#    - without adjacency objective: Exact
#    - with adjacency objective: OR-Tools -> because of cp.abs (?)
#    - use of Cumulative constraints improves efficiency
#  - Cleaned up code, allow easier parameter selection, Gantt chart generation much more efficient
#  - More output files, discussed what is needed



# Niet gepland -> waarom niet? en correction: wanneer wel?, relaxation: droppen, of inplannen met één vd juryleden weg
# Droppen: kan niet gepland worden
# Base model: single objective
#  - Oplossing of geen oplossing
# Multi-objective


# Base probleem: deze defences, met deze beschikbaarheid is deze room$



# Simuleren, bv. één room, bv. geen beschikbaarheden


# Slides voor elke meeting, meer structuur
