#!/usr/bin/env python3
"""Install the pinned official Terrain3D binary release into this Godot authoring project.

The script downloads TokisanGames' published binary release, verifies the pinned SHA256,
extracts only addons/terrain_3d, then enables Terrain3D beside HTerrain in project.godot.
Use --check-upstream to inspect the latest upstream release without silently upgrading.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import urllib.request
import zipfile

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = PROJECT_ROOT / "terrain3d.lock.json"
PROJECT_FILE = PROJECT_ROOT / "project.godot"
TARGET_DIR = PROJECT_ROOT / "addons" / "terrain_3d"
USER_AGENT = "aapw-terrain-authoring/1.0"
HTERRAIN_PLUGIN = "res://addons/zylann.hterrain/plugin.cfg"
TERRAIN3D_PLUGIN = "res://addons/terrain_3d/plugin.cfg"


def load_lock() -> dict:
    return json.loads(LOCK_PATH.read_text(encoding="utf-8"))


def request_bytes(url: str, accept: str = "application/octet-stream") -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": accept},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def installed_version() -> str | None:
    plugin_cfg = TARGET_DIR / "plugin.cfg"
    if not plugin_cfg.is_file():
        return None
    for line in plugin_cfg.read_text(encoding="utf-8").splitlines():
        if line.startswith("version="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


def project_plugins_enabled() -> bool:
    text = PROJECT_FILE.read_text(encoding="utf-8")
    return HTERRAIN_PLUGIN in text and TERRAIN3D_PLUGIN in text


def enable_project_plugins() -> None:
    text = PROJECT_FILE.read_text(encoding="utf-8")
    dual = f'enabled=PackedStringArray("{HTERRAIN_PLUGIN}", "{TERRAIN3D_PLUGIN}")'
    if dual in text:
        return
    hterrain_only = f'enabled=PackedStringArray("{HTERRAIN_PLUGIN}")'
    terrain3d_only = f'enabled=PackedStringArray("{TERRAIN3D_PLUGIN}")'
    if hterrain_only in text:
        text = text.replace(hterrain_only, dual, 1)
    elif terrain3d_only in text:
        text = text.replace(terrain3d_only, dual, 1)
    else:
        marker = "[editor_plugins]\n"
        if marker not in text:
            raise RuntimeError("project.godot has no [editor_plugins] section")
        section_start = text.index(marker) + len(marker)
        text = text[:section_start] + "\n" + dual + "\n" + text[section_start:]
    PROJECT_FILE.write_text(text, encoding="utf-8")


def verify_install(lock: dict, require_enabled: bool = True) -> None:
    required = [
        TARGET_DIR / "plugin.cfg",
        TARGET_DIR / "terrain.gdextension",
        TARGET_DIR / "src" / "editor_plugin.gd",
    ]
    missing = [str(path.relative_to(PROJECT_ROOT)) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"Terrain3D install incomplete; missing: {', '.join(missing)}")
    if installed_version() != lock["version"]:
        raise RuntimeError(
            f"Terrain3D plugin version mismatch: installed={installed_version()!r} locked={lock['version']!r}"
        )
    binaries = list((TARGET_DIR / "bin").glob("*"))
    if not binaries:
        raise RuntimeError("Terrain3D binary release did not provide addons/terrain_3d/bin")
    if require_enabled and not project_plugins_enabled():
        raise RuntimeError("Terrain3D is installed but not enabled beside HTerrain in project.godot")


def install(lock: dict, refresh: bool) -> None:
    if not refresh and installed_version() == lock["version"]:
        try:
            enable_project_plugins()
            verify_install(lock)
            print(f"TERRAIN3D_INSTALL_OK already-installed version={lock['version']} enabled=true")
            return
        except RuntimeError:
            pass

    archive = request_bytes(lock["release_url"])
    actual = sha256_bytes(archive)
    expected = lock["sha256"].lower()
    if actual.lower() != expected:
        raise RuntimeError(f"Terrain3D archive SHA256 mismatch: expected={expected} actual={actual}")

    with tempfile.TemporaryDirectory(prefix="terrain3d-install-") as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / lock["release_asset"]
        zip_path.write_bytes(archive)
        extracted = tmp_path / "extracted"
        extracted.mkdir()

        with zipfile.ZipFile(zip_path) as bundle:
            names = bundle.namelist()
            plugin_candidates = [name for name in names if name.endswith("addons/terrain_3d/plugin.cfg")]
            if len(plugin_candidates) != 1:
                raise RuntimeError(
                    f"Expected exactly one addons/terrain_3d/plugin.cfg in release archive; got {len(plugin_candidates)}"
                )
            prefix = plugin_candidates[0][: -len("addons/terrain_3d/plugin.cfg")]
            subtree = prefix + "addons/terrain_3d/"
            for member in names:
                if not member.startswith(subtree) or member.endswith("/"):
                    continue
                relative = Path(member[len(subtree) :])
                if not relative.parts or ".." in relative.parts:
                    raise RuntimeError(f"Unsafe Terrain3D archive path: {member}")
                destination = extracted / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(member) as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)

        backup = TARGET_DIR.with_name("terrain_3d.previous")
        if backup.exists():
            shutil.rmtree(backup)
        if TARGET_DIR.exists():
            TARGET_DIR.rename(backup)
        try:
            shutil.copytree(extracted, TARGET_DIR)
            enable_project_plugins()
            verify_install(lock)
        except Exception:
            if TARGET_DIR.exists():
                shutil.rmtree(TARGET_DIR)
            if backup.exists():
                backup.rename(TARGET_DIR)
            raise
        else:
            if backup.exists():
                shutil.rmtree(backup)

    print(
        "TERRAIN3D_INSTALL_OK "
        f"version={lock['version']} tag={lock['tag']} sha256={lock['sha256']} enabled=true target={TARGET_DIR}"
    )


def check_upstream(lock: dict) -> None:
    payload = json.loads(
        request_bytes(lock["latest_release_api"], "application/vnd.github+json").decode("utf-8")
    )
    upstream_tag = payload.get("tag_name")
    state = "CURRENT" if upstream_tag == lock["tag"] else "UPDATE_AVAILABLE"
    print(f"TERRAIN3D_UPSTREAM_{state} pinned={lock['tag']} latest={upstream_tag}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="Reinstall even when the pinned version is present")
    parser.add_argument(
        "--check-upstream",
        action="store_true",
        help="Query TokisanGames/Terrain3D latest release; never changes the lock or installed version",
    )
    parser.add_argument("--verify-only", action="store_true", help="Validate an existing installation without downloading")
    args = parser.parse_args()

    lock = load_lock()
    if args.check_upstream:
        check_upstream(lock)
    if args.verify_only:
        verify_install(lock)
        print(f"TERRAIN3D_VERIFY_OK version={lock['version']} enabled=true")
        return
    install(lock, args.refresh)


if __name__ == "__main__":
    main()
