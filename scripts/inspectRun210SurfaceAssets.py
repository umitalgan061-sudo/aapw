#!/usr/bin/env python3
"""Inspect the owner-uploaded surface package without changing game runtime."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

ROOT = Path("assets/textures/yüzey")
OUT = Path("artifacts/run210-surface-inspection")
OVERLAY = ROOT / "overlay" / "overlay.png"
OBJ = ROOT / "model.obj"
MTL = ROOT / "model.mtl"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def image_info(path: Path) -> dict:
    with Image.open(path) as image:
        width, height = image.size
        mode = image.mode
        fmt = image.format
        has_alpha = "A" in image.getbands()
        rgba_bytes = width * height * 4
        mip_bytes = int(rgba_bytes * 4 / 3)
        sample = image.convert("RGBA")
        sample.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        rgb = sample.convert("RGB")
        left = rgb.crop((0, 0, 1, rgb.height)).resize((32, 256))
        right = rgb.crop((rgb.width - 1, 0, rgb.width, rgb.height)).resize((32, 256))
        top = rgb.crop((0, 0, rgb.width, 1)).resize((256, 32))
        bottom = rgb.crop((0, rgb.height - 1, rgb.width, rgb.height)).resize((256, 32))
        lr = sum(ImageStat.Stat(ImageChops.difference(left, right)).mean) / 3
        tb = sum(ImageStat.Stat(ImageChops.difference(top, bottom)).mean) / 3
        alpha_extrema = sample.getchannel("A").getextrema() if has_alpha else None
        return {
            "path": path.as_posix(),
            "width": width,
            "height": height,
            "mode": mode,
            "format": fmt,
            "fileBytes": path.stat().st_size,
            "hasAlpha": has_alpha,
            "alphaExtrema": alpha_extrema,
            "decodedRgbaMiB": round(rgba_bytes / 1048576, 2),
            "decodedRgbaWithMipmapsMiB": round(mip_bytes / 1048576, 2),
            "edgeMismatchMean255": {"leftRight": round(lr, 2), "topBottom": round(tb, 2)},
        }


def inspect_obj(path: Path) -> dict:
    vertices = texcoords = normals = faces = faces_with_uv = 0
    objects: list[str] = []
    mtllibs: list[str] = []
    bounds = {"min": [float("inf")] * 3, "max": [float("-inf")] * 3}
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("v "):
                vertices += 1
                parts = line.split()
                if len(parts) >= 4:
                    xyz = [float(parts[1]), float(parts[2]), float(parts[3])]
                    for i, value in enumerate(xyz):
                        bounds["min"][i] = min(bounds["min"][i], value)
                        bounds["max"][i] = max(bounds["max"][i], value)
            elif line.startswith("vt "):
                texcoords += 1
            elif line.startswith("vn "):
                normals += 1
            elif line.startswith("f "):
                faces += 1
                refs = line.split()[1:]
                if refs and all(len(ref.split("/")) > 1 and ref.split("/")[1] for ref in refs):
                    faces_with_uv += 1
            elif line.startswith("o "):
                objects.append(line[2:].strip())
            elif line.startswith("mtllib "):
                mtllibs.append(line[7:].strip())
    extent = [round(bounds["max"][i] - bounds["min"][i], 3) for i in range(3)]
    return {
        "vertices": vertices,
        "textureCoordinates": texcoords,
        "normals": normals,
        "faces": faces,
        "facesWithUv": faces_with_uv,
        "uvFaceCoverageRatio": round(faces_with_uv / faces, 6) if faces else 0,
        "objects": objects,
        "mtllibs": mtllibs,
        "bounds": bounds,
        "extent": extent,
    }


def inspect_mtl(path: Path) -> dict:
    maps: dict[str, list[str]] = {}
    materials: list[str] = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if line.startswith("newmtl "):
            materials.append(line.split(maxsplit=1)[1])
        elif line.startswith("map_"):
            key, value = line.split(maxsplit=1)
            maps.setdefault(key, []).append(value)
    return {"materials": materials, "maps": maps}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    images = [image_info(path) for path in sorted(ROOT.rglob("*")) if path.suffix.lower() in IMAGE_EXTS]
    overlay_info = next(item for item in images if item["path"] == OVERLAY.as_posix())
    obj_info = inspect_obj(OBJ)
    mtl_info = inspect_mtl(MTL)

    with Image.open(OVERLAY) as image:
        preview = image.convert("RGB")
        preview.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        preview.save(OUT / "overlay-preview.jpg", quality=88, optimize=True)

    report = {
        "surfaceRoot": ROOT.as_posix(),
        "images": images,
        "overlay": overlay_info,
        "obj": obj_info,
        "mtl": mtl_info,
        "assessment": {
            "mtlReferencesOverlay": any("overlay.png" in value.lower() for values in mtl_info["maps"].values() for value in values),
            "objHasUv": obj_info["textureCoordinates"] > 0 and obj_info["facesWithUv"] > 0,
            "worldSpaceProjectionRecommended": obj_info["facesWithUv"] == 0,
            "mobileTextureRiskOver512MiB": overlay_info["decodedRgbaWithMipmapsMiB"] >= 512,
            "mobileTextureRiskOver128MiB": overlay_info["decodedRgbaWithMipmapsMiB"] >= 128,
        },
    }
    (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
