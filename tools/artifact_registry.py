"""Register and recover only abandoned, explicitly owned test workspaces."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid


def query(pid):
    if os.name == 'nt':
        from ctypes import wintypes as w
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = w.HANDLE
        kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        kernel.CloseHandle.argtypes = [w.HANDLE]
        kernel.GetProcessTimes.argtypes = [w.HANDLE, *([ctypes.POINTER(w.FILETIME)] * 4)]
        kernel.GetExitCodeProcess.argtypes = [w.HANDLE, ctypes.POINTER(w.DWORD)]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return {'pid': pid, 'status': 'gone' if ctypes.get_last_error() == 87 else 'unknown'}
        try:
            code = w.DWORD()
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
                return {'pid': pid, 'status': 'unknown'}
            if code.value != 259:
                return {'pid': pid, 'status': 'gone'}
            times = [w.FILETIME() for _ in range(4)]
            if not kernel.GetProcessTimes(handle, *[ctypes.byref(t) for t in times]):
                return {'pid': pid, 'status': 'unknown'}
            class UnicodeString(ctypes.Structure):
                _fields_ = [('length', w.USHORT), ('maximum', w.USHORT), ('buffer', ctypes.c_void_p)]
            native = ctypes.WinDLL('ntdll').NtQueryInformationProcess
            native.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.ULONG, ctypes.POINTER(w.ULONG)]
            size = w.ULONG()
            native(handle, 60, None, 0, ctypes.byref(size))
            command = ''
            if 0 < size.value < 1024 * 1024:
                buffer = ctypes.create_string_buffer(size.value)
                if native(handle, 60, buffer, size, ctypes.byref(size)) == 0:
                    text = UnicodeString.from_buffer(buffer)
                    command = ctypes.wstring_at(text.buffer, text.length // 2)
            return {'pid': pid, 'status': 'alive', 'start': str((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime), 'command': command}
        finally:
            kernel.CloseHandle(handle)
    if Path('/proc').is_dir():
        try:
            stat = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
            command = Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
            return {'pid': pid, 'parent': int(stat[1]), 'status': 'gone' if stat[0] == 'Z' else 'alive', 'start': stat[19], 'command': command}
        except FileNotFoundError:
            return {'pid': pid, 'status': 'gone'}
        except OSError:
            return {'pid': pid, 'status': 'unknown'}
    try:
        result = subprocess.run(['ps', '-p', str(pid), '-o', 'pid=,ppid=,lstart=,args='], capture_output=True, text=True, check=False)
        if not result.stdout.strip():
            return {'pid': pid, 'status': 'gone' if result.returncode == 1 else 'unknown'}
        row = result.stdout.strip().split(None, 7)
        start = str(int(time.mktime(time.strptime(' '.join(row[2:7]), '%a %b %d %H:%M:%S %Y'))))
        return {'pid': pid, 'parent': int(row[1]), 'status': 'alive', 'start': start, 'command': row[7] if len(row) > 7 else ''}
    except (OSError, ValueError):
        return {'pid': pid, 'status': 'unknown'}


def snapshot():
    if os.name == 'nt':
        from ctypes import wintypes as w
        class Entry(ctypes.Structure):
            _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('pid', w.DWORD), ('heap', ctypes.c_size_t), ('module', w.DWORD), ('threads', w.DWORD), ('parent', w.DWORD), ('priority', w.LONG), ('flags', w.DWORD), ('exe', w.WCHAR * 260)]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
        kernel.CloseHandle.argtypes = [w.HANDLE]
        for name in ('Process32FirstW', 'Process32NextW'):
            getattr(kernel, name).argtypes = [w.HANDLE, ctypes.POINTER(Entry)]
        handle = kernel.CreateToolhelp32Snapshot(2, 0)
        if handle == ctypes.c_void_p(-1).value:
            raise OSError('Process list is restricted')
        try:
            entry = Entry(); entry.size = ctypes.sizeof(entry)
            if not kernel.Process32FirstW(handle, ctypes.byref(entry)):
                raise OSError('Process list is restricted')
            result = []
            while True:
                state = query(entry.pid); state['parent'] = entry.parent; result.append(state)
                if not kernel.Process32NextW(handle, ctypes.byref(entry)):
                    break
            if ctypes.get_last_error() != 18:
                raise OSError('Process enumeration failed')
            # Sandboxed process lists may omit surviving jobs and children.
            # Such a snapshot is insufficient evidence for deleting a workspace.
            if not any(s['pid'] == 4 for s in result):
                raise OSError('Process list is restricted')
            return result
        finally:
            kernel.CloseHandle(handle)
    if Path('/proc').is_dir():
        return [query(int(p.name)) for p in Path('/proc').iterdir() if p.name.isdigit()]
    result = subprocess.run(['ps', '-e', '-o', 'pid='], capture_output=True, text=True, check=True)
    return [query(int(pid)) for pid in result.stdout.split()]


def safe_path(project, directory, tree=False):
    if directory.parent != project / '.local' / 'tasks' or directory.resolve() != directory:
        return False
    for p in (directory, *directory.parents):
        if p == project:
            break
        if p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()):
            return False
    if tree:
        return all(not p.is_symlink() and not (hasattr(p, 'is_junction') and p.is_junction()) for p in directory.rglob('*'))
    return True


def record_for(project, directory):
    if not re.fullmatch(r'(node|python)-[a-zA-Z0-9_-]+', directory.name) or not safe_path(project, directory):
        return None
    marker = directory / '.rogue-owner.json'
    if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 65536:
        return None
    r = json.loads(marker.read_text(encoding='utf-8'))
    if (type(r.get('version')) is not int or r['version'] != 1 or r.get('project') != str(project) or r.get('directory') != directory.name or
        type(r.get('keep')) is not bool or type(r.get('owner_pid')) is not int or not 0 < r['owner_pid'] < 2**32 or
        not isinstance(r.get('owner_start'), str) or not re.fullmatch(r'\d+', r['owner_start']) or
        not isinstance(r.get('token'), str) or not re.fullmatch(r'[a-f0-9]{32}', r['token'])):
        return None
    return r


def remove_contents(directory, record):
    """Keep metadata until removal completes so a failed cleanup can retry."""
    marker = directory / '.rogue-owner.json'
    for entry in directory.iterdir():
        if entry != marker and entry.name != '.recovery-lock':
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    # Recovery releases its lock before deleting the empty directory.
    (directory / '.recovery-lock').rmdir()
    marker.unlink()
    try:
        directory.rmdir()
    except OSError:
        marker.write_text(json.dumps(record), encoding='utf-8')
        raise


def recover(project):
    project = Path(project).resolve()
    base = project / '.local' / 'tasks'
    if not base.exists() or base.is_symlink() or base.resolve() != base:
        return
    candidates = []
    for directory in base.iterdir():
        try:
            r = record_for(project, directory)
            if not r or r['keep']:
                continue
            state = query(r['owner_pid'])
            if state['status'] == 'unknown' or (state['status'] == 'alive' and state['start'] == r['owner_start']):
                continue
            candidates.append((directory, r))
        except (OSError, ValueError, TypeError):
            continue
    if not candidates:
        return
    try:
        processes = snapshot()
    except (OSError, subprocess.SubprocessError) as error:
        print('Temporary artifact recovery deferred: ' + str(error), file=sys.stderr)
        return
    for directory, record in candidates:
        lock = directory / '.recovery-lock'
        claimed = False
        try:
            state = query(record['owner_pid'])
            if state['status'] == 'unknown' or (state['status'] == 'alive' and state['start'] == record['owner_start']):
                continue
            descendants = {record['owner_pid']}
            while True:
                updated = descendants | {s['pid'] for s in processes if s.get('parent') in descendants}
                if updated == descendants:
                    break
                descendants = updated
            busy = any((s['pid'] != record['owner_pid'] and s['pid'] in descendants and s['status'] != 'gone') or str(directory).replace('\\', '/').casefold() in s.get('command', '').replace('\\', '/').casefold() for s in processes)
            if busy or not safe_path(project, directory, tree=True):
                continue
            lock.mkdir(); claimed = True
            if record_for(project, directory) == record:
                remove_contents(directory, record)
        except (OSError, ValueError, TypeError):
            pass  # Busy/unknown paths are retained; another invocation can retry.
        finally:
            if claimed and lock.exists():
                lock.rmdir()


def register(project, directory, pid, keep=False):
    project, directory = Path(project).resolve(), Path(directory).absolute()
    if not safe_path(project, directory) or not re.fullmatch(r'(node|python)-[a-zA-Z0-9_-]+', directory.name):
        raise ValueError('Unsafe artifact registration target')
    state = query(pid)
    if state['status'] != 'alive':
        raise ValueError('Cannot identify artifact owner')
    record = {'version': 1, 'project': str(project), 'directory': directory.name, 'owner_pid': pid, 'owner_start': state['start'], 'keep': keep, 'token': uuid.uuid4().hex}
    with (directory / '.rogue-owner.json').open('x', encoding='utf-8') as stream:
        json.dump(record, stream)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['register', 'recover', 'query', 'snapshot'])
    parser.add_argument('--project', type=Path)
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--pid', type=int, default=os.getpid())
    parser.add_argument('--keep', action='store_true')
    args = parser.parse_args()
    if args.mode == 'query':
        print(json.dumps(query(args.pid)))
    elif args.mode == 'snapshot':
        print(json.dumps(snapshot()))
    else:
        recover(args.project)
        if args.mode == 'register':
            register(args.project, args.directory, args.pid, args.keep)
