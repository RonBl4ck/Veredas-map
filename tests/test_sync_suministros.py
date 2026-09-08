import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.sync_suministros import (
    iter_supply_batches,
    read_env_file,
    source_metadata,
    sync_is_current,
)


def create_source_database(path: Path, rows=None) -> None:
    supplies = rows or [
        (100, -12.030755, -77.0869366667, 6, "2026-09-08T10:00:00Z"),
        (1000001, -11.94235871, -76.99020018, 8, "2026-09-08T10:00:00Z"),
        (7654321, -10.67587861, -72.136951, 6, "2026-09-08T10:00:00Z"),
    ]
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(
            """
            CREATE TABLE maestro_suministros (
                suministro TEXT PRIMARY KEY,
                latitud REAL NOT NULL,
                longitud REAL NOT NULL,
                precision_decimales INTEGER NOT NULL,
                actualizado_en TEXT NOT NULL
            );
            CREATE TABLE fuentes_maestro (
                nombre TEXT PRIMARY KEY,
                archivo TEXT NOT NULL,
                tamano INTEGER NOT NULL,
                mtime_ns INTEGER NOT NULL,
                filas_aceptadas INTEGER NOT NULL,
                filas_ambiguas INTEGER NOT NULL,
                actualizado_en TEXT NOT NULL
            );
            """
        )
        connection.executemany(
            "INSERT INTO maestro_suministros VALUES (?, ?, ?, ?, ?)",
            rows or supplies,
        )
        connection.execute(
            "INSERT INTO fuentes_maestro VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "coordenadas_suministros",
                "C:\\datos\\Coordenadas suministros.xlsx",
                50007631,
                1788382180135825800,
                len(rows or supplies),
                0,
                "2026-09-08T10:00:00Z",
            ),
        )
        connection.commit()


class SyncSuministrosTests(unittest.TestCase):
    def test_env_file_parses_quotes_comments_and_equals_without_exposing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env.local"
            env_path.write_text(
                '# local\nPOSTGRES_URL_NON_POOLING="postgresql://user:p=a@host/db"\nIGNORED\n',
                encoding="utf-8",
            )

            values = read_env_file(env_path)

        self.assertEqual(values, {"POSTGRES_URL_NON_POOLING": "postgresql://user:p=a@host/db"})

    def test_reads_supplies_in_requested_batches_with_stable_types(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite"
            create_source_database(database)

            batches = list(iter_supply_batches(database, batch_size=2))

        self.assertEqual([len(batch) for batch in batches], [2, 1])
        self.assertEqual(
            batches[0][0],
            (100, -12.030755, -77.0869366667, 6, "2026-09-08T10:00:00Z"),
        )

    def test_rejects_a_corrupt_coordinate_instead_of_silently_dropping_it(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite"
            create_source_database(
                database,
                rows=[("123", 91.0, -77.0, 6, "2026-09-08T10:00:00Z")],
            )

            with self.assertRaisesRegex(ValueError, "123"):
                list(iter_supply_batches(database, batch_size=100))

    def test_source_signature_changes_when_source_metadata_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite"
            create_source_database(database)
            first = source_metadata(database)
            with closing(sqlite3.connect(database)) as connection:
                connection.execute(
                    "UPDATE fuentes_maestro SET mtime_ns = mtime_ns + 1 "
                    "WHERE nombre = 'coordenadas_suministros'"
                )
                connection.commit()
            changed = source_metadata(database)

        self.assertEqual(first.row_count, 3)
        self.assertEqual(len(first.signature), 64)
        self.assertNotEqual(first.signature, changed.signature)

    def test_sync_is_current_requires_matching_signature_and_count_unless_forced(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite"
            create_source_database(database)
            source = source_metadata(database)

        self.assertTrue(sync_is_current(source.signature, 3, source, force=False))
        self.assertFalse(sync_is_current("otra", 3, source, force=False))
        self.assertFalse(sync_is_current(source.signature, 2, source, force=False))
        self.assertFalse(sync_is_current(source.signature, 3, source, force=True))


if __name__ == "__main__":
    unittest.main()
