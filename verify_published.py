"""Check the bounded GitHub release against its acquisition manifest."""
import hashlib
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent / "data" / "full"
manifest = json.loads((root / "manifest.json").read_text())
accepted = rejected = 0
with zipfile.ZipFile(root / "rejected-records.zip") as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(manifest["chunks"])
    for entry in manifest["chunks"]:
        binary = (root / entry["binary"]).read_bytes()
        assert hashlib.sha256(binary).hexdigest() == entry["binary_sha256"], entry["id"]
        assert len(binary) == entry["counts"]["accepted"] * entry["record_bytes"], entry["id"]
        accepted += entry["counts"]["accepted"]
        name = Path(entry["rejected"]).name
        records = archive.read(name)
        assert hashlib.sha256(records).hexdigest() == entry["rejected_sha256"], entry["id"]
        assert records.count(b"\n") == entry["counts"]["rejected"], entry["id"]
        rejected += entry["counts"]["rejected"]
assert accepted == manifest["counts"]["accepted"]
assert rejected == manifest["counts"]["rejected"]
print(f"Verified {accepted:,} accepted and {rejected:,} rejected entries across {len(manifest['chunks'])} batches")
