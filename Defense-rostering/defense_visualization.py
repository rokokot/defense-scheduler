import pandas as pd
import colorsys
import datetime
import plotly.express as px


def get_room_name(room):
    """Extract room name from either string or dict format."""
    return room['name'] if isinstance(room, dict) else room


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
            room_names = [get_room_name(r) for r in model.rooms]
            if name in room_names:
                room_id = room_names.index(name)
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
    n_days = model.max_days
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
                                "room": get_room_name(model.rooms[r]),
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
                "room": get_room_name(model.rooms[room]),
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
                            "room": get_room_name(model.rooms[room_id]),
                            "start": pd.to_datetime(st, unit="h", origin=model.first_day),
                            "end": pd.to_datetime(en, unit="h", origin=model.first_day)
                        })
    unavailable_intervals = get_unavailable_intervals(model, cfg, f"input_data/{cfg['input_data']}/unavailabilities.csv",
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
        room_name = get_room_name(model.rooms[r])
        # Use the modulo operator (%) to cycle through the color_sequence if there are more IDs than colors
        color_map[room_name] = color_sequence[r % len(color_sequence)]

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
    n_days = model.max_days
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

