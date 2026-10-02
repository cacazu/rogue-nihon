"""Validate source-bound UI IDs and actual Japanese catalog encodings."""
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
catalogs = []
for language in ('en', 'ja'):
    raw = (ROOT / 'locales' / f'ui-game-{language}.json').read_bytes()
    assert not raw.startswith(b'\xef\xbb\xbf')
    value = json.loads(raw.decode('utf-8'))
    assert value['schema'] == 1 and value['language'] == language
    assert '\ufffd' not in raw.decode('utf-8')
    catalogs.append(value['messages'])
en, ja = catalogs
assert en.keys() == ja.keys()
for key in en:
    assert re.findall(r'\{\d+\}', en[key]['template']) == re.findall(r'\{\d+\}', ja[key]['template']), key
    if key not in {'ui.text', 'ui.help.entry', 'ui.inventory.entry'}:
        assert re.search(r'[\u3040-\u30ff\u3400-\u9fff]', ja[key]['template']), key

command = (ROOT / 'logic' / 'command.c').read_text(encoding='utf-8')
ids = re.findall(r'"(help\.[a-z_]+)"', command.split('rg_help_ids[] = {', 1)[1].split('\n};', 1)[0])
table = (ROOT / 'logic' / 'extern.c').read_text(encoding='utf-8').split('struct h_list helpstr[] = {', 1)[1].split('\n};', 1)[0]
descriptions = [ast.literal_eval('"' + value + '"') for value in re.findall(r"\{(?:'(?:\\.|[^'])+'|CTRL\('[^']'\)|ESCAPE),\s*\"((?:[^\"\\]|\\.)*)\"", table)]
assert len(ids) == len(descriptions) == 65
assert len(set(ids)) == 65
for key, source in zip(ids, descriptions):
    assert en[key]['template'] == source, key

used = set()
for file in ('command.c', 'things.c', 'options.c', 'pack.c', 'misc.c'):
    source = (ROOT / 'logic' / file).read_text(encoding='utf-8')
    used.update(re.findall(r'"((?:help|identify|options|discoveries|action|equipment|prompt|input)\.[a-z_.]+)"', source))
assert used <= en.keys(), sorted(used - en.keys())
print(json.dumps({'catalog_ids': len(en), 'help_originals': 65, 'english_source_match': 'pass',
                  'japanese_encoding_and_placeholder_parity': 'pass', 'c_ui_id_coverage': 'pass'}))
