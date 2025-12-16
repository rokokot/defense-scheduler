from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .config import SNAPSHOT_DIR

@dataclass
class Snapshot:
    id: str
    name: str
    description: Optional[str]
    created_at: str
    path: Path


def _snapshot_path(snapshot_id: str) -> Path:
    return SNAPSHOT_DIR / f"{snapshot_id}.json"


def save_snapshot(name: str, description: Optional[str], state: Dict) -> Snapshot:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    snapshot_id = uuid.uuid4().hex[:12]
    path = _snapshot_path(snapshot_id)
    payload = {
        "id": snapshot_id,
        "name": name,
        "description": description,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "state": state,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return Snapshot(
        id=snapshot_id,
        name=name,
        description=description,
        created_at=payload["created_at"],
        path=path,
    )


def list_snapshots() -> List[Dict]:
    items = []
    for path in sorted(SNAPSHOT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        items.append(
            {
                "id": data["id"],
                "name": data["name"],
                "description": data.get("description"),
                "created_at": data["created_at"],
                "size_bytes": path.stat().st_size,
                "roster_count": len(data.get("state", {}).get("assignments", [])),
                "event_count": len(data.get("state", {}).get("entities", [])),
            }
        )
    return items


def load_snapshot(snapshot_id: str) -> Dict:
    path = _snapshot_path(snapshot_id)
    if not path.exists():
        raise FileNotFoundError("Snapshot not found")
    return json.loads(path.read_text(encoding="utf-8"))


def delete_snapshot(snapshot_id: str) -> None:
    path = _snapshot_path(snapshot_id)
    if path.exists():
        path.unlink()


__all__ = ["save_snapshot", "list_snapshots", "load_snapshot", "delete_snapshot"]
