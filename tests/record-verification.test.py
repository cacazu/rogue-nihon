"""Test evidence parsing with synthetic records; never claim gameplay was run."""
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'tools/record-verification.py'
SPEC = importlib.util.spec_from_file_location('record_verification', SCRIPT)
recorder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recorder)


class VerificationRecorderTests(unittest.TestCase):
    def test_duplicate_json_keys_fail(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            json.loads('{"tests":{"same":1,"same":2}}', object_pairs_hook=recorder.unique_object)

    def test_files_are_hash_bound_and_duplicate_records_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'evidence.txt'
            path.write_text('recorded result', encoding='utf-8')
            evidence = {'file': path.name, 'bytes': path.stat().st_size, 'sha256': recorder.digest(path)}
            self.assertEqual(set(recorder.checked_files([evidence], root)), {path.name})
            with self.assertRaisesRegex(ValueError, 'Duplicate evidence file'):
                recorder.checked_files([evidence, evidence], root)
            path.write_text('newer result', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Evidence file changed'):
                recorder.checked_files([evidence], root)

    def test_paths_cannot_leave_the_evidence_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(recorder.local_path('nested/file.txt', root), (root/'nested/file.txt').resolve())
            with self.assertRaisesRegex(ValueError, 'leaves its allowed directory'):
                recorder.local_path('../outside.txt', root)

    def test_product_file_names_are_derived(self):
        files = {'renamed.cjs': {'sha256': 'js'}, 'renamed.wasm': {'sha256': 'wasm'}}
        self.assertEqual(recorder.module_hashes(files), {'wasm_sha256': 'wasm', 'javascript_sha256': 'js'})
        with self.assertRaisesRegex(ValueError, 'one Wasm and one JavaScript'):
            recorder.module_hashes({**files, 'extra.wasm': {'sha256': 'extra'}})

    def test_browser_counts_are_derived_and_artifacts_must_match(self):
        output = {'game.js': {'file': 'game.js', 'bytes': 7, 'sha256': 'sha'}}
        browser = {'status': 'passed', 'checks': ['one', 'two', 'three'],
                   'started_at': 'start', 'finished_at': 'finish', 'actual_build_files': list(output.values())}
        with mock.patch.object(recorder, 'checked_files', return_value=output):
            self.assertEqual(recorder.check_browser(browser, output)['passed'], 3)
            with self.assertRaisesRegex(ValueError, 'duplicate check names'):
                recorder.check_browser({**browser, 'checks': ['one', 'one']}, output)
            with self.assertRaisesRegex(ValueError, 'different artifact'):
                recorder.check_browser(browser, {'game.js': {'bytes': 7, 'sha256': 'new'}})

    @staticmethod
    def game():
        product = {'wasm_sha256': 'main-wasm', 'javascript_sha256': 'main-js'}
        fixture = {'wasm_sha256': 'fixture-wasm', 'javascript_sha256': 'fixture-js'}
        original = {'wasm_sha256': 'base-wasm', 'javascript_sha256': 'base-js'}
        original_fixture = {'wasm_sha256': 'base-fixture-wasm', 'javascript_sha256': 'base-fixture-js'}
        game = {'game_tests': 4, 'passed': 4, 'failed': 0, 'skipped': 0,
                'normal_cases': [{'case': 0, 'split_module': product, 'baseline_module': original}],
                'fixture_cases': [{'case': 'effect', 'split_module': fixture, 'baseline_module': original_fixture}],
                'all_raw_results': [
                    {'file': 'tests/ui-results/help.json', 'sha256': 'raw', 'bytes': 10, 'module_role': 'game', 'module': product},
                    {'file': 'tests/ui-results/death.json', 'sha256': 'raw', 'bytes': 20, 'module_role': 'game-fixtures', 'module': fixture},
                    {'file': 'tests/raw/baseline.json', 'sha256': 'raw', 'bytes': 30, 'module_role': 'baseline', 'module': original},
                    {'file': 'tests/raw/baseline-fixture.json', 'sha256': 'raw', 'bytes': 40, 'module_role': 'baseline-fixtures', 'module': original_fixture}]}
        return game, product, fixture, original, original_fixture

    def test_game_totals_and_cases_are_derived(self):
        with mock.patch.object(recorder, 'checked_files', side_effect=lambda items: {item['file']: item for item in items}):
            result = recorder.check_game(*self.game())
        self.assertEqual((result['passed'], result['normal_cases'], result['fixture_comparisons']), (4, 1, 1))

    def test_game_failure_skips_and_stale_modules_fail(self):
        for field, value in (('failed', 1), ('skipped', 1), ('game_tests', 5), ('passed', True)):
            args = list(self.game())
            args[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                recorder.check_game(*args)
        args = list(self.game())
        args[0]['normal_cases'][0]['split_module'] = {'wasm_sha256': 'old', 'javascript_sha256': 'old'}
        with self.assertRaisesRegex(ValueError, 'different product'):
            recorder.check_game(*args)

    def test_japanese_cases_require_current_modules_raw_files_and_comparison_scope(self):
        args = list(self.game())
        args[0]['japanese_cases'] = [
            {'case': 'help', 'module_role': 'main', 'split_module': args[1], 'comparison': 'locale_same_C_state',
             'raw_files': [{'file': 'tests/ui-results/help.json', 'sha256': 'raw', 'bytes': 10}]},
            {'case': 'death', 'module_role': 'fixture', 'split_module': args[2], 'comparison': 'original_rule_baseline',
             'baseline_module': args[4], 'raw_files': [{'file': 'tests/ui-results/death.json', 'sha256': 'raw', 'bytes': 20}]}]
        with mock.patch.object(recorder, 'checked_files', side_effect=lambda items: {item['file']: item for item in items}):
            self.assertEqual(recorder.check_game(*args)['japanese_cases'], 2)
            for changes in ({'module_role': 'unknown'}, {'split_module': args[2]}, {'comparison': 'unverified'}):
                broken = copy.deepcopy(args)
                broken[0]['japanese_cases'][0].update(changes)
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    recorder.check_game(*broken)
            broken = copy.deepcopy(args)
            del broken[0]['japanese_cases'][1]['baseline_module']
            with self.assertRaisesRegex(ValueError, 'lacks the baseline artifact'):
                recorder.check_game(*broken)
            with mock.patch.object(recorder, 'checked_files', side_effect=ValueError('Evidence file changed')):
                with self.assertRaisesRegex(ValueError, 'Evidence file changed'):
                    recorder.check_game(*args)

    def test_supporting_raw_modules_and_japanese_join_are_validated(self):
        with mock.patch.object(recorder, 'checked_files', side_effect=lambda items: {item['file']: item for item in items}):
            for change in ({'module': {'wasm_sha256': 'old', 'javascript_sha256': 'old'}}, {'module_role': 'unknown'}):
                args = list(self.game())
                args[0]['all_raw_results'][0].update(change)
                with self.subTest(change=change), self.assertRaises(ValueError):
                    recorder.check_game(*args)
            args = list(self.game())
            args[0]['japanese_cases'] = [{'case': 'missing-raw', 'module_role': 'main', 'split_module': args[1],
                'comparison': 'locale_same_C_state', 'raw_files': [{'file': 'not-indexed.json', 'sha256': 'x', 'bytes': 1}]}]
            with self.assertRaisesRegex(ValueError, 'complete result inventory'):
                recorder.check_game(*args)

    @staticmethod
    def save_runs():
        runs = ['ALLOC fault_injections=3\n' + json.dumps({'save_adapter': 'pass', 'seed': 10, 'checks': 20, 'repeated_loads': 2}),
                'ALLOC fault_injections=4\n' + json.dumps({'save_adapter': 'pass', 'seed': 20, 'checks': 30, 'repeated_loads': 3})]
        manifest = {'checks': 50, 'seeds': 2, 'allocation_faults': 7, 'repeated_loads': 5,
                    'sources': [{'file': 'source.c', 'sha256': 'sha'}]}
        return manifest, runs

    def test_save_totals_come_from_raw_logs(self):
        with mock.patch.object(recorder, 'checked_files', return_value={}):
            result = recorder.check_saves(*self.save_runs())
        self.assertEqual((result['checks'], result['seeds'], result['allocation_faults'], result['repeated_loads']),
                         (50, 2, 7, 5))

    def test_save_missing_failure_duplicate_and_wrong_totals_fail(self):
        manifest, runs = self.save_runs()
        with mock.patch.object(recorder, 'checked_files', return_value={}):
            variants = [[], runs + [runs[0]], [runs[0].replace('"pass"', '"fail"'), runs[1]],
                        [runs[0].replace('fault_injections=3', ''), runs[1]]]
            for raw in variants:
                with self.subTest(raw=raw), self.assertRaises(ValueError):
                    recorder.check_saves(manifest, raw)
            with self.assertRaisesRegex(ValueError, 'totals differ'):
                recorder.check_saves({**manifest, 'checks': 6176}, runs)

    def test_missing_optional_evidence_never_becomes_a_pass(self):
        self.assertTrue(all(result['status'] == 'unrecorded'
                            for result in recorder.supplementary_tests(None).values()))

    def test_supplementary_success_requires_exit_log_and_bound_input(self):
        result = {'status': 'passed', 'exit_code': 0, 'passed': 6,
                  'files': [{'path': 'tests/test.py', 'sha256': 'source'},
                            {'path': 'build/test.log', 'sha256': 'log'}]}
        evidence = {'schema': 1, 'tests': {'localization': result}}
        with mock.patch.object(recorder, 'read_json', return_value=evidence), \
             mock.patch.object(recorder, 'checked_files', return_value={}), \
             mock.patch.object(recorder, 'record', return_value={'path': 'test-evidence.json', 'sha256': 'sha'}):
            self.assertEqual(recorder.supplementary_tests(Path('evidence.json'))['localization']['passed'], 6)
            for invalid in ({'exit_code': 1}, {'status': 'unrecorded'}, {'passed': True},
                            {'files': [{'path': 'build/test.log', 'sha256': 'log'}]},
                            {'files': [{'path': 'tests/test.py', 'sha256': 'source'}]}):
                broken = copy.deepcopy(evidence)
                broken['tests']['localization'].update(invalid)
                with self.subTest(invalid=invalid), mock.patch.object(recorder, 'read_json', return_value=broken), self.assertRaises(ValueError):
                    recorder.supplementary_tests(Path('evidence.json'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
