# Defense-rostering
Implementation of the defense rostering use case in CPMPy.

The required installations are in `requirements.txt`.

To run with the default configuration:
`python .\defense-rostering.py`

To run with a certain configuration:
`python .\defense-rostering.py --config .\example-configs\{name}.yaml`

All currently supported configuration options are as follows (default values are overwritten):
- `--config` : run with a certain configuration file (`.yaml`, see `.\example-configs` for annotated examples)
- `--input-data` : run with certain input data (must be formatted as defined in `input_data_description.md`)
- `--number-of-defenses-in-problem` : only consider the first $n$ defenses in the input data (useful if solver is too slow)
- `--number-of-unavailabilities-in-problem` : only consider the first $n$ unavailability slots in the input data (useful if solver is too slow)
- `--solver` : which solver to use. The solver must be supported by CPMPy, the constraint programming and modelling library used to build this application. Some solvers need to be installed separately from `requirements.txt`.
- `--allocation-model` : whether the problem is modelled as an allocation problem (true) or a scheduling problem (false). (For now, the allocation model is a lot less efficient!)
- `--adjacency-objective` : whether we want to use the adjacency objective or not (for its meaning, see `problem_description.md`)
- `--must-plan-all-defenses` : whether we want to enforce that all defenses must be planned (unsatisfiable otherwise), or whether this is not a constraint but rather an objective.
- `--availability_odds`: the odds of a room being available during a certain timeslot (only works with certain input data, when simulating the room availabilities).
- `--max-rooms`: the maximum number of rooms allowed to be used for defenses.
- `--max-days`: the maximum number of days allowed to be used for defenses (starting from the first day).

Input files appear under `.\input_data` and the input format is defined in `input_data_description.md`
Output files appear under `.\output_data` and the output format is defined in `output_data_description.md`.


In `problem_description.md` different scenarios can be explored under the section Scenarios. Different ways that conflicts can arise and ways to resolve them are discussed.
By using the configuration options (especially `--max-rooms` and `--max-days`), you can explore more options and see what results the solver finds.
