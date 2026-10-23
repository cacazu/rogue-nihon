"""Acquire and verify the pinned Rogue 5.4.4 source; never overwrite local edits."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import stat
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
SOURCE_NAME = "rogue5.4.4"
ARCHIVE_NAME = "rogue5.4.4-src.tar.gz"
URL = "https://distfiles.macports.org/rogue/" + ARCHIVE_NAME
SIZE = 209839
SHA256 = "7d37a61fc098bda0e6fac30799da347294067e8e079e4b40d6c781468e08e8a1"


def verify_archive(data: bytes) -> None:
    if len(data) != SIZE or hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("Rogue original archive size/SHA-256 mismatch; existing cache was not replaced")


def archive_files(data: bytes) -> dict[Path, bytes]:
    """Read regular files only, before creating any extracted path."""
    files = {}
    seen = set()
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive.getmembers():
            name = member.name
            parts = PurePosixPath(name).parts
            if (not parts or parts[0] != SOURCE_NAME or name.startswith("/") or
                    "\\" in name or ":" in name or ".." in parts or
                    any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))):
                raise ValueError(f"Unsafe original archive path: {name!r}")
            if name.rstrip("/") in seen or not (member.isdir() or member.isfile()):
                raise ValueError(f"Duplicate or non-regular original archive member: {name!r}")
            seen.add(name.rstrip("/"))
            if member.isdir():
                continue
            if len(parts) == 1:
                raise ValueError("Original archive root must be a directory")
            total += member.size
            if member.size < 0 or total > 8 * 1024 * 1024 or len(files) >= 256:
                raise ValueError("Original archive exceeds extraction limits")
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"Missing original archive bytes: {name}")
            body = source.read(member.size + 1)
            if len(body) != member.size:
                raise ValueError(f"Incorrect original archive member length: {name}")
            files[Path(*parts[1:])] = body
    if not files:
        raise ValueError("Original archive has no source files")
    return files


def verify_provenance(files: dict[Path, bytes]) -> None:
    manifest = json.loads((ROOT / "tests/baseline-provenance.json").read_text(encoding="utf-8"))
    for record in manifest["original_files"]:
        body = files.get(Path(record["file"]))
        if body is None or hashlib.sha256(body).hexdigest() != record["original_sha256"]:
            raise ValueError(f"Original source differs from baseline provenance: {record['file']}")


def checked_path(path: Path) -> Path:
    absolute = path.absolute()
    if absolute.resolve() != absolute:
        raise ValueError(f"Cache path contains a link or non-canonical component: {path}")
    return absolute


def acquire(cache: Path) -> Path:
    cache = checked_path(cache)
    archive_path = cache / ARCHIVE_NAME
    if archive_path.exists():
        if not stat.S_ISREG(archive_path.lstat().st_mode):
            raise ValueError("Original archive cache must be a regular file")
        with archive_path.open("rb") as source:
            data = source.read(SIZE + 1)
        downloaded = False
    else:
        with urlopen(URL, timeout=30) as response:
            data = response.read(SIZE + 1)
        downloaded = True
    verify_archive(data)
    files = archive_files(data)
    verify_provenance(files)
    target = checked_path(cache / SOURCE_NAME)
    if target.exists():
        if not target.is_dir():
            raise ValueError("Original source cache must be a directory")
        # Inspect all existing entries before adding missing files. Reject local
        # edits/links/extra files instead of replacing or deleting anything.
        for existing in target.rglob("*"):
            checked_path(existing)
            mode = existing.lstat().st_mode
            if stat.S_ISDIR(mode):
                continue
            relative = existing.relative_to(target)
            if not stat.S_ISREG(mode) or relative not in files or existing.read_bytes() != files[relative]:
                raise ValueError(f"Original source cache has unexpected or modified content: {relative}")
    cache.mkdir(parents=True, exist_ok=True)
    if downloaded:
        with archive_path.open("xb") as output:
            output.write(data)
    target.mkdir(exist_ok=True)
    for relative, body in files.items():
        destination = checked_path(target / relative)
        if destination.exists():
            if not destination.is_file() or destination.read_bytes() != body:
                raise ValueError(f"Original source cache differs: {relative}")
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as output:
            output.write(body)
    print(json.dumps({"source": str(target), "archive_sha256": SHA256,
                      "archive_bytes": SIZE, "source_files": len(files), "downloaded": downloaded}))
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / "upstream",
                        help="local acquisition cache (default: upstream/ inside this checkout)")
    acquire(parser.parse_args().cache)


if __name__ == "__main__":
    main()
