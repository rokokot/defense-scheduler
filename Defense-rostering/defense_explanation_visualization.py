"""
Visualization component for defense rostering explanations.

Creates interactive Plotly visualizations for:
- Blocking Matrix: Shows which resources block which defenses
- Slot-Level Detail: Shows specific hours blocked for each (defense, resource) pair
"""

import json
import argparse
from collections import defaultdict

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import pandas as pd


# Color scheme
COLORS = {
    'person': '#3b82f6',      # blue
    'room': '#f59e0b',        # orange/amber
    'pool_expansion': '#10b981',  # green
    'background': '#f8fafc',
    'grid': '#e2e8f0',
    'text': '#334155',
}


def load_batch_explanation(json_path: str) -> dict:
    """Load and validate batch explanation JSON."""
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    required = ['metadata', 'defenses', 'resource_summary']
    for key in required:
        if key not in data:
            raise ValueError(f"Missing required key: {key}")

    return data


def get_all_resources(batch_data: dict) -> tuple:
    """Extract all person and room resources from the data."""
    persons = set()
    rooms = set()

    for defense_id, defense_data in batch_data['defenses'].items():
        mus = defense_data.get('mus', {})
        mcs_list = defense_data.get('mcs', [])

        for person in mus.get('person-unavailable', {}).keys():
            persons.add(person)
        for person in mus.get('person-overlap', {}).keys():
            persons.add(person)
        for room in mus.get('room-unavailable', {}).keys():
            rooms.add(room)
        for room in mus.get('room-overlap', {}).keys():
            rooms.add(room)

        for mcs in mcs_list:
            for person in mcs.get('person-unavailable', {}).keys():
                persons.add(person)
            for room in mcs.get('room-unavailable', {}).keys():
                rooms.add(room)
            for room in mcs.get('extra-room', []):
                rooms.add(room)

    return sorted(persons), sorted(rooms)


def shorten_name(name: str, max_len: int = 20) -> str:
    """Shorten a name for display."""
    if len(name) <= max_len:
        return name
    parts = name.split()
    if len(parts) >= 2:
        # First name initial + last name
        return f"{parts[0][0]}. {parts[-1]}"
    return name[:max_len-2] + "..."


def is_resource_in_mus(mus_data: dict, resource: str, is_person: bool) -> bool:
    """Check if a resource appears in the MUS."""
    if is_person:
        return (resource in mus_data.get('person-unavailable', {}) or
                resource in mus_data.get('person-overlap', {}))
    else:
        return (resource in mus_data.get('room-unavailable', {}) or
                resource in mus_data.get('room-overlap', {}))


def is_resource_in_mcs(mcs_data: dict, resource: str, is_person: bool) -> bool:
    """Check if a resource appears in an MCS."""
    if is_person:
        return resource in mcs_data.get('person-unavailable', {})
    else:
        # Room can appear in MCS via room-unavailable (relax booking) or extra-room (add room)
        return (resource in mcs_data.get('room-unavailable', {}) or
                resource in mcs_data.get('extra-room', []))


def count_blocked_slots(mus_data: dict, resource: str, is_person: bool) -> int:
    """Count number of blocked slots for a resource in MUS."""
    count = 0
    if is_person:
        count += len(mus_data.get('person-unavailable', {}).get(resource, []))
        count += len(mus_data.get('person-overlap', {}).get(resource, []))
    else:
        count += len(mus_data.get('room-unavailable', {}).get(resource, []))
        count += len(mus_data.get('room-overlap', {}).get(resource, []))
    return count


def create_blocking_matrix(batch_data: dict) -> go.Figure:
    """
    Create Blocking Matrix view with proper labels.
    """
    defenses = batch_data['defenses']
    persons, rooms = get_all_resources(batch_data)

    defense_ids = list(defenses.keys())
    defense_labels = [defenses[d]['student'] for d in defense_ids]
    resource_labels = persons + rooms
    resource_short = [shorten_name(r, 15) for r in resource_labels]

    # Build data for scatter plots
    mus_data_points = []
    mcs_data_points = []

    for d_idx, d_id in enumerate(defense_ids):
        mus_data = defenses[d_id].get('mus', {})
        mcs_list = defenses[d_id].get('mcs', [])
        student = defenses[d_id]['student']

        for r_idx, resource in enumerate(resource_labels):
            is_person = resource in persons
            color = COLORS['person'] if is_person else COLORS['room']

            if is_resource_in_mus(mus_data, resource, is_person):
                blocked = count_blocked_slots(mus_data, resource, is_person)
                mus_data_points.append({
                    'x': resource_short[r_idx],
                    'y': student,
                    'color': color,
                    'size': max(10, min(25, 10 + blocked // 2)),
                    'hover': f"<b>{student}</b><br>Resource: {resource}<br>Blocked slots: {blocked}",
                    'resource_full': resource
                })

            if any(is_resource_in_mcs(mcs, resource, is_person) for mcs in mcs_list):
                mcs_data_points.append({
                    'x': resource_short[r_idx],
                    'y': student,
                    'color': color,
                    'hover': f"<b>{student}</b><br>Resource: {resource}<br>Repairable (in MCS)",
                    'resource_full': resource
                })

    fig = go.Figure()

    # MUS markers (filled circles)
    if mus_data_points:
        fig.add_trace(go.Scatter(
            x=[p['x'] for p in mus_data_points],
            y=[p['y'] for p in mus_data_points],
            mode='markers',
            marker=dict(
                size=[p['size'] for p in mus_data_points],
                color=[p['color'] for p in mus_data_points],
                symbol='circle',
                line=dict(width=1, color='white')
            ),
            name='In MUS (blocked)',
            hovertext=[p['hover'] for p in mus_data_points],
            hoverinfo='text'
        ))

    # MCS markers (open rings)
    if mcs_data_points:
        fig.add_trace(go.Scatter(
            x=[p['x'] for p in mcs_data_points],
            y=[p['y'] for p in mcs_data_points],
            mode='markers',
            marker=dict(
                size=22,
                color=[p['color'] for p in mcs_data_points],
                symbol='circle-open',
                line=dict(width=3)
            ),
            name='In MCS (repairable)',
            hovertext=[p['hover'] for p in mcs_data_points],
            hoverinfo='text'
        ))

    # Calculate dimensions
    n_resources = len(resource_labels)
    n_defenses = len(defense_labels)

    fig.update_layout(
        title=dict(
            text="<b>Blocking Matrix</b> — Why Defenses Cannot Be Scheduled",
            font=dict(size=16, color=COLORS['text']),
            x=0.5,
            xanchor='center'
        ),
        xaxis=dict(
            title=dict(text="Resources (People & Rooms)", font=dict(size=12)),
            tickangle=45,
            tickfont=dict(size=10),
            categoryorder='array',
            categoryarray=resource_short,
            gridcolor=COLORS['grid'],
            showgrid=True
        ),
        yaxis=dict(
            title=dict(text="Unplanned Defenses", font=dict(size=12)),
            tickfont=dict(size=10),
            categoryorder='array',
            categoryarray=defense_labels[::-1],  # Reverse for top-to-bottom
            gridcolor=COLORS['grid'],
            showgrid=True
        ),
        legend=dict(
            orientation='h',
            yanchor='bottom',
            y=-0.35,
            xanchor='center',
            x=0.5,
            font=dict(size=11)
        ),
        plot_bgcolor=COLORS['background'],
        paper_bgcolor='white',
        margin=dict(l=150, r=50, t=80, b=180),
        height=max(450, 120 + n_defenses * 35),
        width=max(700, 200 + n_resources * 60),
        hovermode='closest'
    )

    # Add annotation explaining colors
    fig.add_annotation(
        text="<b>Legend:</b> 🔵 Person (blue) | 🟠 Room (orange) | ● Filled = In MUS (blocks scheduling) | ○ Ring = In MCS (repairable)",
        xref="paper", yref="paper",
        x=0.5, y=-0.22,
        showarrow=False,
        font=dict(size=10, color=COLORS['text']),
        align='center'
    )

    return fig


def create_slot_detail_view(batch_data: dict, defense_id: str = None) -> go.Figure:
    """
    Create Slot-Level Detail view with proper labels.
    """
    metadata = batch_data['metadata']
    defenses = batch_data['defenses']

    start_hour = metadata['timeslot_info']['start_hour']
    end_hour = metadata['timeslot_info']['end_hour']
    hours = list(range(start_hour, end_hour))
    hour_labels = [f"{h:02d}:00" for h in hours]

    target_defenses = [defense_id] if defense_id else list(defenses.keys())

    # Build blocked slot data
    blocks = []
    for d_id in target_defenses:
        if d_id not in defenses:
            continue

        mus = defenses[d_id].get('mus', {})
        student = defenses[d_id]['student']
        student_short = shorten_name(student, 15)

        for category in ['person-unavailable', 'person-overlap',
                         'room-unavailable', 'room-overlap']:
            for resource, timestamps in mus.get(category, {}).items():
                resource_short = shorten_name(resource, 12)
                for ts in timestamps:
                    try:
                        parts = ts.split(' ')
                        day = parts[0]
                        hour = int(parts[1].split(':')[0])
                        is_person = 'person' in category
                        blocks.append({
                            'defense': student,
                            'defense_short': student_short,
                            'resource': resource,
                            'resource_short': resource_short,
                            'hour': hour,
                            'hour_label': f"{hour:02d}:00",
                            'day': day,
                            'type': 'person' if is_person else 'room',
                            'category': category
                        })
                    except (IndexError, ValueError):
                        continue

    if not blocks:
        fig = go.Figure()
        fig.add_annotation(
            text="No blocked slots to display",
            x=0.5, y=0.5,
            xref="paper", yref="paper",
            showarrow=False,
            font=dict(size=14)
        )
        fig.update_layout(height=200)
        return fig

    df = pd.DataFrame(blocks)

    # Create y-axis labels as "Student | Resource"
    df['y_label'] = df['defense_short'] + ' | ' + df['resource_short']

    # Get unique y-labels preserving a logical order
    y_labels = df.groupby(['defense', 'resource'])['y_label'].first().reset_index()['y_label'].unique().tolist()

    fig = go.Figure()

    for typ, color, name in [('person', COLORS['person'], 'Person conflict'),
                              ('room', COLORS['room'], 'Room conflict')]:
        subset = df[df['type'] == typ]
        if subset.empty:
            continue

        fig.add_trace(go.Scatter(
            x=subset['hour_label'],
            y=subset['y_label'],
            mode='markers',
            marker=dict(size=16, color=color, symbol='square'),
            name=name,
            hovertext=[
                f"<b>{row['defense']}</b><br>"
                f"Resource: {row['resource']}<br>"
                f"Day: {row['day']}<br>"
                f"Time: {row['hour_label']}<br>"
                f"Type: {row['category']}"
                for _, row in subset.iterrows()
            ],
            hoverinfo='text'
        ))

    n_rows = len(y_labels)

    fig.update_layout(
        title=dict(
            text="<b>Slot-Level Blocking Details</b> — Specific Hours Blocked",
            font=dict(size=16, color=COLORS['text']),
            x=0.5,
            xanchor='center'
        ),
        xaxis=dict(
            title=dict(text="Hour of Day", font=dict(size=12)),
            tickfont=dict(size=11),
            categoryorder='array',
            categoryarray=hour_labels,
            gridcolor=COLORS['grid'],
            showgrid=True
        ),
        yaxis=dict(
            title=dict(text="Defense | Resource", font=dict(size=12)),
            tickfont=dict(size=9),
            categoryorder='array',
            categoryarray=y_labels[::-1],  # Reverse for top-to-bottom
            gridcolor=COLORS['grid'],
            showgrid=True
        ),
        legend=dict(
            orientation='h',
            yanchor='bottom',
            y=-0.15,
            xanchor='center',
            x=0.5,
            font=dict(size=11)
        ),
        plot_bgcolor=COLORS['background'],
        paper_bgcolor='white',
        margin=dict(l=200, r=50, t=80, b=80),
        height=max(400, 80 + n_rows * 25),
        width=700,
        hovermode='closest'
    )

    return fig


def create_combined_dashboard(batch_data: dict, output_path: str = None) -> go.Figure:
    """
    Create a combined dashboard with both views as separate figures saved to HTML.
    """
    fig1 = create_blocking_matrix(batch_data)
    fig2 = create_slot_detail_view(batch_data)

    # Create HTML with both figures
    metadata = batch_data['metadata']

    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>Defense Explanation Dashboard - {metadata['input_data']}</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f8fafc;
            color: #334155;
        }}
        .header {{
            text-align: center;
            padding: 20px;
            background: white;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        .header h1 {{
            margin: 0 0 10px 0;
            font-size: 24px;
            color: #1e293b;
        }}
        .header p {{
            margin: 5px 0;
            color: #64748b;
        }}
        .stats {{
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-top: 15px;
        }}
        .stat {{
            text-align: center;
        }}
        .stat-value {{
            font-size: 28px;
            font-weight: bold;
            color: #3b82f6;
        }}
        .stat-label {{
            font-size: 12px;
            color: #64748b;
        }}
        .chart-container {{
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            overflow-x: auto;
        }}
        .chart-title {{
            font-size: 14px;
            color: #64748b;
            margin-bottom: 10px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Defense Explanation Dashboard</h1>
        <p>Instance: <strong>{metadata['input_data']}</strong></p>
        <p>Period: {metadata['timeslot_info']['first_day']} ({metadata['timeslot_info']['number_of_days']} days, {metadata['timeslot_info']['start_hour']}:00-{metadata['timeslot_info']['end_hour']}:00)</p>
        <div class="stats">
            <div class="stat">
                <div class="stat-value">{len(metadata['planned_defenses'])}</div>
                <div class="stat-label">Planned</div>
            </div>
            <div class="stat">
                <div class="stat-value">{len(metadata['unplanned_defenses'])}</div>
                <div class="stat-label">Unplanned</div>
            </div>
            <div class="stat">
                <div class="stat-value">{len(batch_data.get('combined_explanation', {}).get('mcs', []))}</div>
                <div class="stat-label">Repair Options</div>
            </div>
        </div>
    </div>

    <div class="chart-container">
        <div class="chart-title">Each dot shows a resource (person/room) that blocks a defense. Rings indicate repairable constraints.</div>
        <div id="matrix"></div>
    </div>

    <div class="chart-container">
        <div class="chart-title">Each square shows a specific hour when a person/room is unavailable.</div>
        <div id="detail"></div>
    </div>

    <script>
        var matrix = {fig1.to_json()};
        var detail = {fig2.to_json()};

        Plotly.newPlot('matrix', matrix.data, matrix.layout, {{responsive: true}});
        Plotly.newPlot('detail', detail.data, detail.layout, {{responsive: true}});
    </script>
</body>
</html>
"""

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        print(f"Dashboard saved to: {output_path}")

    return fig1  # Return first figure for compatibility


def print_summary(batch_data: dict):
    """Print a text summary of the batch explanation."""
    metadata = batch_data['metadata']
    defenses = batch_data['defenses']

    print("\n" + "="*60)
    print("BATCH EXPLANATION SUMMARY")
    print("="*60)
    print(f"Input: {metadata['input_data']}")
    print(f"Planned defenses: {len(metadata['planned_defenses'])}")
    print(f"Unplanned defenses: {len(metadata['unplanned_defenses'])}")
    print(f"Days: {metadata['timeslot_info']['number_of_days']} ({metadata['timeslot_info']['first_day']})")
    print(f"Hours: {metadata['timeslot_info']['start_hour']}:00 - {metadata['timeslot_info']['end_hour']}:00")
    print()

    for d_id, data in defenses.items():
        print(f"\nDefense {d_id}: {data['student']}")
        print(f"  Evaluators: {', '.join(data['evaluators'][:3])}...")

        mus = data['mus']
        mus_persons = list(mus.get('person-unavailable', {}).keys())
        if mus_persons:
            print(f"  MUS (blocked by): {', '.join(mus_persons[:3])}" +
                  (f" +{len(mus_persons)-3} more" if len(mus_persons) > 3 else ""))

        mcs_count = len(data['mcs'])
        truncated = " (truncated)" if data['mcs_truncated'] else ""
        print(f"  Repair options: {mcs_count}{truncated}")

        if data['mcs']:
            simplest = min(data['mcs'], key=lambda m: sum(
                len(v) for v in m.get('person-unavailable', {}).values()
            ) + sum(
                len(v) for v in m.get('room-unavailable', {}).values()
            ) + len(m.get('extra-room', [])) + len(m.get('extra-day', [])))

            repairs = []
            for person, slots in simplest.get('person-unavailable', {}).items():
                repairs.append(f"{person} ({len(slots)} slots)")
            for room, slots in simplest.get('room-unavailable', {}).items():
                repairs.append(f"{room} ({len(slots)} slots)")
            for room in simplest.get('extra-room', []):
                repairs.append(f"add {room}")
            for day in simplest.get('extra-day', []):
                repairs.append(f"add day {day}")

            print(f"  Simplest fix: {', '.join(repairs[:3])}" +
                  (f" +{len(repairs)-3} more" if len(repairs) > 3 else ""))

    print("\n" + "="*60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Visualize defense rostering explanations")
    parser.add_argument("--json", required=True, help="Path to batch_explanation.json")
    parser.add_argument("--output", default="explanation_dashboard.html",
                        help="Output HTML file path")
    parser.add_argument("--summary", action="store_true",
                        help="Print text summary to console")
    parser.add_argument("--matrix-only", action="store_true",
                        help="Generate only the blocking matrix")
    parser.add_argument("--detail-only", action="store_true",
                        help="Generate only the slot detail view")
    parser.add_argument("--defense", type=str, default=None,
                        help="Filter to specific defense ID for detail view")

    args = parser.parse_args()

    data = load_batch_explanation(args.json)

    if args.summary:
        print_summary(data)

    if args.matrix_only:
        fig = create_blocking_matrix(data)
        fig.write_html(args.output)
        print(f"Blocking matrix saved to: {args.output}")
    elif args.detail_only:
        fig = create_slot_detail_view(data, defense_id=args.defense)
        fig.write_html(args.output)
        print(f"Slot detail saved to: {args.output}")
    else:
        create_combined_dashboard(data, output_path=args.output)
