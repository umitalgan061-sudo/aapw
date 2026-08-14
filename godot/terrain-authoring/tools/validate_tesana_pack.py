#!/usr/bin/env python3
"""Static integrity checks for the additive Tesana Westeros asset pack."""

from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
PACK = PROJECT / "assets" / "tesana_westeros"

EXPECTED_MODELS = {
    "characters/bandit_raider/bandit_raider.glb",
    "characters/king_north/king_north.glb",
    "characters/peasant_man/peasant_man.glb",
    "characters/player_heir/player_heir.glb",
    "characters/queen_south/queen_south.glb",
    "characters/sworn_knight/sworn_knight.glb",
    "characters/village_woman/village_woman.glb",
    "environment/buildings/north_keep.glb",
    "environment/buildings/village_house_a.glb",
    "environment/buildings/village_house_b.glb",
    "environment/rocks/dragon_spire.glb",
    "environment/structures/westeros_watchtower.glb",
    "props/decorations/house_banner.glb",
    "props/furniture/iron_throne.glb",
    "props/misc/bandit_tent.glb",
    "props/misc/black_dragon.glb",
    "props/misc/campfire.glb",
    "props/misc/castle_cat.glb",
    "props/misc/farm_cow.glb",
    "props/misc/farm_sheep.glb",
    "props/misc/loyal_hound.glb",
    "props/weapons/bandit_axe.glb",
    "props/weapons/longsword_valyrian.glb",
}

EXPECTED_ANIMATION_LIBRARIES = {
    f"characters/{name}/{name}_animations.tres"
    for name in (
        "bandit_raider",
        "king_north",
        "peasant_man",
        "player_heir",
        "queen_south",
        "sworn_knight",
        "village_woman",
    )
}


def validate_glb(path: Path) -> list[str]:
    errors: list[str] = []
    data = path.read_bytes()
    if len(data) < 20:
        return [f"{path}: file is too small"]
    magic, version, declared_length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        errors.append(f"{path}: invalid GLB magic")
    if version != 2:
        errors.append(f"{path}: expected glTF 2, got {version}")
    if declared_length != len(data):
        errors.append(f"{path}: declared length {declared_length} != {len(data)}")
    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        errors.append(f"{path}: first GLB chunk is not JSON")
        return errors
    try:
        document = json.loads(data[20 : 20 + json_length].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        errors.append(f"{path}: invalid GLB JSON: {exc}")
        return errors
    external_uris = []
    for group in ("buffers", "images"):
        for item in document.get(group, []):
            uri = item.get("uri")
            if uri and not uri.startswith("data:"):
                external_uris.append(uri)
    if external_uris:
        errors.append(f"{path}: unresolved external URIs: {external_uris}")
    return errors


def validate_res_paths() -> list[str]:
    errors: list[str] = []
    inspected = [
        PROJECT / "scripts" / "tesana_westeros" / "westeros_realism_showcase.gd",
        PROJECT / "scenes" / "tesana_westeros" / "westeros_realism_showcase.tscn",
        PROJECT / "materials" / "tesana_westeros" / "realistic_water_base.tres",
        PACK / "trees" / "tree_spawner.gd",
        PACK / "water" / "material" / "water_basic" / "water_basic_01.tres",
        PACK / "water" / "texture" / "wave" / "wave_01" / "wave_normal_01.tres",
        PACK / "water" / "texture" / "wave" / "wave_01" / "wave_texture_01.tres",
    ]
    for source in inspected:
        if not source.is_file():
            errors.append(f"missing integration file: {source}")
            continue
        text = source.read_text(encoding="utf-8", errors="replace")
        for resource_path in re.findall(r"res://[^\"')\s]+", text):
            local = PROJECT / resource_path.removeprefix("res://")
            if not local.exists():
                errors.append(f"{source}: missing {resource_path}")
    return errors


def main() -> int:
    errors: list[str] = []
    actual_models = {path.relative_to(PACK).as_posix() for path in PACK.rglob("*.glb")}
    actual_libraries = {
        path.relative_to(PACK).as_posix() for path in PACK.rglob("*_animations.tres")
    }
    errors.extend(f"missing model: {path}" for path in sorted(EXPECTED_MODELS - actual_models))
    errors.extend(
        f"missing animation library: {path}"
        for path in sorted(EXPECTED_ANIMATION_LIBRARIES - actual_libraries)
    )
    for relative_path in sorted(EXPECTED_MODELS):
        model = PACK / relative_path
        if model.is_file():
            errors.extend(validate_glb(model))

    mp3_files = list((PACK / "audio").rglob("*.mp3"))
    if len(mp3_files) != 28:
        errors.append(f"expected 28 MP3 files, found {len(mp3_files)}")
    for audio in mp3_files:
        header = audio.read_bytes()[:3]
        if header != b"ID3" and not (len(header) >= 2 and header[0] == 0xFF):
            errors.append(f"{audio}: unrecognized MP3 header")

    sky = PACK / "textures" / "skyboxes" / "photoreal_northern_storm_panorama.png"
    if not sky.is_file():
        errors.append("missing photoreal sky panorama")
    elif sky.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
        errors.append("photoreal sky is not a PNG")
    else:
        width, height = struct.unpack(">II", sky.read_bytes()[16:24])
        if (width, height) != (2048, 1024):
            errors.append(f"photoreal sky must be 2048x1024, got {width}x{height}")

    errors.extend(validate_res_paths())
    if errors:
        print("Tesana pack validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(
        "Tesana pack validation passed: "
        f"{len(actual_models)} GLBs, {len(actual_libraries)} animation libraries, "
        f"{len(mp3_files)} MP3s, photoreal 2048x1024 sky, and resolved res:// paths."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
