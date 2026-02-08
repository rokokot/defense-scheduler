import csv
import datetime
import random

import pandas as pd

'''def simulate_room_availabilities(first_day='2025-02-24', max_rooms=3, amount_of_days=4,first_hour=9,last_hour=16, odds=0.75, seed=1):
    start = datetime.datetime.strptime(first_day, "%Y-%m-%d")

    with open("input_data_example/room_availabilities_example.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["room_id", "name", "day", "time_slot", "status"])

    with open("input_data_example/room_availabilities_example.csv", "a", newline="") as f:
        writer = csv.writer(f)
        random.seed(seed)
        for room in range(max_rooms):
            for i in range(amount_of_days):
                day = (start + datetime.timedelta(days=i)).date()
                streak = random.randint(1, 8)
                status = "available" if random.random() < odds else "unavailable"
                for j in range(first_hour, last_hour+1):
                    if streak == 0:
                        streak = random.randint(1, 8)
                        status = "available" if random.random() < odds else "unavailable"
                    time_slot = str(j) + ':00'
                    writer.writerow([f'room-{room}', f'Room {room}', day, time_slot, status])
                    streak -= 1



df1 = pd.read_csv("input_data_original/intermediate_presentations_2026.csv")
df1 = df1.iloc[20:35]
df1.to_csv("input_data_example/defences_example.csv", index=False)

if "supervisor" in df1.columns:
    supervisor_names = set(df1["supervisor"].dropna().unique())
    print("Supervisor names:", list(supervisor_names))
else:
    raise ValueError("Column 'supervisor' not found in input.csv")

df2 = pd.read_csv("input_data_original/intermediate_availabilities_2026.csv")

if "name" in df2.columns:
    filtered_df2 = df2[df2["name"].isin(supervisor_names)]
else:
    raise ValueError("Column 'name' not found in input2.csv")


filtered_df2.to_csv("input_data_example/person_availabilities_example.csv", index=False)


simulate_room_availabilities()'''


# Possible satisfiable scenario for which all constraints and the unique objective is tested
#  - 1 day, 2 rooms
#  - 6 defenses
#  - 4 evaluators
#  - Overlap groups: (1,2), (3,4), (5,6), (1,6)
#  - room 1 unavailable from 9:00-12:00, 14:00-15:00, room 2 unavailable from 15:00-16:00
# evaluator availabilities:
# 1: XX--XXXX
# 2: X-XX---X
# 3: -XXX-XX-
# 4: XXX--XXX

# working plan: __216(34)5



# 1 and 6 can be planned consecutively, but only in one order
# 5 and 6 cannot be planned consecutively due to the evaluator availabilities
# 3 and 4 cannot be planned consecutively due to the room availabilities
# 1 and 2 can be planned consecutively, but only in one order

# 3 and 4 could have taken place at the same time in the same room, if it was not for the evaluator overlap constraint