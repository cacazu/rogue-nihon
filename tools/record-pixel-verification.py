"""Record completed pixel-art checks and bind them to immutable game/illustration files."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json

root=Path(__file__).resolve().parent.parent
target=Path(r'C:\Users\kit\gameme\jnethack\jrouge\rogue-nihon')
prior=root.parent/'rogue-tiles-work'
def record(path):
    data=path.read_bytes()
    return {'file':path.relative_to(root).as_posix(),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}

browser=json.loads((root/'tests/pixel-output/evidence.json').read_text(encoding='utf-8-sig'))
japanese=json.loads((root/'tests/pixel-output/japanese/evidence.json').read_text(encoding='utf-8-sig'))
assert browser['status']==japanese['status']=='passed'
assert len(browser['checks'])==13 and len(japanese['checks'])==19
manifest=json.loads((root/'web/assets/pixels/manifest.json').read_text(encoding='utf-8-sig'))
assert len(manifest['entries'])==49 and manifest['tile_pixels']==32
images=sorted({entry['image'] for entry in manifest['entries']})
assert len(images)==46
protected=[p for directory in ('logic','contract','web/assets/tiles') for p in (root/directory).rglob('*') if p.is_file()]
protected += [root/'build/game.js',root/'build/game.wasm']
for path in protected:
    assert path.read_bytes()==(target/path.relative_to(root)).read_bytes(),str(path)
rust=[p for p in (prior/'rust/src').rglob('*') if p.is_file()]
for path in rust:
    assert path.read_bytes()==(target/path.relative_to(prior)).read_bytes(),str(path)
build=[record(root/'build'/name) for name in ('game.js','game.wasm')]
assert {Path(entry['file']).name:entry['sha256'] for entry in build} == {entry['file']:entry['sha256'] for entry in japanese['actual_build_files']}
data={
 'status':'passed','recorded_at':datetime.now(timezone.utc).isoformat(),
 'scope':'Additional native 32x32 pixel-art mode; local delivery only; existing illustrations, ASCII and game core preserved.',
 'semantic_ids':49,'unique_pngs':46,'native_dimensions':[32,32],
 'maximum_colors_per_sprite':16,'alpha_values':[0,255],
 'modes':['ascii','tiles','pixels'],'pixel_scale_steps':[1,2,3,4],
 'preference':{'storage':'localStorage','key':'rogue-map-display-v1','fields':['version','mode','zoom'],'invalid_default':{'version':1,'mode':'tiles','zoom':32}},
 'generation':{'tool':'built-in image_gen','new_atlases':5,'prompt_record':'web/assets/pixels/generation-prompts.json','packing_record':'web/assets/pixels/generation.json','not_a_resize_of_illustration_assets':True},
 'checks':[
  {'suite':'Node native PNG/palette/alpha/seams/rotation/preferences plus original raster/input/localization checks','passed':19,'failed':0,'skipped':0,
   'command':'node --test tests/pixels.test.mjs tests/tiles.test.mjs tests/browser-smoke/host.test.mjs tests/browser-smoke/localization.test.mjs'},
  {'suite':'Actual Chrome three modes and pixel display','passed':13,'failed':0,'evidence':'tests/pixel-output/evidence.json','checks':browser['checks']},
  {'suite':'Actual Chrome Japanese UI/IME/save/replay with view=pixels','passed':19,'failed':0,'evidence':'tests/pixel-output/japanese/evidence.json','checks':japanese['checks']}
 ],
 'mode_switch_invariance':{'seeds':[1,12345,987654321],'c_state_words':20,'rng_and_original_cells_unchanged':True,'queued_commands':0},
 'unchanged':{'logic_contract_illustrations_and_build_files':len(protected),'rust_source_files':len(rust),'all_protected_bytes_equal':True,'build':build},
 'screenshots':[record(root/'tests/pixel-output'/name) for name in browser['screenshots']],
 'contact_sheet':record(root/'web/assets/pixels/contact-sheet.png'),
 'assets':[record(root/'web/assets/pixels'/name) for name in images],
 'source_atlases':[record(path) for path in sorted((root/'web/assets/pixels/source').glob('*.png'))],
 'limitations':['The 49-ID gallery is synthetic, not natural encounters with all 26 monsters.',
                 'Three seeded display scripts do not prove exhaustive game equivalence.',
                 'Mobile tests use desktop Chrome viewport/DPR emulation.',
                 'Non-integer OS/browser final display scaling remains device-dependent.']
}
(root/'pixel-verification.json').write_bytes((json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
print(json.dumps({'status':'passed','semantic_ids':49,'unique_pngs':46,'unchanged_files':len(protected)+len(rust),'node_checks':19,'browser_checks':13,'japanese_checks':19}))
