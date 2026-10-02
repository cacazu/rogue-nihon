"""Record source hashes/diffs without modifying any acquired source file."""
import difflib
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
original = Path(json.loads((ROOT / 'tests/baseline-provenance.json').read_text(encoding='utf-8'))['original_source'])
target = ROOT / 'tests/split-diffs'
target.mkdir(exist_ok=True)
assert target.resolve().parent == (ROOT / 'tests').resolve()
notes = {
    'armor.c': 'Observe completion counters; original armor action/time operations remain.',
    'command.c': 'Persist command statics; observe ticks; literal-format safe recall; semantic help/identify/equipment UI.',
    'daemon.c': 'Use exact Wasm callback signatures; original daemon/fuse schedule retained.',
    'fight.c': 'Observe the already selected monster/combat verb for semantic translation.',
    'io.c': 'Catalog message arguments and UTF-8 UI; bounded buffers; private paging/status runtime accessors.',
    'mach_dep.c': 'Dispatch platform operations to virtual screen and host adapters.',
    'main.c': 'Portable startup, command checkpoints and outcomes; terminal/OS process operations excluded.',
    'mdport.c': 'Dispatch platform operations to virtual screen and host adapters.',
    'misc.c': 'Persist last direction; observe direction prompt/input state.',
    'options.c': 'Semantic settings UI; unsigned ctype; UTF-8 scalar editing within original 50-byte budget.',
    'pack.c': 'Deep-copy labels on stack splitting; observe item selection purpose/input state.',
    'potions.c': 'Observe the already selected effect text and fruit argument for semantic translation.',
    'rip.c': 'Observe outcomes/death cause; semantic ending UI and browser score adapter.',
    'save.c': 'Dispatch browser checkpoint serialization instead of native file/process restoration.',
    'state.c': 'Fixed-width portable serializer, bounded counts/IDs, atomic load and graph ownership cleanup.',
    'things.c': 'Observe item descriptors, discovery/menu rows and waits; persist pagination state.',
}
records = []
for source in sorted(original.glob('*.c')):
    path = ROOT / 'logic' / source.name
    before, after = source.read_bytes(), path.read_bytes()
    sha = lambda value: hashlib.sha256(value).hexdigest()
    same = before == after
    diff = ''.join(difflib.unified_diff(before.decode('utf-8').splitlines(True), after.decode('utf-8').splitlines(True),
                                       fromfile='acquired/' + source.name, tofile='logic/' + source.name))
    (target / (source.name + '.diff')).write_text(diff, encoding='utf-8', newline='\n')
    if not same and source.name not in notes:
        raise ValueError('Uncategorized C change: ' + source.name)
    records.append({'file': source.name, 'original_sha256': sha(before), 'split_sha256': sha(after), 'byte_identical': same,
                    'review_scope': 'original bytes unchanged' if same else notes[source.name],
                    'diff': 'split-diffs/' + source.name + '.diff'})
assert len(records) == 33
new = [{'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
       for path in sorted((ROOT / 'logic').glob('*.c')) if not (original / path.name).exists()]
report = {'schema': 1, 'original_source': str(original), 'original_c_files': records, 'new_c_files': new,
          'limits': ['Hashes and diffs record the source boundary; runtime equivalence is demonstrated only for explicitly executed regression cases.',
                     'Japanese presentation is outside the original English screen comparison.',
                     'UTF-8 editing, safe label ownership and safe percent recall are intentional split-only behavior/extensions.',
                     'Native curses, OS shell/process startup and native score/save file operations have not been executed.']}
(ROOT / 'tests/split-provenance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'original_c_files': len(records), 'byte_identical': sum(record['byte_identical'] for record in records), 'new_c_files': len(new), 'diffs_recorded': 'pass'}))
