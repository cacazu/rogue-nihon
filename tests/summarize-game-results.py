"""Summarize passing actual-game runs; bind every raw result to current modules."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def module(name):
    return {'javascript_sha256': digest(ROOT / 'build' / (name + '.js')),
            'wasm_sha256': digest(ROOT / 'build' / (name + '.wasm'))}

modules = {name: module(name) for name in ('game', 'baseline', 'game-fixtures', 'baseline-fixtures')}

def run_counts(file):
    text = file.read_text(encoding='utf-8-sig')
    counts = {}
    for key in ('tests', 'pass', 'fail', 'skipped'):
        # Reporter prefixes may be transcoded by the host console. Require a
        # decorative prefix followed by the complete numeric summary line.
        matches = re.findall(r'(?m)^(?:# |[^\x00-\x7f]+\s)' + key + r' (\d+)\s*$', text)
        assert len(matches) == 1, (file.name, key, matches)
        counts[key] = int(matches[0])
    assert counts['tests'] == counts['pass'] > 0 and counts['fail'] == counts['skipped'] == 0, counts
    return counts

def record(path):
    return {'file': path.relative_to(ROOT).as_posix(), 'sha256': digest(path), 'bytes': path.stat().st_size}

def result(path, module_name):
    value = read(path)
    assert value['module'] == modules[module_name], str(path)
    return value

def pair(label, directory, split_name, baseline_name):
    actual_path, original_path = directory / f'{label}-split.json', directory / f'{label}-baseline.json'
    actual, original = result(actual_path, split_name), result(original_path, baseline_name)
    return {'case': label, 'seed': actual['seed'], 'traces': len(actual['traces']), 'frames': len(actual['frames']),
            'consumed': actual['consumed'], 'split_module': actual['module'], 'baseline_module': original['module'],
            'raw_files': [record(actual_path), record(original_path)]}

run_logs = [TESTS / name for name in ('final-game-run.txt', 'final-localization-run.txt', 'final-more-localization-run.txt')]
counts = [run_counts(path) for path in run_logs]
normal = []
for index in range(8):
    actual_path = TESTS / 'actual-results' / f'split-{index}.json'
    original_path = TESTS / 'actual-results' / f'baseline-{index}.json'
    actual, original = result(actual_path, 'game'), result(original_path, 'baseline')
    normal.append({'case': index, 'seed': actual['seed'], 'traces': len(actual['traces']), 'frames': len(actual['frames']),
                   'consumed': actual['consumed'], 'split_module': actual['module'], 'baseline_module': original['module'],
                   'raw_files': [record(actual_path), record(original_path)]})
fixture_labels = ('wall-free', 'initial-haste', 'haste-potion', 'double-haste', 'sleep-haste', 'count-255', 'count-free',
                  'direction-repeat', 'armor-time', 'mean-wake', 'medusa-gaze', 'hallu-more')
fixtures = [pair(label, TESTS / 'fixture-results', 'game-fixtures', 'baseline-fixtures') for label in fixture_labels]
japanese = []
for label in ('help-options-menu', 'japanese-label-backspace', 'japanese-text-save', 'japanese-player-name', 'japanese-player-name-unchanged'):
    path = TESTS / 'ui-results' / (label + '.json')
    value = result(path, 'game')
    files = [path]
    if label == 'help-options-menu': files.append(TESTS / 'ui-results' / 'help-options-menu-en.json')
    if label == 'japanese-text-save': files.append(TESTS / 'ui-results' / 'japanese-text-restored.json')
    for file in files: result(file, 'game')
    japanese.append({'case': label, 'module_role': 'main', 'split_module': value['module'],
                     'comparison': 'locale_same_C_state' if label == 'help-options-menu' else 'split_only_utf8',
                     'traces': len(value['traces']), 'frames': len(value['frames']), 'raw_files': [record(file) for file in files]})
for label in ('tombstone', 'plain-death', 'victory', 'combat', 'see-invisible-custom', 'see-invisible-plain'):
    directory = TESTS / 'localization-results'
    files = [directory / (label + '-ja.json'), directory / (label + '-en.json')]
    value = result(files[0], 'game-fixtures')
    result(files[1], 'game-fixtures')
    case = {'case': label, 'module_role': 'fixture', 'split_module': value['module'],
            'comparison': 'locale_same_C_state' if label == 'see-invisible-custom' else 'original_rule_baseline',
            'traces': len(value['traces']), 'frames': len(value['frames'])}
    if label != 'see-invisible-custom':
        files.append(directory / (label + '-baseline.json'))
        case['baseline_module'] = result(files[-1], 'baseline-fixtures')['module']
    case['raw_files'] = [record(file) for file in files]
    japanese.append(case)

more_directory = TESTS / 'more-localization-results'
more_paths = [more_directory / (name + '.json') for name in
              ('actual-more-ja-original', 'actual-more-ja-restored', 'actual-more-en-original', 'actual-more-baseline')]
more = result(more_paths[0], 'game-fixtures')
for path in more_paths[1:3]: result(path, 'game-fixtures')
more_baseline = result(more_paths[-1], 'baseline-fixtures')
japanese.append({'case': 'actual-more-save-restore', 'module_role': 'fixture',
                 'split_module': more['module'], 'baseline_module': more_baseline['module'],
                 'comparison': 'original_rule_baseline', 'traces': len(more['traces']), 'frames': len(more['frames']),
                 'raw_files': [record(path) for path in more_paths]})

summary = {'tested_at_utc': datetime.now(timezone.utc).isoformat(),
    'game_tests': sum(count['tests'] for count in counts), 'passed': sum(count['pass'] for count in counts),
    'failed': 0, 'skipped': 0, 'baseline_source_checks': len(read(TESTS / 'baseline-source-audit.json')['files']),
    'byte_identical_original_c_files': sum(item['byte_identical'] and item['file'].endswith('.c') for item in read(TESTS / 'baseline-provenance.json')['original_files']),
    'normal_cases': normal, 'fixture_cases': fixtures, 'japanese_cases': japanese,
    'restore_cases': ['wield-midprompt', 'food-equipped', 'direction-repeat', 'inventory-midprompt',
                     'haste-midcommand', 'haste-midpotion', 'hallucination-command-boundary', 'japanese-text', 'actual-more-ja'],
    'split_only_safety': ['label-split', 'percent-recall', 'see-invisible-custom-percent-fruit'],
    'comparison_fields': ['all20u32', 'input_index', 'every_original_English_cells_width_height_player_stats', 'final_state', 'outcome_code'],
    'run_logs': [record(path) for path in run_logs],
    'limitations': ['shared knowledge/OS/save adapters are not an independent native curses baseline',
        'induced fixtures do not establish a natural seed path to each effect',
        'not exhaustive combinations; cursedT/hasteexpirywear/directlookFalseafterFalse/msgEscTrue branches remain outside fixture suite',
        'Historical hallu-more/hallu-midmore raw filenames cover hallucination command redraw/boundary restore, not a hallucinated --More-- wait; double-haste covers actual More input',
        'Japanese UI metadata and UTF8 text editing are separate from original ASCII rule equivalence',
        'Custom percent-bearing fruit, label ownership and recalled percent text are split-only safety tests; original printf undefined behavior is not executed as a golden'],
    'final_product_rebuild': 'All listed actual-game suites rerun against current main/fixture artifacts; raw results and module hashes bound to current files'}

# Bind supporting records too: determinism/repaint, free actions, rejected
# checksum, every restore pair, and split-only ownership/percent safety.
raw_results = []
for dirname in ('actual-results', 'fixture-results', 'ui-results', 'localization-results', 'more-localization-results'):
    for path in sorted((TESTS / dirname).glob('*.json')):
        if dirname == 'actual-results':
            role = 'baseline' if path.name.startswith('baseline-') else 'game'
        elif dirname == 'ui-results':
            role = 'game'
        else:
            role = 'baseline-fixtures' if path.stem.endswith('-baseline') else 'game-fixtures'
        value = result(path, role)
        raw_results.append({**record(path), 'module_role': role, 'module': value['module']})
summary['all_raw_results'] = raw_results
(TESTS / 'game-results-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'game_tests': summary['game_tests'], 'passed': summary['passed'], 'japanese_cases': len(japanese),
                  'main_wasm_sha256': modules['game']['wasm_sha256']}))
