import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..models import Campaign, CampaignCreate

_LOCK = threading.Lock()


class CampaignStore:
    """JSON-file backed campaign store. Single-process safe via threading.Lock."""

    def __init__(self, data_dir: Path):
        self.path = data_dir / "campaigns.json"
        data_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("[]", encoding="utf-8")

    def _read(self) -> list[dict]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []

    def _write(self, rows: list[dict]) -> None:
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
        tmp.replace(self.path)

    def list(self) -> list[Campaign]:
        with _LOCK:
            rows = self._read()
        return [Campaign.model_validate(r) for r in rows]

    def create(self, payload: CampaignCreate) -> Campaign:
        record = Campaign(
            id=uuid.uuid4().hex[:12],
            created_at=datetime.now(timezone.utc),
            **payload.model_dump(),
        )
        with _LOCK:
            rows = self._read()
            rows.insert(0, json.loads(record.model_dump_json()))
            self._write(rows)
        return record
