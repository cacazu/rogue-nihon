"""Own one disposable compiler/evidence workspace, without sweeping shared folders."""
import os
from pathlib import Path
import shutil
import tempfile
import subprocess


class TemporaryArtifacts:
    def __init__(self, project):
        self.project = Path(project).resolve()
        self.base = self.project / ".local" / "tasks"
        ancestor = self.base
        while not ancestor.exists():
            ancestor = ancestor.parent
        if not ancestor.resolve().is_relative_to(self.project):
            raise ValueError("Artifact parent leaves the project")
        self.base.mkdir(parents=True, exist_ok=True)
        self.base = self.base.resolve()
        self.directory = Path(tempfile.mkdtemp(prefix="python-", dir=self.base))
        self.keep = os.environ.get("ROGUE_KEEP_ARTIFACTS") == "1"
        if os.name == "nt":
            result = subprocess.run([shutil.which("pwsh") or "powershell.exe", "-NoProfile", "-NonInteractive", "-File",
                                     str(self.project / "tools" / "artifact-registry.ps1"), "-Mode", "Register",
                                     "-ProjectPath", str(self.project), "-ScopePath", str(self.directory),
                                     "-OwnerPid", str(os.getpid()), "-Keep", "1" if self.keep else "0"],
                                    check=True, capture_output=True, text=True, timeout=30,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            if result.stdout.strip():
                print(result.stdout.strip(), flush=True)
        temp = self.directory / "temp"
        temp.mkdir()
        settings = {"CARGO_TARGET_DIR": str(self.directory / "cargo-target"),
                    "EM_CACHE": str(self.directory / "em-cache"),
                    "TEMP": str(temp), "TMP": str(temp), "TMPDIR": str(temp),
                    "PYTHONDONTWRITEBYTECODE": "1"}
        self.previous = {key: os.environ.get(key) for key in settings}
        os.environ.update(settings)

    def path(self, relative):
        original = (self.project / relative).resolve()
        if not original.is_relative_to(self.project):
            raise ValueError("Artifact path leaves the project")
        return original if self.keep else self.directory / "artifacts" / original.relative_to(self.project)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        try:
            if self.keep:
                print("Artifacts retained: " + str(self.directory), flush=True)
            elif self.directory.exists():
                resolved = self.directory.resolve()
                if resolved != self.directory or resolved.parent != self.base or not resolved.is_relative_to(self.project):
                    raise ValueError("Unsafe artifact cleanup target")
                marker = resolved / ".rogue-owner.json"
                ownership = marker.read_bytes() if marker.exists() else None
                for entry in resolved.iterdir():
                    if entry == marker:
                        continue
                    if entry.is_dir() and not entry.is_symlink():
                        shutil.rmtree(entry)
                    else:
                        entry.unlink()
                marker.unlink(missing_ok=True)
                try:
                    resolved.rmdir()
                except OSError:
                    if ownership is not None:
                        marker.write_bytes(ownership)
                    raise
        finally:
            for key, value in self.previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
