"""Sincroniza el maestro SQLite de suministros hacia Supabase Postgres."""

from __future__ import annotations

import argparse
import hashlib
import os
import sqlite3
import sys
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


FRONTEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SQLITE = PROJECT_ROOT / "runtime" / "base_veredas.sqlite"
DEFAULT_ENV_FILE = FRONTEND_ROOT / ".env.local"
MIGRATION_FILE = FRONTEND_ROOT / "supabase" / "migrations" / "20260908000000_create_suministros.sql"
MAX_BIGINT = 9_223_372_036_854_775_807
SOURCE_NAME = "coordenadas_suministros"


@dataclass(frozen=True)
class SourceMetadata:
    signature: str
    row_count: int
    source_file: str
    source_updated_at: str


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def source_metadata(sqlite_path: Path) -> SourceMetadata:
    if not sqlite_path.is_file():
        raise FileNotFoundError(f"No existe la base SQLite: {sqlite_path}")

    with closing(sqlite3.connect(sqlite_path)) as connection:
        row = connection.execute(
            """
            SELECT archivo, tamano, mtime_ns, filas_aceptadas,
                   filas_ambiguas, actualizado_en
            FROM fuentes_maestro
            WHERE nombre = ?
            """,
            (SOURCE_NAME,),
        ).fetchone()
        if row is None:
            raise RuntimeError("La base SQLite no contiene metadatos del maestro de suministros.")
        actual_count = int(
            connection.execute("SELECT COUNT(*) FROM maestro_suministros").fetchone()[0]
        )

    source_file, size, mtime_ns, accepted, ambiguous, updated_at = row
    if actual_count != int(accepted):
        raise RuntimeError(
            "El conteo de maestro_suministros no coincide con fuentes_maestro "
            f"({actual_count} != {accepted})."
        )
    fingerprint = f"{size}|{mtime_ns}|{accepted}|{ambiguous}|{actual_count}"
    return SourceMetadata(
        signature=hashlib.sha256(fingerprint.encode("utf-8")).hexdigest(),
        row_count=actual_count,
        source_file=str(source_file),
        source_updated_at=str(updated_at),
    )


def _validated_row(row: sqlite3.Row) -> tuple[int, float, float, int, str]:
    code_raw, lat_raw, lon_raw, precision_raw, updated_at = row
    code_text = str(code_raw).strip()
    if not code_text.isdigit():
        raise ValueError(f"Suministro inválido: {code_text!r}")
    code = int(code_text)
    if code <= 0 or code > MAX_BIGINT:
        raise ValueError(f"Suministro fuera de rango: {code_text}")

    lat = float(lat_raw)
    lon = float(lon_raw)
    precision = int(precision_raw)
    if not (-18 <= lat <= 0 and -82 <= lon <= -68) or (lat == 0 and lon == 0):
        raise ValueError(f"Coordenadas inválidas para suministro {code_text}: {lat}, {lon}")
    if not 0 <= precision <= 15:
        raise ValueError(f"Precisión inválida para suministro {code_text}: {precision}")
    return code, lat, lon, precision, str(updated_at)


def iter_supply_batches(
    sqlite_path: Path,
    batch_size: int = 10_000,
) -> Iterator[list[tuple[int, float, float, int, str]]]:
    if batch_size <= 0:
        raise ValueError("batch_size debe ser mayor que cero.")
    with closing(sqlite3.connect(sqlite_path)) as connection:
        with closing(
            connection.execute(
                """
                SELECT suministro, latitud, longitud, precision_decimales, actualizado_en
                FROM maestro_suministros
                ORDER BY suministro
                """
            )
        ) as cursor:
            while rows := cursor.fetchmany(batch_size):
                yield [_validated_row(row) for row in rows]


def sync_is_current(
    remote_signature: str | None,
    remote_count: int,
    source: SourceMetadata,
    force: bool,
) -> bool:
    return not force and remote_signature == source.signature and remote_count == source.row_count


def database_url(env_file: Path) -> str:
    values = read_env_file(env_file)
    url = os.environ.get("POSTGRES_URL_NON_POOLING") or values.get("POSTGRES_URL_NON_POOLING")
    if not url:
        raise RuntimeError(
            "POSTGRES_URL_NON_POOLING no está disponible en el entorno ni en el archivo indicado."
        )
    if not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("POSTGRES_URL_NON_POOLING no tiene formato PostgreSQL.")
    return url


def sync_supabase(
    sqlite_path: Path,
    env_file: Path,
    force: bool = False,
    batch_size: int = 10_000,
) -> tuple[str, int]:
    try:
        import psycopg
    except ImportError as error:
        raise RuntimeError(
            "Falta psycopg. Instala scripts/requirements.txt antes de sincronizar."
        ) from error

    source = source_metadata(sqlite_path)
    migration_sql = MIGRATION_FILE.read_text(encoding="utf-8")
    url = database_url(env_file)

    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute(migration_sql)
        remote = connection.execute(
            """
            SELECT m.source_signature,
                   (SELECT COUNT(*) FROM private.suministros)
            FROM private.suministros_sync AS m
            WHERE m.source_name = %s
            """,
            (SOURCE_NAME,),
        ).fetchone()
        remote_signature, remote_count = remote if remote else (None, 0)
        if sync_is_current(remote_signature, int(remote_count), source, force):
            return "skipped", source.row_count

        copied = 0
        with connection.transaction():
            connection.execute("SET LOCAL statement_timeout = 0")
            connection.execute(
                """
                CREATE TEMP TABLE suministros_stage
                (LIKE private.suministros INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
                ON COMMIT DROP
                """
            )
            with connection.cursor().copy(
                """
                COPY suministros_stage
                    (suministro, latitud, longitud, precision_decimales, actualizado_en)
                FROM STDIN
                """
            ) as copy:
                for batch in iter_supply_batches(sqlite_path, batch_size=batch_size):
                    for row in batch:
                        copy.write_row(row)
                    copied += len(batch)
                    if copied % 100_000 < len(batch):
                        print(f"  {copied:,} suministros transferidos...", flush=True)

            if copied != source.row_count:
                raise RuntimeError(f"Carga incompleta: {copied} de {source.row_count} registros.")

            connection.execute(
                """
                INSERT INTO private.suministros AS target
                    (suministro, latitud, longitud, precision_decimales, actualizado_en)
                SELECT suministro, latitud, longitud, precision_decimales, actualizado_en
                FROM suministros_stage
                ON CONFLICT (suministro) DO UPDATE SET
                    latitud = EXCLUDED.latitud,
                    longitud = EXCLUDED.longitud,
                    precision_decimales = EXCLUDED.precision_decimales,
                    actualizado_en = EXCLUDED.actualizado_en
                WHERE (target.latitud, target.longitud, target.precision_decimales, target.actualizado_en)
                    IS DISTINCT FROM
                    (EXCLUDED.latitud, EXCLUDED.longitud, EXCLUDED.precision_decimales, EXCLUDED.actualizado_en)
                """
            )
            connection.execute(
                """
                DELETE FROM private.suministros AS target
                WHERE NOT EXISTS (
                    SELECT 1 FROM suministros_stage AS source
                    WHERE source.suministro = target.suministro
                )
                """
            )
            connection.execute(
                """
                INSERT INTO private.suministros_sync
                    (source_name, source_signature, source_file, source_row_count,
                     source_updated_at, synced_at)
                VALUES (%s, %s, %s, %s, %s::timestamptz, now())
                ON CONFLICT (source_name) DO UPDATE SET
                    source_signature = EXCLUDED.source_signature,
                    source_file = EXCLUDED.source_file,
                    source_row_count = EXCLUDED.source_row_count,
                    source_updated_at = EXCLUDED.source_updated_at,
                    synced_at = EXCLUDED.synced_at
                """,
                (
                    SOURCE_NAME,
                    source.signature,
                    source.source_file,
                    source.row_count,
                    source.source_updated_at,
                ),
            )

        connection.execute("ANALYZE private.suministros")
        final_count = int(
            connection.execute("SELECT COUNT(*) FROM private.suministros").fetchone()[0]
        )
        if final_count != source.row_count:
            raise RuntimeError(
                f"Verificación remota falló: {final_count} de {source.row_count} registros."
            )
    return "synced", final_count


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sincroniza el maestro local de suministros con Supabase, sin usar Google Sheets."
    )
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_SQLITE)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--batch-size", type=int, default=10_000)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    started = time.monotonic()
    try:
        status, count = sync_supabase(
            args.sqlite.resolve(),
            args.env_file.resolve(),
            force=args.force,
            batch_size=args.batch_size,
        )
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    elapsed = time.monotonic() - started
    if status == "skipped":
        print(f"Sin cambios: Supabase ya contiene {count:,} suministros ({elapsed:.1f}s).")
    else:
        print(f"Sincronización completada: {count:,} suministros ({elapsed:.1f}s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
