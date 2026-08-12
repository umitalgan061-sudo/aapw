#!/usr/bin/env python3
"""Build a deterministic integrity manifest and copy of HTerrain authoring data."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


REQUIRED_BASELINE_FILES = (
    "color.png",
    "color.png.import",
    "data.hterrain",
    "data.hterrain.uid",
    "detail.png",
    "detail.png.import",
    "global_albedo.png",
    "global_albedo.png.import",
    "height.res",
    "normal.png",
    "normal.png.import",
    "splat.png",
    "splat.png.import",
)
EXCLUDED_SOURCE_FILES = {".gitkeep"}
SCHEMA = "hterrain-authoring-snapshot-v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy HTerrain authoring data and write a SHA-256 manifest."
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    source = args.source.resolve()
    output = args.output.resolve()

    if not source.is_dir():
        raise SystemExit(f"HTerrain source directory does not exist: {source}")
    if output == source or source in output.parents:
        raise SystemExit("Snapshot output must be outside the HTerrain source directory")
    if output.exists() and any(output.iterdir()):
        raise SystemExit(f"Snapshot output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    source_files = sorted(
        (
            path
            for path in source.rglob("*")
            if path.is_file()
            and path.relative_to(source).as_posix() not in EXCLUDED_SOURCE_FILES
        ),
        key=lambda path: path.relative_to(source).as_posix(),
    )
    relative_names = {path.relative_to(source).as_posix() for path in source_files}
    missing = sorted(set(REQUIRED_BASELINE_FILES) - relative_names)
    if missing:
        raise SystemExit(
            "HTerrain snapshot is missing required baseline files: " + ", ".join(missing)
        )
    if not source_files:
        raise SystemExit("HTerrain snapshot has no generated authoring files")

    manifest_files: list[dict[str, object]] = []
    total_bytes = 0
    for source_path in source_files:
        relative = source_path.relative_to(source)
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination)

        source_hash = _sha256(source_path)
        destination_hash = _sha256(destination)
        if source_hash != destination_hash:
            raise SystemExit(f"Snapshot copy hash mismatch: {relative.as_posix()}")

        size = source_path.stat().st_size
        total_bytes += size
        manifest_files.append(
            {
                "path": relative.as_posix(),
                "sha256": source_hash,
                "size": size,
            }
        )

    manifest = {
        "schema": SCHEMA,
        "source_directory": "terrain_data",
        "required_baseline_files": list(REQUIRED_BASELINE_FILES),
        "file_count": len(manifest_files),
        "total_bytes": total_bytes,
        "files": manifest_files,
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(
        "TERRAIN_DATA_SNAPSHOT_OK "
        f"files={len(manifest_files)} bytes={total_bytes} "
        f"manifest_sha256={_sha256(manifest_path)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
