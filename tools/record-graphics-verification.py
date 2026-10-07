"""Bind completed local checks to the delivered build and generated raster files."""
from pathlib import Path
import hashlib, json, os
from datetime import datetime, timezone

root = Path(__file__).resolve().parent.parent
baseline = Path(os.environ['ROGUE_GRAPHICS_BASELINE']).resolve().parent if 'ROGUE_GRAPHICS_BASELINE' in os.environ else root.parent / 'rogue-graphics-baseline'

def record(path):
    data = path.read_bytes()
    return {'file': str(path.relative_to(root)) if path.is_relative_to(root) else path.name,
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

graphics = json.loads((root/'tests/graphics-output/evidence.json').read_text(encoding='utf-8-sig'))
japanese = json.loads((root/'tests/browser-smoke/output-ja/evidence.json').read_text(encoding='utf-8-sig'))
assert graphics['status'] == japanese['status'] == 'passed'
assert len(graphics['checks']) == 7
assert len(japanese['checks']) == 19
build = [record(root/'build'/name) for name in ('game.js','game.wasm')]
assert {Path(r['file']).name:r['sha256'] for r in build} == {
    r['file']:r['sha256'] for r in japanese['actual_build_files']}
manifest = json.loads((root/'web/assets/tiles/manifest.json').read_text(encoding='utf-8-sig'))
assert len(manifest['entries']) == 49
images = sorted({entry['image'] for entry in manifest['entries']})
assert len(images) == 46
data = {
 'status':'passed', 'recorded_at':datetime.now(timezone.utc).isoformat(),
 'scope':'Rogue image map; local only. No Git commit/push or external deployment.',
 'semantic_ids':49, 'unique_pngs':46, 'tile_dimensions':[96,96],
 'art_generation':{'tool':'built-in image_gen','atlases':5,
                   'prompt_record':'web/assets/tiles/generation-prompts.json',
                   'packing_record':'web/assets/tiles/generation.json'},
 'build':build,
 'baseline':{'commit':'39469d7b4509037aa2b206f47b561133b5d02dc6',
             'files':[record(baseline/name) for name in ('game.js','game.wasm')],
             'local_directory':str(baseline)},
 'logic_comparison':{'seeds':[1,12345,987654321], 'c_state_words':20,
                     'all_trace_words_equal':True, 'original_cells_equal':True,
                     'japanese_save_envelope_exactly_equal':True,
                     'restored_c_state_equal':True, 'redraws_per_seed':25},
 'checks':[
  {'suite':'Node: images, original state/save comparison, real C beams, input transport, localization',
   'passed':20,'failed':0,'skipped':0,
   'command':'node --test tests/tiles.test.mjs tests/graphics-logic.test.mjs tests/graphics-beams.test.mjs tests/browser-smoke/host.test.mjs tests/browser-smoke/localization.test.mjs',
   'environment':{'ROGUE_GRAPHICS_BASELINE':str(baseline/'game.js')}},
  {'suite':'Pure Rust map semantics','passed':4,'failed':0,
   'command':'rustc --edition=2024 --test rust/src/map_tiles.rs -o build/map-tiles-tests.exe; build/map-tiles-tests.exe'},
  {'suite':'Rust formatting and lint','status':'passed',
   'commands':['cargo fmt --manifest-path rust/Cargo.toml --check','cargo clippy --offline --manifest-path rust/Cargo.toml --lib -- -D warnings']},
  {'suite':'Actual Chrome graphical map','passed':7,'failed':0,
   'evidence':'tests/graphics-output/evidence.json','checks':graphics['checks']},
  {'suite':'Actual Chrome Japanese UI/save/replay','passed':19,'failed':0,
   'evidence':'tests/browser-smoke/output-ja/evidence.json','checks':japanese['checks']}
 ],
 'screenshots':[record(root/'tests/graphics-output'/name) for name in graphics['screenshots']],
 'contact_sheet':record(root/'web/assets/tiles/contact-sheet.png'),
 'assets':[record(root/'web/assets/tiles'/name) for name in images],
 'source_atlases':[record(p) for p in sorted((root/'web/assets/tiles/source').glob('*.png'))],
 'limitations':['Three seeded old/new scripts plus one Japanese save scenario are not exhaustive playthrough equivalence.',
                 'The 49-ID gallery is synthetic. It does not claim natural encounters with all 26 monsters.',
                 'Mobile viewports were emulated in desktop Chrome, not tested on every physical device.',
                 'Legacy verification.json is retained as historical evidence for the pre-graphics build.']
}
(root/'graphics-verification.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Recorded 49 IDs / 46 PNGs; 20 Node + 4 Rust + 7 graphics browser + 19 Japanese browser checks')
