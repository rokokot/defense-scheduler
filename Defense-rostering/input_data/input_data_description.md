# Description of the input data

The following is a documentation of all columns and keys in the input data.
Names are used as unique identifiers for different entities in the problem (people and rooms).

In `input_data/{problem-name}/defences.csv`, the following columns are present:
- `student` : the name of the student defending their master thesis
- `title` : the title of the master thesis
- `supervisor` : the name of the supervisor supervising the master thesis 
- `co_supervisor` : the name of the co-supervisor co-supervising the master thesis
- `assessor1`, `assessor2` : the names of the two assessors assessing the master thesis (there are always exactly 2, except in toy examples).
- `mentor1`, `mentor2`, `mentor3`, `mentor4` : the names of the mentor(s) helping with the master thesis. There can be between 0 and 4 mentors. If there are less than 4 mentors, some columns have as value `null`.


In `input_data/{problem-name}/unavailabilities.csv`, the following columns are present:

- `name` : the name of a certain person or room. This name uniquely identifies this entity in the defense rostering problem, it is the key that we match on.
- `type` : whether this entity is a person or a room.
    
- `day` : a day in YYYY-MM-DD format (year-month-day). For example: `"2020-01-01"`
- `start_time` : a moment in time in HH:MM format (hour-minute), where always MM = 00. This should be interpreted as the start of the time interval where the entity is unavailable.
- `end_time` : a moment in time in HH:MM format (hour-minute), where always MM = 00. This should be interpreted as the end of the time interval where the entity is unavailable.


In `input_data/{problem-name}/timeslot_info.json`, the following keys are present:
- `first_day` : the first day on which defenses can be planned, in YYYY-MM-DD format (year-month-day).
- `number_of_days` : the number of days on which defenses can be planned
- `start_hour` : an integer between 0 and 23 indicating the earliest possible start time (in hours) for defenses
- `end_hour` : an integer between 1 and 24 indicating the latest possible finish time (in hours) for defenses

In `input_data/{problem-name}/rooms.json`, the following keys are present:
- `rooms` : a list of the names of all rooms that can be used for defenses


**Optional**: In `input_data/{problem-name}/metadata.json`, the following keys are present:
- `max_rooms` : an upper limit on the number of rooms that can be used for defenses. 
- `max_days` : an upper limit on the number of days that can be used to plan defenses in.
- `relaxed_timeslots` : for a certain evaluator and a certain timeslot, indicate that their unavailability was overridden (?) (expand later)




