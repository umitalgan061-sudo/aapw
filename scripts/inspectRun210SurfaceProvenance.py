#!/usr/bin/env python3
"""Read embedded metadata/strings from the owner surface package for provenance evidence."""
from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path('assets/textures/yüzey')
OUT = Path('artifacts/run210-surface-provenance')
IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp'}
KEYWORDS = (
    'license', 'licence', 'copyright', 'author', 'creator', 'owner', 'source',
    'google', 'bing', 'mapbox', 'openstreetmap', 'osm', 'maxar', 'esri',
    'agisoft', 'metashape', 'realitycapture', 'pix4d', 'autodesk', '3ds max',
    'sketchfab', 'meshy', 'cc0', 'creative commons', 'cc-by', 'cc by',
)


def clean_value(value):
    if isinstance(value, bytes):
        return value[:200].decode('utf-8', errors='replace')
    return str(value)[:500]


def image_metadata(path: Path) -> dict:
    with Image.open(path) as image:
        exif = {str(key): clean_value(value) for key, value in image.getexif().items()}
        info = {}
        for key, value in image.info.items():
            if isinstance(value, (str, int, float, tuple)):
                info[str(key)] = clean_value(value)
        return {'path': path.as_posix(), 'format': image.format, 'exif': exif, 'info': info}


def binary_keyword_strings(path: Path) -> list[str]:
    data = path.read_bytes()
    candidates = re.findall(rb'[\x20-\x7e]{8,240}', data)
    hits = []
    for raw in candidates:
        text = raw.decode('ascii', errors='ignore').strip()
        lowered = text.lower()
        if any(keyword in lowered for keyword in KEYWORDS):
            hits.append(text[:240])
        if len(hits) >= 80:
            break
    return hits


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    images = [image_metadata(path) for path in sorted(ROOT.rglob('*')) if path.suffix.lower() in IMAGE_EXTS]
    text_hits = {}
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file() or path.suffix.lower() in IMAGE_EXTS:
            continue
        hits = binary_keyword_strings(path)
        if hits:
            text_hits[path.as_posix()] = hits
    report = {'images': images, 'keywordStrings': text_hits}
    payload = json.dumps(report, indent=2, ensure_ascii=False)
    (OUT / 'provenance.json').write_text(payload, encoding='utf-8')
    print(payload)


if __name__ == '__main__':
    main()
