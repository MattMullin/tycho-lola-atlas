"""Fetch a bounded LROC WAC optical crop from the USGS lunar WMS.

Run: python fetch_optical.py
The WMS request is repeatable. A verified existing image is reused.
"""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import json

import requests
from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "optical_tycho.png"
PROVENANCE = ROOT / "data" / "optical_tycho.json"
FAILURES = ROOT / "data" / "optical_failures.log"
WMS = "https://planetarymaps.usgs.gov/cgi-bin/mapserv"
DEM = json.loads((ROOT / "data" / "terrain.json").read_text())
BOUNDS = [
    DEM["col0"] / 64,
    90 - (DEM["row0"] + DEM["rows"]) / 64,
    (DEM["col0"] + DEM["cols"]) / 64,
    90 - DEM["row0"] / 64,
]
SIZE = (DEM["cols"] * 6, DEM["rows"] * 6)
PARAMS = {
    "map": "/maps/earth/moon_simp_cyl.map",  # USGS server path, lunar data
    "SERVICE": "WMS",
    "VERSION": "1.1.1",
    "REQUEST": "GetMap",
    "LAYERS": "LROC_WAC",
    "STYLES": "",
    "SRS": "EPSG:4326",  # WMS service token; coordinates are lunar, not terrestrial
    "BBOX": ",".join(str(v) for v in BOUNDS),
    "WIDTH": str(SIZE[0]),
    "HEIGHT": str(SIZE[1]),
    "FORMAT": "image/png",
    "TRANSPARENT": "FALSE",
}


def verify(data):
    with Image.open(BytesIO(data)) as im:
        im.load()
        if im.size != SIZE or im.format != "PNG":
            raise ValueError(f"unexpected image format or size: {im.format} {im.size}")
        if min(ImageStat.Stat(im.convert("RGB")).stddev) < 5:
            raise ValueError("optical crop has insufficient pixel variation")


def main():
    if OUT.exists() and PROVENANCE.exists():
        existing = OUT.read_bytes()
        details = json.loads(PROVENANCE.read_text())
        if sha256(existing).hexdigest() == details.get("sha256"):
            verify(existing)
            print(f"cached: {OUT} ({len(existing):,} bytes)")
            return
    try:
        response = requests.get(WMS, params=PARAMS, timeout=90)
        response.raise_for_status()
        if "image/png" not in response.headers.get("Content-Type", ""):
            raise ValueError(f"WMS returned {response.headers.get('Content-Type')}: {response.text[:300]}")
        verify(response.content)
        OUT.write_bytes(response.content)
        details = {
            "source": "USGS Astrogeology lunar WMS, LROC WAC Global Mosaic (ASU; June 2013, edge update Feb 2016)",
            "source_metadata": "https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/earth/moon_simp_cyl.map&request=GetMetadata&layer=LROC_WAC",
            "request_url": response.url,
            "retrieved_utc": datetime.now(timezone.utc).isoformat(),
            "bounds_lon_lat_east_positive": BOUNDS,
            "image_size_px": SIZE,
            "sha256": sha256(response.content).hexdigest(),
            "bytes": len(response.content),
            "usage": "Optical texture only; elevations and laser footprints come from separate LOLA products.",
        }
        PROVENANCE.write_text(json.dumps(details, indent=2) + "\n")
        print(f"downloaded: {OUT} ({len(response.content):,} bytes)")
    except Exception as exc:
        with FAILURES.open("a") as log:
            log.write(f"{datetime.now(timezone.utc).isoformat()} {type(exc).__name__}: {exc}\n")
        raise


if __name__ == "__main__":
    main()
