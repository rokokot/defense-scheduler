# Problem description

In this file the problem of master thesis defense rostering will be described. From here on, we will refer to the problem as "defense rostering".

## Use case description
The defense rostering problem is a combinatorial optimization problem (more specifically a scheduling/rostering problem) where students that work on certain topics for their master thesis need to defend their work to certain evaluators, in a certain room, during a certain timeslot. In the context of the computer science department at KU Leuven, such defenses need to be planned three times a year (January, June and September).

**Rostering**: rostering of master thesis defenses

*Optional*: **Multi-objective**: the problem is characterized by multiple objectives that need to be optimized.


## Entities 

The entities that are relevant to defense rostering are:
- Students: A student researches a certain topic for their master thesis, is the author of the final thesis text, and will defend their work during a thesis defense.
- Topics: A topic is the subject of research for a certain master thesis. Each student has at most one topic, and one topic can be assigned to either one or two students. 
- Evaluators: An evaluator evaluates a thesis defense. Different types of evaluators are supervisors, co-supervisors, assessors and mentors (see `input_data_example/data_description.md`), however for the following formulation of the defense rostering problem they can be considered equivalent. However, usually the attendance of mentors is not required, and their availabilities do not need to be taken into account.
- Rooms: A thesis defense takes place in a certain room. **Optional:** In the context of this problem, a defense that takes place fully online can be considered to take place in the "online room".
- Timeslots: A thesis defense takes place during a certain timeslot, where a timeslot has a start time and an end time.
- Defenses: Every student has a thesis defense, and this is what we want to plan under certain constraints.

## Constraints

We group the defense rostering constraints by their type.

### Constraints on people

These constraints are about the people involved in thesis defenses (students and evaluators).
1. *Person availability*: if someone defends or evaluates a defense during a certain timeslot, they must be available during that timeslot.
2. *Evaluator overlap* : if an evaluator evaluates different defenses, these defenses cannot overlap in time.

### Constraints on rooms

These constraints are about the rooms where thesis defenses take place.
1. *Room availability*: if a defense takes place at a certain room during a certain timeslot, that room must be available during that timeslot.
2. *Room overlap*: no two defenses can take place at the same room during the same timeslot. **Optional:** except when this room is the "online room".
3. (*Unique room*: every defense must be planned in exactly one room. (This only needs to be modelled due to choice of variables))

### Constraints on timeslots

These constraints are about the timeslots when thesis defenses take place.

1. *Legal timeslots*: defenses can only take place between 9:00 and 17:00.
2. **Optional:** *Programme constraints*: certain programmes only allow defenses on certain days (should be given as input data).

## Objective(s)

1. *Adjacency objective*: for all possible pairs of defenses: if they have an evaluator in common, try to plan them adjacent to each other in time, and in the same room. **Optional:** in a room close in distance instead of the same room.
2. **Optional**: *Distance objective*: try to minimize the walking distance an evaluator has to walk to attend all their defenses.
3. **Optional**: *Preference objective*: try to satisfy the room preferences of a certain evaluator.


## Scenarios

In the following section different scenarios will be discussed. They all start from the same 6 defenses that need to be planned, which can be seen (among others) in `input_data/documented_example_trivial/defences.csv`.
Some simplifying assumptions have been made, such as the fact that there are no assessors. Nevertheless, a problem with interesting aspects can still be obtained. 

Now the content of `defences.csv`, `unavailabilities.csv`, `rooms.json` and `timeslot_info.json` will be discussed, see `input_data/data_description.md` for more info about the meaning of the columns and keys in these files.

In `defences.csv` the following interesting information can be observed:
- every (co-)supervisor in the problem (co-)supervises exactly 2 defenses. That means that there are 4 pairs of defenses with an evaluator in common (since there are 4 evaluators). From here on these will simply be referred to as "pairs". We want to maximize the amount of adjacent pairs.

In `rooms.json` we find a list of 10 rooms that can be used for defenses. 
In `timeslot_info.json` we find that defenses can only be planned on one day, from 9:00 to 17:00.

Only `unavailabilities.csv` will be different in each different scenario. This is done to illustrate the effect that unavailable rooms/people can have on the problem.

First consider the problem in `input_data/documented_example_trivial`. 
Here `unavailabilities.csv` is empty, making the planning problem trivial. When running:

`python .\defense-rostering.py --config .\example-configs\config-example-trivial.yaml`

we get four figures as output:

1. Initial room view: this view shows which rooms (y-axis) are unavailable at which times (x-axis). In this case there are no unavailable rooms.
2. Initial evaluator view: this view shows which evaluators (y-axis) are unavailable at which times (x-axis). In this case there are no unavailable evaluators.
3. Planning in room view: this view overlays the planning on the initial room view. Every planned defense is identified with its student and placed on the correct room and timeslot.
4. Planning in evaluator view: the view overlays the planning on the initial evaluator view. Every planned defense is identified with its room and placed on the correct timeslot for every evaluator evaluating that defense.

The initial room and evaluator view are useful for identifying how hard the problem will be.

The planning in room view is useful to see which room will be occupied at which time. It also offers a way to see which student is planned in which room during which timeslot.
Moreover, the planning in room view can indicate how many defenses were able to be planned.

The planning in evaluator view is useful to see at which time a certain evaluator will have to travel to which room. 
It gives a clear insight into how well the adjacency objective is satisfied: if two boxes with the same color are next to each other, that pair has been planned adjacently.

In this trivial example, all defenses can be planned and all pairs can be planned adjacently. However, the following scenarios introduce certain complications.

Firstly, a scenario where two rooms are allowed to be used, and they are unavailable most of the time:

`python .\defense-rostering.py --config .\example-configs\config-example-room-conflict.yaml`

Not all defenses were successfully planned, as indicated in the title of the planning in room view. The cause of this is visible in the room view: many unavailability blocks only leave 5 timeslots to be filled in, not enough for all defenses.

This problem can be fixed by allowing the use of a third room, which is available for the whole day.

`python .\defense-rostering.py --config .\example-configs\config-example-room-conflict.yaml --max-rooms 3`

Secondly, a scenario where two evaluators (Hendrik Blockeel and Wannes Meert) have to sit in on the defense of the same student (Rochkoulets Maxime), but there is no timeslot on which they are both available.

`python .\defense-rostering.py --config .\example-configs\config-example-evaluator-conflict.yaml`

This problem is harder to resolve: it could be resolved by allowing the defense to take place on an extra day where both evaluators can find a common available timeslot. It can also be resolved by relaxing the unavailable timeslots of both evaluators.
However, adding an extra room cannot fix this problem. It is therefore clear that different problems require different solutions, indicating the importance of explainability.

Lastly, we consider a more complicated example:

`python .\defense-rostering.py --config .\example-configs\config-example1.yaml`

In this example, there are both evaluator and room unavailabilities. 
All defenses can be planned in this scenario. However, we cannot fulfill the adjacency objective for all possible pairs. This is clearly visible in the evaluator view planning: only 2 out of 4 pairs are adjacent.

If we look at the planning in the evaluator view in more detail, we clearly observe that there are two different reasons why the two pairs cannot be adjacent. For one, it is because they cannot be in the same room, due to room availability constraints. 
For the other, it is because one of the evaluators (Mariya Ishteva) does not have two adjacent timeslots in which they are both available.

To clearly show that only one of the two pairs is restricted by room availability constraints, we add an extra room and see that now, 3 out of 4 pairs are adjacent.

`python .\defense-rostering.py --config .\example-configs\config-example1.yaml --max-rooms 3`

To also clearly show that only one of the two pairs is restricted by evaluator availability constraints, we make it so that evaluator Mariya Ishteva is always available in the following example:

`python .\defense-rostering.py --config .\example-configs\config-example1-relaxed.yaml`


Lastly, we combine the two additions to obtain 4 adjacent pairs out of 4.

`python .\defense-rostering.py --config .\example-configs\config-example1-relaxed.yaml --max-rooms 3`