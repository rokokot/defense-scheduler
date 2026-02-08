import colorsys
import datetime
import itertools
import json
import math
import random

import cpmpy as cp
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import csv
import argparse
import yaml
import numpy as np

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
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_SETTINGS = {
    # General
    "input_data": 'june-2021',

    # Input data limits
    "number_of_defenses_in_problem": "all",
    "number_of_unavailabilities_in_problem": "all",

    # Solving / model
    "solver": 'ortools',
    "model": 'scheduling',

    # Use-case options
    "adjacency_objective": False,
    "must_plan_all_defenses": False,
    "allow_online_defenses": False,
    "first_hour": 9,
    "last_hour": 17,
    "availability_odds": 0.75,
    "online_odds": 0.75,
    "max_rooms": None,
    "max_days": None,

    # Randomness
    "random_sample": False,
    "random_seed": 0,
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
    p.add_argument("--number-of-defenses-in-problem", type=str)
    p.add_argument("--number-of-unavailabilities-in-problem", type=str)

    # Regarding the solving method
    p.add_argument("--solver")
    p.add_argument("--model", type=str)

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

    # Randomness / sampling
    p.add_argument("--random-sample", type=str,
                   help="true/false: randomly sample rows instead of taking first n")
    p.add_argument("--random-seed", type=int,
                   help="Random seed for reproducibility")

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
            "allow_online_defenses",
            "random_sample",
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
    def __init__(self, cfg):

        #rewrite_availabilities(availabilities, cfg)

        #rewrite_defenses(defenses, cfg)

        if cfg['number_of_unavailabilities_in_problem'] != 'all':
            df = pd.read_csv(f'input_data/{cfg['input_data']}/unavailabilities.csv')

            if cfg['random_sample']:
                self.df_av = df.sample(
                    n=cfg['number_of_unavailabilities_in_problem'],
                    random_state=cfg['random_seed']
                )
            else:
                self.df_av = df.head(cfg['number_of_unavailabilities_in_problem'])
            self.df_av = self.df_av.reset_index(drop=True)
        else:
            self.df_av = pd.read_csv(f'input_data/{cfg['input_data']}/unavailabilities.csv')
        if cfg['number_of_defenses_in_problem'] != 'all':
            df = pd.read_csv(f'input_data/{cfg['input_data']}/defences.csv')

            if cfg['random_sample']:
                self.df_def = df.sample(
                    n=cfg['number_of_defenses_in_problem'],
                    random_state=cfg['random_seed']
                )
            else:
                self.df_def = df.head(cfg['number_of_defenses_in_problem'])
            self.df_def = self.df_def.reset_index(drop=True)
        else:
            self.df_def = pd.read_csv(f'input_data/{cfg['input_data']}/defences.csv')

        with open(f'input_data/{cfg['input_data']}/timeslot_info.json') as f:
            self.timeslot_info = json.load(f)


        with open(f'input_data/{cfg['input_data']}/rooms.json') as f:
            data = json.load(f)

        if cfg['max_rooms'] is not None:
            self.max_rooms = cfg['max_rooms']
        else:
            self.max_rooms = len(data["rooms"])


        self.rooms = data["rooms"][:self.max_rooms]

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

        self.df_def['defense_id'] = pd.factorize(self.df_def['student'])[0]

        #self.df_rav['rid'] = pd.factorize(self.df_rav['room_id'])[0]

        mask = self.df_av['type'] == 'room'


        self.df_av['room_id'] = pd.NA

        self.df_av.loc[mask, 'room_id'] = pd.factorize(self.df_av.loc[mask, 'name'])[0]

        if not isinstance(cfg["max_days"], int):
            self.no_days = self.timeslot_info['number_of_days']
        else:
            self.no_days = cfg['max_days']

        self.no_timeslots = 24*self.no_days
        self.no_defenses = self.df_def['defense_id'].max()+1


        self.constraints = []

        if cfg['model'] == 'allocation_intvar':
            self.start_times = cp.intvar(lb=0, ub=self.no_timeslots - 1, shape=self.no_defenses, name='start_times')
            self.in_room = cp.intvar(lb=0, ub=self.max_rooms - 1, shape=self.no_defenses,
                                     name='in_room')
            self.add(self.evaluator_availability_constraints_allocation())
            self.add(self.evaluator_overlap_constraints_allocation())

            self.add(self.room_availability_constraints_allocation())
            self.add(self.room_overlap_constraints_allocation())

            self.add(self.timeslot_constraints_allocation())
            if cfg['adjacency_objective']:
                self.adj_obj, self.adj_obj_ub = self.adjacency_objective_allocation()
                #print("Upper bound: ", self.adj_obj_ub)
                if isinstance(self.adj_obj, int):
                    self.dummy = cp.intvar(lb=0, ub=1)
                    self.add([self.dummy == 1])
                    self.maximize(self.dummy)
                else:
                    self.maximize(self.adj_obj)
            else:
                self.dummy = cp.intvar(lb=0, ub=1)
                self.add([self.dummy == 1])
                self.maximize(self.dummy)
        elif cfg['model'] == 'allocation_boolvar':
            self.planned = cp.boolvar(shape=(self.no_defenses, self.max_rooms, self.no_timeslots))
            self.add(self.evaluator_availability_constraints_allocation2())

            self.add(self.evaluator_overlap_constraints_allocation2())

            self.add(self.room_availability_constraints_allocation2())
            self.add(self.room_overlap_constraints_allocation2())

            self.add(self.timeslot_constraints_allocation2())

            self.add(self.consistency_constraints_allocation2(relaxed=not cfg['must_plan_all_defenses']))
            if cfg['adjacency_objective']:
                self.adj_obj, self.adj_obj_ub = self.adjacency_objective_allocation2()
                #print("Upper bound: ", self.adj_obj_ub)
                if cfg['must_plan_all_defenses']:
                    if isinstance(self.adj_obj, int):
                        self.dummy = cp.intvar(lb=0, ub=1)
                        self.add([self.dummy == 1])
                        self.maximize(self.dummy)
                    else:
                        self.maximize(self.adj_obj)
                else:
                    self.defenses_obj = cp.sum(cp.any(self.planned[d, :, :]) for d in range(self.no_defenses))
                    self.maximize((self.adj_obj_ub+1)*self.defenses_obj + self.adj_obj)
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

        #self.defenses_obj = cp.NValue(self.in_room)
        #self.minimize(cp.sum(~cp.AllEqual(self.start_times[:,r]) for r in range(self.max_rooms)))

        # Maximize the number of assigned defenses
        #self.maximize(cp.sum(cp.any(self.in_room[d,:]) for d in range(self.no_defenses)) - adjacency_obj)

        # Adjacency objective test
            if cfg['adjacency_objective']:
                if cfg['must_plan_all_defenses']:
                    self.add([cp.all(self.is_planned)])
                    self.adj_obj, self.no_pairs, self.adj_obj_ub = self.adjacency_objectives()
                    #self.add([self.adj_obj <= self.adj_obj_ub])

                    if isinstance(self.adj_obj, int):
                        self.dummy = cp.intvar(lb=0, ub=1)
                        self.add([self.dummy == 1])
                        self.maximize(self.dummy)
                    else:
                        self.maximize(self.adj_obj)
                else:
                    self.defenses_obj = cp.sum(self.is_planned)
                    self.adj_obj, self.no_pairs, self.adj_obj_ub = self.adjacency_objectives()
                    #self.add([self.adj_obj <= self.adj_obj_ub])

                    self.maximize((self.adj_obj_ub+1)*self.defenses_obj + self.adj_obj)
            else:
                if cfg['must_plan_all_defenses']:
                    self.add([cp.all(self.is_planned)])

                    self.dummy = cp.intvar(lb=0, ub=1)
                    self.add([self.dummy == 1])
                    self.maximize(self.dummy)
                else:
                    self.defenses_obj = cp.sum(self.is_planned)
                    self.maximize(self.defenses_obj)








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
                    for t in range(av['start_id'], av['end_id']):
                        constraints += [self.start_times[defenses] != t]
        return constraints


    def evaluator_availability_constraints_allocation2(self):
        constraints = []
        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            for idx, av in self.df_av.iterrows():
                if av['name'] == evaluator and av['type'] == 'person':
                    for t in range(av['start_id'], av['end_id']):
                        constraints += [~self.planned[defenses, :, t]]
        return constraints



    def evaluator_overlap_constraints_allocation(self):
        constraints = []

        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            constraints += [cp.AllDifferent(self.start_times[defenses])]

        return constraints

    def evaluator_overlap_constraints_allocation2(self):
        constraints = []

        for evaluator in self.evaluator_list:
            defenses = self.df_evaluators.index[self.df_evaluators['evaluators'] == evaluator].unique().tolist()
            for t in range(self.no_timeslots):
                constraints += [cp.sum(self.planned[defenses, :, t]) <= 1]

        return constraints


    def room_availability_constraints_allocation(self):
        constraints = []
        for r in range(self.max_rooms):
            for idx, av in self.df_av.iterrows():
                if av['type'] == 'room' and av['room_id'] == r:
                    for t in range(av['start_id'], av['end_id']):
                        constraints += [(self.in_room == r).implies(self.start_times != t)]
        return constraints

    def room_availability_constraints_allocation2(self):
        constraints = []
        for r in range(self.max_rooms):
            for idx, av in self.df_av.iterrows():
                if av['type'] == 'room' and av['room_id'] == r:
                    for t in range(av['start_id'], av['end_id']):
                        constraints += [~self.planned[:, r, t]]
        return constraints

    def room_overlap_constraints_allocation(self):
        constraints = []

        for d1, d2 in itertools.combinations(list(range(self.no_defenses)), 2):
            constraints += [(self.in_room[d1] == self.in_room[d2]).implies(self.start_times[d1] != self.start_times[d2])]

        return constraints

    def room_overlap_constraints_allocation2(self):
        constraints = []

        for r in range(self.max_rooms):
            for t in range(self.no_timeslots):
                constraints += [cp.sum(self.planned[:, r, t]) <= 1]

        return constraints

    def timeslot_constraints_allocation(self):
        constraints = []
        for t in range(self.no_timeslots):
            if timeslot_illegal(t, self.timeslot_info['start_hour'], self.timeslot_info['end_hour']):
                constraints += [self.start_times != t]
        return constraints

    def timeslot_constraints_allocation2(self):
        constraints = []
        for t in range(self.no_timeslots):
            if timeslot_illegal(t, self.timeslot_info['start_hour'], self.timeslot_info['end_hour']):
                constraints += [~self.planned[:,:,t]]
        return constraints


    def consistency_constraints_allocation2(self, relaxed=False):
        constraints = []
        if relaxed:
            for d in range(self.no_defenses):
                constraints += [cp.sum(self.planned[d, :, :]) <= 1]
        else:
            for d in range(self.no_defenses):
                constraints += [cp.sum(self.planned[d, :, :]) == 1]
        return constraints



    def adjacency_objective_allocation(self):
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
                time_objective_ub -= (1/2)*(d**2) - (3/2)*d + 1  # amount of defense pairs that cannot be planned consecutively
            else:
                # time_objective_ub -= (1 / 2) * (d ** 2) - (3 / 2) * d + 1
                time_objective_ub -= ((1/2)*(d**2) - (1/2)*d - self.timeslot_info['end_hour'] + self.timeslot_info['start_hour'] + 1)
            for d1 in defenses:
                for d2 in defenses:
                    if d1 != d2:
                        adjacency_objective += (((self.start_times[d1] - self.start_times[d2]) == 1) & (self.in_room[d1] == self.in_room[d2]))
                        pairs_count += 1

        pairs_count //= 2

        time_objective_ub += pairs_count
        time_objective_ub = int(time_objective_ub)
        return adjacency_objective, time_objective_ub



    def adjacency_objective_allocation2(self):
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
                time_objective_ub -= (1/2)*(d**2) - (3/2)*d + 1  # amount of defense pairs that cannot be planned consecutively
            else:
                # time_objective_ub -= (1 / 2) * (d ** 2) - (3 / 2) * d + 1
                time_objective_ub -= ((1/2)*(d**2) - (1/2)*d - self.timeslot_info['end_hour'] + self.timeslot_info['start_hour'] + 1)
            for d1 in defenses:
                for d2 in defenses:
                    if d1 != d2:
                        for t in range(1, self.no_timeslots):
                            adjacency_objective += (cp.any(self.planned[d1, :, t-1]) & cp.all(self.planned[d1, :, t-1] == self.planned[d2, :, t]))
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

            '''group_constraint = 0
            for d1, d2 in itertools.combinations(defenses, 2):
                adjacency_objective += ((cp.abs(self.start_times[d1] - self.start_times[d2]) == 1) & (cp.all(self.in_room[d1,:] == self.in_room[d2,:])))
                #adjacency_objective += ((((self.start_times[d1] - self.start_times[d2]) == 1) | ((self.start_times[d2] - self.start_times[d1]) == 1))
                #                        & (cp.all(self.in_room[d1,:] == self.in_room[d2,:]))) # Geen absolute value + algemene duration
                group_constraint += cp.abs(self.start_times[d1] - self.start_times[d2]) == 1 # Toevoegen aan time objective
                #room_objective += cp.all(self.in_room[d1,:] == self.in_room[d2,:]) # Proberen één constraint van te maken
                pairs_count += 1
            self.add([group_constraint <= d-1])'''

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
                for r in range(model.max_rooms):
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




def gantt_chart_room_perspective(model, cfg, empty, res=None):
    rows = []
    if not empty:
        for d in range(model.no_defenses):
            if res['is_planned'][d]:
                for r in range(model.max_rooms):
                    if res['in_room'][d] == r:
                        st = res['start_times'][d]
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

    unavailable_intervals = get_unavailable_intervals(model, cfg, f'input_data/{cfg["input_data"]}/unavailabilities.csv',
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
        title = f"Defense Schedule Gantt Chart: {model.defenses_obj.value()} out of {model.no_defenses} defenses planned."
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




def gantt_chart_evaluator_perspective(model, cfg, empty, res=None):

    rows = []
    if not empty:
        for d in range(model.no_defenses):
            if res['is_planned'][d]:
                st = res['start_times'][d]
                if st is not None:
                    info = model.df_def.loc[d]
                    en = st + 1


                    room_id = None
                    for r in range(model.max_rooms):
                        if res['in_room'][d] == r:
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
    unavailable_intervals = get_unavailable_intervals(model, cfg, f'input_data/{cfg['input_data']}/unavailabilities.csv',
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
    for r in range(model.max_rooms):
        room = model.rooms[r]
        # Use the modulo operator (%) to cycle through the color_sequence if there are more IDs than colors
        color_map[room] = color_sequence[r % len(color_sequence)]

    title = None
    if empty:
        title = f"Initial evaluator view"
    elif cfg['adjacency_objective']:
        title = f"Defense Schedule Gantt Chart - {model.adj_obj.value()} out of {model.adj_obj_ub} adjacent pairs"
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
    #print(f"Run ID: {run_id}")
    return folder_path, run_id

def output_csv(model, res, output_folder):
    df = model.df_def
    df.drop(["person", "evaluators"], axis=1, inplace=True)

    for d in range(model.no_defenses):
        for r in range(model.max_rooms+1):
            if res['is_planned'][d] and res['in_room'][d] == r:
                t = res['start_times'][d]
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


if __name__ == "__main__":
    cfg = get_settings()

    model = DefenseRosteringModel(cfg)

    #empty_timetable(model)
    #gantt_chart_room_perspective(model, cfg, empty=True)
    #gantt_chart_evaluator_perspective(model, cfg, empty=True)


    start_solve = time.time()
    if cfg['solver'] == 'ortools':
        if model.solve(solver='ortools', num_workers=1, use_lns=False): # for experiments, num_workers = 1, use_lns = False
            end_solve = time.time()
            #print("Objective: ", model.objective_value())
            print('Solve time: ', end_solve - start_solve, flush=True)
            res = convert_result(model)
            #gantt_chart_room_perspective(model, cfg, empty=False, res=res)
            #gantt_chart_evaluator_perspective(model, cfg, empty=False, res=res)

            output_folder, run_id = create_run_folder()
            #objective_csv(model, res, output_folder)
            unused_timeslots_csv(model, res, output_folder)
            output_csv(model, res, output_folder)
        else:
            end_solve = time.time()
            print('UNSAT time: ', end_solve - start_solve, flush=True)
            #print('unsat')
            #print(mus(soft=[model.is_planned[i] for i in range(len(model.is_planned))]))
    else:
        if model.solve(solver=cfg['solver']):
            end_solve = time.time()
            #print("Objective: ", model.objective_value())
            print('Solve time: ', end_solve - start_solve, flush=True)
            res = convert_result(model)
            #gantt_chart_room_perspective(model, cfg, empty=False, res=res)
            #gantt_chart_evaluator_perspective(model, cfg, empty=False, res=res)

            output_folder, run_id = create_run_folder()
            unused_timeslots_csv(model, res, output_folder)
            #objective_csv(model, res, output_folder)
            unused_timeslots_csv(model, res, output_folder)
            output_csv(model, res, output_folder)
        else:
            end_solve = time.time()
            print('UNSAT time: ', end_solve - start_solve, flush=True)






    
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

