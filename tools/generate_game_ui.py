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
    ('input.choose_item', 'Select an item or enter its key. Esc: Cancel.', '品物を選択。キー入力でも選べます。Esc：取消'),
    ('input.choose_direction', 'Choose a direction, Escape to cancel.', '方向キーを入力。Esc：取消'),
    ('input.throw_direction', 'Choose a throwing direction with movement keys. Esc: Cancel.', '移動キーで投げる方向を指定。Esc：取消'),
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

for key, original, translated in [
    ("input.help", "Enter a command key, * for all commands, Escape to cancel.", "コマンドのキーを入力。*：全操作／Esc：取消"),
    ("input.symbol", "Enter the symbol to identify, Escape to cancel.", "調べる記号を入力。Esc：取消"),
    ("input.discovery", "Enter an item type, * for all discoveries, Escape to cancel.", "品物の種類を入力。*：全発見／Esc：取消"),
    ("input.confirm", "Quit the game? Y: Yes / N: No", "ゲームを終了しますか？ Y：はい／N：いいえ"),
    ("input.inventory_one", "Select an item to examine or enter its key. Esc: Cancel.", "調べる品物を選択。キー入力でも選べます。Esc：取消"),
    ("window.menu", "Inventory / list", "持ち物・一覧"),
    ("window.detection", "Detection results", "検出結果"),
    ("window.help", "Help", "操作ヘルプ"),
    ("window.options", "Game options", "ゲーム内設定"),
    ("window.result", "Game result", "ゲーム結果"),
    ("window.item", "Choose an item", "品物を選択"),
    ("window.direction", "Choose a direction", "方向を指定"),
    ("window.text", "Enter text", "文字を入力"),
    ("window.discovery", "Discoveries", "発見した品物"),
    ("window.confirm", "Confirm", "確認"),
    ("window.symbol", "Identify a symbol", "記号を調べる"),
    ("window.game", "Game window", "ゲームウインドウ"),
    ("window.close", "Close", "閉じる"),
    ("window.next_page", "Next page", "次のページ"),
    ("window.next_item", "Next item", "次の品物"),
    ("window.next_message", "Next message", "次のメッセージ"),
    ("window.results", "Show results", "結果を見る"),
    ("window.score", "Show scores", "スコアを見る"),
    ("input.show_score", "Enter / Esc: Show scores", "Enter / Esc：スコアを見る"),
    ("window.finish_game", "Finish", "終了する"),
    ("ui.close", "Close", "閉じる"),
    ("ui.next_page", "Next page", "次のページ"),
    ("input.close", "Space / Enter / Esc: Close", "Space / Enter / Esc：閉じる"),
    ("input.next_page", "Space / Enter: Next page", "Space / Enter：次のページ"),
    ("input.next_item", "Space / Enter: Next item; Esc: Close", "Space / Enter：次の品物／Esc：閉じる"),
    ("input.next_message", "Space / Enter: Next message", "Space / Enter：次のメッセージ"),
    ("input.results", "Space / Enter: Show results", "Space / Enter：結果を見る"),
    ("input.finish_game", "Enter / Esc: Finish", "Enter / Esc：終了する"),
    ("input.results_enter", "Enter / Esc: Show results", "Enter / Esc：結果を見る"),
    ("window.cancel", "Cancel (Esc)", "取消（Esc）"),
    ("window.all", "Show all (*)", "すべて表示（*）"),
    ("window.yes", "Yes (Y)", "はい（Y）"),
    ("window.no", "No (N)", "いいえ（N）"),
    ("window.keep", "Keep (Enter)", "変更しない（Enter）"),
    ("window.back", "Back (-)", "前へ（-）"),
    ("window.finish", "Finish (Esc)", "終了（Esc）"),
]: entry(key, original, translated)

entry('input.hand', 'Choose a hand: L / R / Escape to cancel.', '左手：L／右手：R／Esc：取消')
entry('window.hand', 'Choose a hand', '指輪を着ける手')
entry('window.left_hand', 'Left hand (L)', '左手（L）')
entry('window.right_hand', 'Right hand (R)', '右手（R）')

entry('save.browser', 'Save the game using Save in Settings.', '保存は設定ウィンドウの「保存」から行います。')
entry('inventory.title', 'Inventory', '持ち物')
entry('inventory.empty', 'You are not carrying anything.', '何も持っていません。')
entry('inventory.choose', 'Select an item. Space / Enter / Esc: Close', 'アイテムを選択。Space / Enter / Esc：閉じる')
entry('inventory.actions', 'Item actions', 'アイテムの操作')
entry('inventory.details', 'View details', '詳細を見る')
entry('inventory.back', 'Back', '戻る')
entry('inventory.back_hint', 'Esc: Back', 'Esc：戻る')
entry('inventory.drop', 'Drop', '落とす')
entry('inventory.wield', 'Equip', '装備する')
entry('inventory.take_off', 'Take off', '脱ぐ')
entry('inventory.remove_ring', 'Remove', '外す')
entry('inventory.zap', 'Use', '杖を使う')
entry('inventory.category', 'Type', '種類')
entry('inventory.count', 'Quantity', '個数')
entry('inventory.equipment', 'Equipment', '装備状態')
entry('inventory.knowledge', 'Effect', '効果')
entry('inventory.known', 'Known (shown in the item name)', '判明済み（アイテム名に表示）')
entry('inventory.unknown', 'Unknown', '未判明')
entry('inventory.equipped.none', 'Not equipped', '装備していない')
entry('inventory.equipped.weapon', 'In hand', '装備中')
entry('inventory.equipped.armor', 'Worn', '着用中')
entry('inventory.equipped.left_ring', 'Left hand', '左手に装着中')
entry('inventory.equipped.right_ring', 'Right hand', '右手に装着中')
entry('inventory.hplus', 'Accuracy bonus', '命中補正')
entry('inventory.dplus', 'Damage bonus', 'ダメージ補正')
entry('inventory.protection', 'Protection', '防御力')
entry('inventory.enchantment', 'Enchantment', '強化値')
entry('inventory.charges', 'Charges', '残り使用回数')
entry('inventory.bonus', 'Bonus', '補正値')

for language, values in [('en', en), ('ja', ja)]:
    catalog = {'schema': 1, 'language': language, 'messages': {key: {'template': value} for key, value in values.items()}}
    (ROOT / 'locales' / f'ui-game-{language}.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Generated UI game catalogs: {len(en)} IDs, 65 original help descriptions')
