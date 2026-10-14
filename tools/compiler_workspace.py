"""Disposable build workspace. Production builds do not run recovery tools."""
import os
import shutil
import tempfile
from pathlib import Path


class CompilerWorkspace:
    def __init__(self, project, keep=False):
        self.project = Path(project).resolve()
        self.base = self.project / '.local' / 'tasks'
        self._check(self.base)
        self.base.mkdir(parents=True, exist_ok=True)
        inherited = os.environ.get('ROGUE_ARTIFACT_SCOPE')
        self.previous = {}
        self.owned = not inherited
        self.keep = keep or os.environ.get('ROGUE_KEEP_ARTIFACTS') == '1'
        if inherited:
            self.directory = Path(inherited).resolve()
            if self.directory.parent != self.base or not (self.directory / 'owner.txt').is_file():
                raise ValueError('Invalid inherited compiler workspace')
            self._check(self.directory)
            self.build = Path(os.environ.get('ROGUE_ARTIFACT_BUILD', self.directory / 'build'))
            return
        self.directory = Path(tempfile.mkdtemp(prefix='python-', dir=self.base))
        self.token = self.directory.name
        (self.directory / 'owner.txt').write_text(self.token, encoding='utf-8')
        self.build = self.project / 'build' if self.keep else self.directory / 'build'
        temp = self.directory / 'temp'
        for folder in (self.build, temp):
            folder.mkdir(parents=True, exist_ok=True)
        settings = {'ROGUE_ARTIFACT_SCOPE': str(self.directory), 'ROGUE_ARTIFACT_BUILD': str(self.build),
                    'CARGO_TARGET_DIR': str(self.directory / 'cargo-target'), 'EM_CACHE': str(self.directory / 'em-cache'),
                    'TEMP': str(temp), 'TMP': str(temp), 'TMPDIR': str(temp), 'PYTHONDONTWRITEBYTECODE': '1',
                    'ROGUE_KEEP_ARTIFACTS': '1' if self.keep else '0'}
        self.previous = {k: os.environ.get(k) for k in settings}
        os.environ.update(settings)

    def _check(self, target):
        if not target.is_relative_to(self.project):
            raise ValueError('Compiler workspace leaves project')
        for p in (target, *target.parents):
            if p == self.project:
                break
            if p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()):
                raise ValueError('Compiler workspace must not traverse links')

    def __enter__(self):
        return self

    def __exit__(self, *_):
        try:
            if self.owned and not self.keep and self.directory.exists():
                self._check(self.directory)
                if self.directory.resolve() != self.directory or (self.directory / 'owner.txt').read_text() != self.token:
                    raise ValueError('Unsafe compiler cleanup target')
                for p in self.directory.rglob('*'):
                    self._check(p)
                shutil.rmtree(self.directory)
        finally:
            for key, value in self.previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
