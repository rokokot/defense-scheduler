import csv
import datetime
import json
import random
import numpy as np

import pandas as pd

def merge_availability_blocks(df):
    # Ensure datetime format
    df['start_time'] = pd.to_datetime(df['start_time'])
    df['day'] = pd.to_datetime(df['day'])

    # Sort properly
    df = df.sort_values(['name', 'day', 'start_time']).reset_index(drop=True)

    # Identify merging groups
    df['group'] = (
        (df['name'] != df['name'].shift()) |
        (df['day'] != df['day'].shift()) |
        (df['status'] != df['status'].shift()) |
        (df['start_time'] != df['start_time'].shift() + pd.Timedelta(hours=1))
    ).cumsum()

    # Other preserved columns
    other_cols = [
        c for c in df.columns
        if c not in ('name', 'status', 'day', 'start_time', 'group')
    ]

    # Aggregation
    agg_dict = {
        'name': ('name', 'first'),
        'day': ('day', 'first'),
        'start_time': ('start_time', 'min'),
        'end_time': ('start_time', lambda x: x.max() + pd.Timedelta(hours=1)),
        'status': ('status', 'first')
    }

    for col in other_cols:
        agg_dict[col] = (col, 'first')

    merged = (
        df.groupby('group')
          .agg(**agg_dict)
          .reset_index(drop=True)
    )
    merged['day'] = pd.to_datetime(merged['day']).dt.strftime('%Y-%m-%d')

    # Convert start_time and end_time to just the hour (HH:MM)

    merged['start_time'] = merged['start_time'].dt.strftime('%H:%M')
    merged['end_time'] = merged['end_time'].dt.strftime('%H:%M')

    merged = merged[merged['status'] != 'available'].reset_index(drop=True)
    merged = merged.drop(columns=['status'])
    merged['type'] = 'person'

    return merged



def simulate_room_availabilities(df, timeslot_info, odds=0.75, seed=1):
    with open(timeslot_info) as f:
        timeslot_config = json.load(f)

    first_day = timeslot_config['first_day']
    number_of_days = timeslot_config['number_of_days']
    start_hour = timeslot_config['start_hour']
    end_hour = timeslot_config['end_hour']


    start = datetime.datetime.strptime(first_day, "%Y-%m-%d")

    rows = []


    random.seed(seed)
    for room in range(10):
        for i in range(number_of_days):
            day = (start + datetime.timedelta(days=i)).date()
            streak = random.randint(1, end_hour-start_hour)
            status = "available" if random.random() < odds else "unavailable"
            prev_status = status
            start_time = start_hour
            end_time = start_hour + streak
            if streak == end_hour - start_hour:
                if status == 'unavailable':
                    rows.append({
                        'name': rooms[room],
                        'day': day,
                        'start_time': f'{start_time}:00',
                        'end_time': f'{end_hour}:00',
                        'type': 'room'
                    })
            while end_time < end_hour:
                streak = random.randint(1, end_hour - end_time)
                status = "available" if random.random() < odds else "unavailable"
                if status != prev_status:
                    if prev_status == 'unavailable':
                        rows.append({
                            'name': rooms[room],
                            'day': day,
                            'start_time': f'{start_time}:00',
                            'end_time': f'{end_time}:00',
                            'type': 'room'
                        })
                    prev_status = status
                    start_time = end_time
                end_time += streak
                if end_time == end_hour:
                    if status == 'unavailable':
                        rows.append({
                            'name': rooms[room],
                            'day': day,
                            'start_time': f'{start_time}:00',
                            'end_time': f'{end_hour}:00',
                            'type': 'room'
                        })
    df_new = pd.DataFrame(rows)

    df_final = pd.concat([df, df_new], ignore_index=True)
    return df_final




person_availabilities = ['input_data_original/availabilities_june_2021.csv',
                         'input_data_original/availabilities_toy_example.csv',
                         'input_data_original/MDH_availabilities_sept_2025.csv',
                         'input_data_original/intermediate_availabilities_2026.csv']


availabilities_output = ['input_data/june_2021/unavailabilities.csv',
                         'input_data/toy_example/unavailabilities.csv',
                         'input_data/sept_2025/unavailabilities.csv',
                         'input_data/intermediate_2026/unavailabilities.csv']

timeslot_info = ['input_data/june_2021/timeslot_info.json',
                 'input_data/toy_example/timeslot_info.json',
                 'input_data/sept_2025/timeslot_info.json',
                 'input_data/intermediate_2026/timeslot_info.json'
                 ]



defences = ['input_data_original/defences_june_2021.csv',
            'input_data_original/defences_toy_example.csv',
            'input_data_original/MDH_defences_sept_2025.csv',
            'input_data_original/intermediate_presentations_2026.csv']

defences_output = ['input_data/june_2021/defences.csv',
                         'input_data/toy_example/defences.csv',
                         'input_data/sept_2025/defences.csv',
                         'input_data/intermediate_2026/defences.csv']


rooms = [
    "200C 00.01",
    "200C 00.02",
    "200C 00.03",
    "200C 00.04",
    "200B 01.14",
    "200B 01.16",
    "200B 01.18",
    "Ruby",
    "Python",
    "Java"
  ]

def transform_availabilities():
    for idx, file in enumerate(person_availabilities):
        df = pd.read_csv(file)

        # Rename column
        df = df.rename(columns={'time_slot': 'start_time'})

        # Remove role column if present
        if 'role' in df.columns:
            df = df.drop(columns=['role'])

        if 'person_id' in df.columns:
            df = df.drop(columns=['person_id'])

        # Merge consecutive blocks
        merged_df = merge_availability_blocks(df)


        df_final = simulate_room_availabilities(merged_df, timeslot_info[idx])

        df_final = df_final[['name', 'type', 'day', 'start_time', 'end_time']]


        df_final.to_csv(availabilities_output[idx], index=False)


def transform_defences():
    for idx, file in enumerate(defences):
        df = pd.read_csv(file)

        # 1️⃣ Remove event_id column if present
        if 'event_id' in df.columns:
            df = df.drop(columns=['event_id'])

        # 2️⃣ Split assessors into two columns
        # Ensure string type
        df['assessors'] = df['assessors'].fillna('').astype(str)

        # Split into two columns, fill missing with NaN
        assessors_split = df['assessors'].str.split('|', n=1, expand=True)
        if assessors_split.shape[1] == 1:
            # If only one column returned, add second column
            assessors_split[1] = None

        assessors_split.columns = ['assessor1', 'assessor2']
        df = df.drop(columns=['assessors'])
        df = pd.concat([df, assessors_split], axis=1)

        # 3️⃣ Split mentors into up to three columns
        df['mentors'] = df['mentors'].fillna('').astype(str)
        mentors_split = df['mentors'].str.split('|', n=3, expand=True)

        # Make sure there are exactly three columns
        for i in range(4):
            if i not in mentors_split.columns:
                mentors_split[i] = None

        mentors_split.columns = ['mentor1', 'mentor2', 'mentor3', 'mentor4']
        df = df.drop(columns=['mentors'])
        df = pd.concat([df, mentors_split], axis=1)

        df = df.drop(columns=['programme', 'day', 'start_time', 'end_time', 'room', 'color'], errors='ignore')
        if 'title' not in df.columns:
            df['title'] = np.nan

        df = df[['student', 'title', 'supervisor', 'co_supervisor', 'assessor1', 'assessor2', 'mentor1', 'mentor2', 'mentor3', 'mentor4']]
        df.to_csv(defences_output[idx], index=False)


transform_availabilities()
transform_defences()