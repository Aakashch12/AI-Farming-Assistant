import json
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from class_labels import CLASS_LABELS


DEFAULT_DATABASE_PATH = os.path.join(
    os.path.dirname(__file__),
    "data",
    "scan_history.sqlite3",
)


class ScanHistoryStore:
    def __init__(self, database_path=None):
        self.database_path = os.path.abspath(
            database_path or os.getenv("PLANT_DISEASE_HISTORY_DB", DEFAULT_DATABASE_PATH)
        )
        os.makedirs(os.path.dirname(self.database_path), exist_ok=True)
        if sys.platform != "win32":
            os.chmod(os.path.dirname(self.database_path), 0o700)
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self):
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS scan_history (
                    id TEXT PRIMARY KEY,
                    original_filename TEXT NOT NULL,
                    disease_name TEXT NOT NULL,
                    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 100),
                    top_alternatives TEXT NOT NULL,
                    precautions TEXT NOT NULL,
                    remedies TEXT NOT NULL,
                    scanned_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_scan_history_scanned_at "
                "ON scan_history(scanned_at DESC)"
            )
        if sys.platform != "win32" and os.path.exists(self.database_path):
            os.chmod(self.database_path, 0o600)

    @staticmethod
    def _serialize(row):
        record = {
            "id": row["id"],
            "original_filename": row["original_filename"],
            "disease_name": row["disease_name"],
            "confidence": row["confidence"],
            "top_alternatives": json.loads(row["top_alternatives"]),
            "precautions": json.loads(row["precautions"]),
            "remedies": json.loads(row["remedies"]),
            "scanned_at": row["scanned_at"],
        }
        try:
            uuid.UUID(record["id"])
            scanned_at = datetime.fromisoformat(record["scanned_at"])
        except (ValueError, TypeError) as exc:
            raise ValueError("Stored scan metadata contains an invalid ID or timestamp.") from exc

        if (
            not isinstance(record["original_filename"], str)
            or not record["original_filename"]
            or len(record["original_filename"]) > 255
            or os.path.basename(record["original_filename"].replace("\\", "/"))
            != record["original_filename"]
            or record["disease_name"] not in CLASS_LABELS
            or not isinstance(record["confidence"], (int, float))
            or not 0 <= record["confidence"] <= 100
            or scanned_at.tzinfo is None
        ):
            raise ValueError("Stored scan metadata failed validation.")

        alternatives = record["top_alternatives"]
        if (
            not isinstance(alternatives, list)
            or len(alternatives) > 2
            or any(
                not isinstance(item, dict)
                or item.get("disease_name") not in CLASS_LABELS
                or not isinstance(item.get("confidence"), (int, float))
                or not 0 <= item["confidence"] <= 100
                for item in alternatives
            )
        ):
            raise ValueError("Stored alternative predictions failed validation.")

        for field in ("precautions", "remedies"):
            items = record[field]
            if (
                not isinstance(items, list)
                or len(items) > 30
                or any(not isinstance(item, str) or len(item) > 1000 for item in items)
            ):
                raise ValueError(f"Stored {field} failed validation.")
        return record

    def create(self, scan):
        scan_id = str(uuid.uuid4())
        scanned_at = datetime.now(timezone.utc).isoformat()
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO scan_history (
                    id, original_filename, disease_name, confidence,
                    top_alternatives, precautions, remedies, scanned_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    scan_id,
                    scan["original_filename"],
                    scan["disease_name"],
                    scan["confidence"],
                    json.dumps(scan["top_alternatives"]),
                    json.dumps(scan["precautions"]),
                    json.dumps(scan["remedies"]),
                    scanned_at,
                ),
            )
            row = connection.execute(
                "SELECT * FROM scan_history WHERE id = ?",
                (scan_id,),
            ).fetchone()
        return self._serialize(row)

    def list(self, search=""):
        query = search.strip()
        with self._connection() as connection:
            if query:
                rows = connection.execute(
                    """
                    SELECT * FROM scan_history
                    WHERE disease_name LIKE ? OR original_filename LIKE ?
                    ORDER BY scanned_at DESC
                    """,
                    (f"%{query}%", f"%{query}%"),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM scan_history ORDER BY scanned_at DESC"
                ).fetchall()
        return [self._serialize(row) for row in rows]

    def get(self, scan_id):
        try:
            normalized_id = str(uuid.UUID(scan_id))
        except (ValueError, AttributeError) as exc:
            raise InvalidScanId("Scan ID is invalid.") from exc

        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM scan_history WHERE id = ?",
                (normalized_id,),
            ).fetchone()
        return self._serialize(row) if row is not None else None


class InvalidScanId(ValueError):
    pass
