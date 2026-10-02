"""Source-order checks for the original help table and Japanese UI catalogs."""
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
command = (ROOT / 'logic/command.c').read_text(encoding='utf-8')
table = (ROOT / 'logic/extern.c').read_text(encoding='utf-8').split('struct h_list helpstr[] = {', 1)[1].split('\n};', 1)[0]
ids = re.findall(r'"(help\.[a-z_]+)"', command.split('rg_help_ids[] = {', 1)[1].split('\n};', 1)[0])
english = [ast.literal_eval('"' + value + '"') for value in re.findall(r"\{(?:'(?:\\.|[^'])+'|CTRL\('[^']'\)|ESCAPE),\s*\"((?:[^\"\\]|\\.)*)\"", table)]
japanese = [
    '：ヘルプを表示', '：記号の意味を調べる', '：左へ移動', '：下へ移動', '：上へ移動', '：右へ移動',
    '：左上へ移動', '：右上へ移動', '：左下へ移動', '：右下へ移動',
    '：左へ走る', '：下へ走る', '：上へ走る', '：右へ走る', '：左上へ走る', '：右上へ走る', '：左下へ走る', '：右下へ走る',
    '：隣接するものが現れるまで左へ走る', '：隣接するものが現れるまで下へ走る', '：隣接するものが現れるまで上へ走る', '：隣接するものが現れるまで右へ走る',
    '：隣接するものが現れるまで左上へ走る', '：隣接するものが現れるまで右上へ走る', '：隣接するものが現れるまで左下へ走る', '：隣接するものが現れるまで右下へ走る',
    'Shift＋方向キー：その方向へ走る', 'Ctrl＋方向キー：隣接するものが現れるまで走る',
    '＋方向キー：倒すか瀕死になるまで戦う', '＋方向キー：品物を投げる', '＋方向キー：品物を拾わずに移動',
    '＋方向キー：杖を使う', '＋方向キー：罠の種類を調べる', '：罠と隠し扉を探す', '：階段を下りる', '：階段を上る',
    '：1ターン休む', '：足元の品物を拾う', '：所持品を一覧表示', '：所持品を1つ調べる', '：薬を飲む', '：巻物を読む', '：食べる',
    '：武器を構える', '：鎧を着る', '：鎧を脱ぐ', '：指輪をはめる', '：指輪を外す', '：品物を置く', '：品物に名前を付ける',
    '：直前のコマンドを繰り返す', '：現在の武器を表示', '：現在の鎧を表示', '：現在の指輪を表示', '：現在の能力値を表示',
    '：発見した品物を一覧表示', '：設定を確認・変更', '：画面を描き直す', '：直前のメッセージを表示', '：操作を取り消す',
    '：ゲームを保存', '：ゲームを終了', '：シェルを起動', '＋方向キー：どちらかが死ぬまで戦う', '：バージョンを表示'
]
assert len(ids) == len(english) == len(japanese) == 65, (len(ids), len(english), len(japanese))
en, ja = dict(zip(ids, english)), dict(zip(ids, japanese))

def entry(key, original, translated):
    assert key not in en
    en[key], ja[key] = original, translated

for key, original, translated in [
    ('ui.help.entry', '{0}{1}', '{0}{1}'), ('ui.text', '{0}', '{0}'),
    ('ui.inventory.entry', '{0}) {1}', '{0}) {1}'),
    ('ui.continue', '--Press space to continue--', 'スペースキーで続ける'),
    ('input.wait_space', 'Press Space to continue.', 'スペースキーで続ける'),
    ('input.option_bool', 'T: True / F: False / Enter: Keep / -: Back / Escape: Finish', 'T：有効／F：無効／Enter：変更しない／-：前へ／Esc：終了'),
    ('input.option_inventory', 'O: Overlay / S: Slow / C: Clear / Enter: Keep / -: Back / Escape: Finish', 'O：重ねて表示／S：1行ずつ表示／C：画面を切り替え／Enter：変更しない／-：前へ／Esc：終了'),
    ('options.value.true', 'True', '有効'), ('options.value.false', 'False', '無効'),
    ('options.value.overlay', 'Overlay', '重ねて表示'), ('options.value.slow', 'Slow', '1行ずつ表示'), ('options.value.clear', 'Clear', '画面を切り替え'),
    ('options.hint.bool', '(T or F)', 'T：有効／F：無効'), ('options.hint.inventory', '(O, S, or C)', 'O：重ねる／S：1行ずつ／C：切り替え'),
    ('input.choose_item', 'Choose an item key, * for list, Escape to cancel.', '品物のキーを入力。*：一覧／Esc：取消'),
    ('input.choose_direction', 'Choose a direction, Escape to cancel.', '方向キーを入力。Esc：取消'),
    ('prompt.direction', 'which direction? ', 'どの方向？ '), ('prompt.direction.short', 'direction: ', '方向：'),
    ('equipment.wielding', 'wielding', '構えている'), ('equipment.wearing', 'wearing', '身に着けている'),
    ('equipment.left_hand', 'on left hand', '左手に'), ('equipment.right_hand', 'on right hand', '右手に'),
    ('equipment.left_short', '(L)', '（左手）'), ('equipment.right_short', '(R)', '（右手）'),
]: entry(key, original, translated)

for key, original, translated in [
    ('wear', 'wear', '着る'), ('charge', 'charge', '充填する'), ('call', 'call', '名付ける'), ('eat', 'eat', '食べる'),
    ('quaff', 'quaff', '飲む'), ('put_ring', 'put on', 'はめる'), ('read', 'read', '読む'), ('zap', 'zap with', '使う'),
    ('drop', 'drop', '置く'), ('throw', 'throw', '投げる'), ('wield', 'wield', '構える'), ('identify', 'identify', '識別する'),
]: entry('action.' + key, original, translated)

for key, label, translated in [
    ('terse', 'Terse output', '簡潔な表示'), ('flush', 'Flush typeahead during battle', '戦闘中の入力待ちを消去'),
    ('jump', 'Show position only at end of run', '走り終わった位置だけを表示'), ('seefloor', 'Show the lamp-illuminated floor', 'ランプで照らした床を表示'),
    ('passgo', 'Follow turnings in passageways', '通路の曲がり角に沿って走る'), ('tombstone', 'Print out tombstone when killed', '死亡時に墓石を表示'),
    ('inven', 'Inventory style', '所持品の表示方法'), ('name', 'Name', '名前'), ('fruit', 'Fruit', '好きな果物'), ('file', 'Save file', '保存ファイル'),
]: entry('options.' + key, f'{label} ("{key}"): ', translated + '：')

for key, original, translated in [
    ('wall', 'wall of a room', '部屋の壁'), ('gold', 'gold', '金貨'), ('stairs', 'a staircase', '階段'), ('door', 'door', '扉'),
    ('floor', 'room floor', '部屋の床'), ('player', 'you', 'あなた'), ('passage', 'passage', '通路'), ('trap', 'trap', '罠'),
    ('potion', 'potion', '薬'), ('scroll', 'scroll', '巻物'), ('food', 'food', '食べ物'), ('weapon', 'weapon', '武器'),
    ('rock', 'solid rock', '岩盤'), ('armor', 'armor', '鎧'), ('amulet', 'the Amulet of Yendor', 'イェンダーの魔除け'),
    ('ring', 'ring', '指輪'), ('stick', 'wand or staff', '杖'), ('unknown', 'unknown character', '不明な記号'),
]: entry('identify.' + key, original, translated)

for key, original, translated in [('potion', 'potions', '薬'), ('scroll', 'scrolls', '巻物'), ('ring', 'rings', '指輪'), ('stick', 'sticks', '杖')]:
    entry('discoveries.none.' + key, "Haven't discovered anything about any " + original, translated + 'についてはまだ何も分かっていない')
    entry('discoveries.none_short.' + key, 'Nothing about any ' + original, translated + 'の発見なし')

for language, values in [('en', en), ('ja', ja)]:
    catalog = {'schema': 1, 'language': language, 'messages': {key: {'template': value} for key, value in values.items()}}
    (ROOT / 'locales' / f'ui-game-{language}.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Generated UI game catalogs: {len(en)} IDs, 65 original help descriptions')
