"""Pair every original visible name/appearance with a semantic EN/JA entry.
Only read C data initializers; never execute source or change game rules.
"""
import ast
import argparse
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORIGINAL = pathlib.Path(r'C:\Users\kit\gameme\jnethack\jrouge\investigation-20261002-original-rogue\sources\rogue5.4.4')


def source_table(file, symbol, structured=False, directory=None):
    source = ((directory or ROOT / 'logic') / file).read_text(encoding='utf-8')
    match = re.search(r'\b' + re.escape(symbol) + r'\s*\[[^;]*?=\s*\{(.*?)\n\s*\};', source, re.S)
    if not match:
        raise ValueError(f'missing table: {file}:{symbol}')
    pattern = r'\{\s*("(?:\\.|[^"\\])*")' if structured else r'("(?:\\.|[^"\\])*")'
    return [ast.literal_eval(value) for value in re.findall(pattern, match[1])]


TRANSLATIONS = {
    'weapon': 'メイス|長剣|短弓|矢|短剣|両手剣|ダーツ|手裏剣|槍',
    'armor': '革の鎧|リングメイル|鋲打ち革鎧|スケイルメイル|チェインメイル|スプリントメイル|バンデッドメイル|プレートメイル',
    'potion': '混乱|幻覚|毒|筋力増強|透明視|治癒|怪物探知|魔法探知|レベル上昇|強力な治癒|加速|筋力回復|失明|浮遊',
    'ring': '防御|筋力増強|筋力維持|探索|透明視|装飾|怪物激怒|器用さ|攻撃力増強|再生|消化抑制|瞬間移動|隠密|防具維持',
    'scroll': '怪物混乱|魔法の地図|怪物拘束|睡眠|防具強化|薬識別|巻物識別|武器識別|防具識別|指輪・ワンド・杖識別|怪物威嚇|食料探知|瞬間移動|武器強化|怪物創造|解呪|怪物激怒|防具保護',
    'stick': '照明|透明化|稲妻|炎|冷気|変身|魔法の矢|怪物加速|怪物減速|生命吸収|無効果|追放|引き寄せ|魔法解除',
    'monster': 'アクアター|コウモリ|ケンタウロス|ドラゴン|エミュー|ハエトリグサ|グリフィン|ホブゴブリン|氷の怪物|ジャバウォック|チョウゲンボウ|レプラコーン|メデューサ|ニンフ|オーク|ファントム|クアッガ|ガラガラヘビ|ヘビ|トロール|黒いユニコーン|吸血鬼|レイス|ゼロック|イエティ|ゾンビ',
    'trap': '落とし戸|矢の罠|睡眠ガスの罠|トラバサミ|瞬間移動の罠|毒ダーツの罠|錆の罠|謎の罠',
    'color': '琥珀色|アクアマリン色|黒色|青色|茶色|透明|深紅色|青緑色|生成り色|金色|緑色|灰色|赤紫色|オレンジ色|桃色|格子模様|紫色|赤色|銀色|黄褐色|みかん色|黄玉色|ターコイズ色|朱色|スミレ色|白色|黄色',
    'stone': '瑪瑙|アレキサンドライト|アメジスト|カーネリアン|ダイヤモンド|エメラルド|ゲルマニウム|花崗岩|ガーネット|翡翠|クリプトナイト|ラピスラズリ|ムーンストーン|黒曜石|オニキス|オパール|真珠|ペリドット|ルビー|サファイア|スティボタンタライト|虎目石|トパーズ|トルコ石|ターフェアイト|ジルコン',
    'wood': 'アボカド材|バルサ材|竹|バンヤン材|カバノキ材|杉材|桜材|シナバー材|糸杉材|ハナミズキ材|流木|黒檀|ニレ材|ユーカリ材|フォール材|ツガ材|ヒイラギ材|アイアンウッド材|ククイ材|マホガニー材|マンザニータ材|カエデ材|樫材|柿材|ペカン材|松材|ポプラ材|セコイア材|ローズウッド材|トウヒ材|チーク材|クルミ材|ゼブラウッド材',
    'metal': 'アルミニウム|ベリリウム|骨|真鍮|青銅|銅|琥珀金|金|鉄|鉛|マグネシウム|水銀|ニッケル|ピューター|プラチナ|鋼|銀|ケイ素|錫|チタン|タングステン|亜鉛',
    'hit': '痛烈な一撃を与えた|攻撃が命中した|傷を負わせた|振りかぶって攻撃を当てた|痛烈な一撃を与えた|攻撃が命中した|傷を負わせた|振りかぶって攻撃を当てた',
    'miss': '攻撃が外れた|振りかぶったが外れた|攻撃がわずかに外れた|攻撃が当たらなかった|攻撃が外れた|振りかぶったが外れた|攻撃がわずかに外れた|攻撃が当たらなかった',
}

SOURCES = {
    'weapon': ('extern.c', 'weap_info', True), 'armor': ('extern.c', 'arm_info', True),
    'potion': ('extern.c', 'pot_info', True), 'ring': ('extern.c', 'ring_info', True),
    'scroll': ('extern.c', 'scr_info', True), 'stick': ('extern.c', 'ws_info', True),
    'monster': ('extern.c', 'monsters', True), 'trap': ('extern.c', 'tr_name', False),
    'color': ('init.c', 'rainbow', False), 'stone': ('init.c', 'stones', True),
    'wood': ('init.c', 'wood', False), 'metal': ('init.c', 'metal', False),
    'hit': ('fight.c', 'h_names', False), 'miss': ('fight.c', 'm_names', False),
}

CATEGORY = {
    'weapon': ('weapon', '武器', '本'), 'armor': ('armor', '防具', '着'),
    'potion': ('potion', '薬', '本'), 'scroll': ('scroll', '巻物', '枚'),
    'ring': ('ring', '指輪', '個'), 'stick': ('stick', '杖', '本'),
    'food': ('food', '食料', '食'), 'gold': ('gold', '金貨', '枚'),
    'amulet': ('amulet', '護符', '個'), 'wand': ('wand', 'ワンド', '本'),
    'staff': ('staff', '杖', '本'),
}

FORMS = {
    'effect': ('{kind} of {effect}', '{effect}の{kind}'),
    'appearance': ('{appearance} {kind}', '{appearance}の{kind}'),
    'scroll_title': ("{kind} titled '{title}'", '「{title}」と記された{kind}'),
    'called': ('{name} called {label}', '{name}（命名：{label}）'),
    'details': ('{name} ({details})', '{name}（{details}）'),
    'quantity': ('{count} {name}', '{name} ×{count}'),
    'weapon_bonus': ('{hit},{damage} {name}', '{name}（命中{hit}・威力{damage}）'),
    'armor_bonus': ('{bonus} {name} [protection {protection}]', '{bonus} {name}［防御力{protection}］'),
    'armor_bonus_brief': ('{bonus} {name} [{protection}]', '{bonus} {name}［防御力{protection}］'),
    'ring_bonus': ('{name} [{bonus}]', '{name}［{bonus}］'),
    'charges': ('{charges} charges', '残り{charges}回'),
    'charges_known': ('{name} [{charges} charges]', '{name}（残り{charges}回）'),
    'charges_brief': ('{name} [{charges}]', '{name}（残り{charges}回）'),
    'appearance_known': ('{name}({appearance})', '{name}（{appearance}）'),
    'gold': ('{count} Gold pieces', '金貨{count}枚'),
    'food_count': ('{count} rations of food', '食料{count}食分'),
    'fruit_count': ('{count} {fruit}s', '{fruit} ×{count}'),
    'definite': ('the {name}', '{name}'),
    'indefinite': ('{article} {name}', '{name}'),
}

EXTRA = {
    'food.ration': ('Some food', '食料'), 'food.slime_mold': ('slime-mold', 'スライムモールド'),
    'item.amulet.yendor': ('The Amulet of Yendor', 'イェンダーの護符'),
    'monster.you': ('you', 'あなた'), 'monster.it': ('it', 'そいつ'),
    'monster.something': ('something', '何か'), 'entity.unknown': ('something', '何か'),
    'appearance.unknown': ('unfamiliar', '見慣れない'),
    'equipped.weapon': ('weapon in hand', '武器として装備中'), 'equipped.armor': ('being worn', '着用中'),
    'equipped.left_ring': ('on left hand', '左手に装備中'), 'equipped.right_ring': ('on right hand', '右手に装備中'),
    'death.arrow': ('arrow', '矢'), 'death.bolt': ('bolt', '雷撃'), 'death.dart': ('dart', 'ダーツ'),
    'death.hypothermia': ('hypothermia', '低体温症'), 'death.starvation': ('starvation', '餓死'),
    'death.badger': ('Wally the Wonder Badger', '不思議なアナグマのウォーリー'),
}


def slug(text):
    return '_'.join(re.findall(r'[a-z0-9]+', text.lower()))


def generate(original_root):
    entries = {'en': {}, 'ja': {}}
    tables = {}
    source_tables = {}
    source_verbs = {}
    for table, source in SOURCES.items():
        originals = source_table(*source)
        baseline = source_table(*source, directory=original_root)
        if originals != baseline:
            raise ValueError(f'{table}: ordered source strings differ from protected Rogue original')
        if table in ('hit', 'miss'):
            source_verbs[table] = originals
        source_tables[table] = {'source': f'{source[0]}:{source[1]}', 'count': len(originals),
                                'original_match': True,
                                'sha256': hashlib.sha256('\0'.join(originals).encode('utf-8')).hexdigest()}
        translated = TRANSLATIONS[table].split('|')
        if len(originals) != len(translated):
            raise ValueError(f'{table}: source {len(originals)} != Japanese {len(translated)}')
        prefix = ('appearance.' if table in ('color', 'stone', 'wood', 'metal') else
                  'combat.' if table in ('hit', 'miss') else
                  'item.' if table in CATEGORY else '') + table
        tables[table] = []
        for index, (original, japanese) in enumerate(zip(originals, translated)):
            identifier = f'{prefix}.{slug(original)}'
            tables[table].append(identifier)
            for lang, text in (('en', original), ('ja', japanese)):
                entries[lang][identifier] = {'text': text, 'source': f'{source[0]}:{source[1]}[{index}]'}
    syllables = source_table('init.c', 'sylls')
    if syllables != source_table('init.c', 'sylls', directory=original_root):
        raise ValueError('scroll syllables differ from protected Rogue original')
    source_tables['scroll_syllables'] = {'source': 'init.c:sylls', 'count': len(syllables),
        'original_match': True, 'sha256': hashlib.sha256('\0'.join(syllables).encode('utf-8')).hexdigest()}
    tables['scroll_syllables'] = [f'scroll.syllable.{syllable}' for syllable in syllables]
    for syllable in syllables:
        for lang in entries:
            entries[lang][f'scroll.syllable.{syllable}'] = {
                'text': syllable, 'source': 'init.c:sylls',
                'note': 'generated magical proper-name syllable; preserve literal runes, no inferred meaning',
            }
    for category, (english, japanese, counter) in CATEGORY.items():
        for lang, text in (('en', english), ('ja', japanese)):
            entries[lang][f'category.{category}'] = {'text': text, 'counter': counter, 'source': 'rogue.h:o_type/things.c:inv_name'}
    for identifier, pair in EXTRA.items():
        for lang, text in zip(('en', 'ja'), pair):
            entries[lang][identifier] = {'text': text, 'source': 'things.c/fight.c/rip.c visible naming'}
    for lang in entries:
        forms = {key: pair[0 if lang == 'en' else 1] for key, pair in FORMS.items()}
        hit_sentences = [
            '{actor}は{target}に痛烈な一撃を与えた', '{actor}の攻撃が{target}に命中した',
            '{actor}は{target}に傷を負わせた', '{actor}は振りかぶり、{target}に攻撃を当てた',
        ] * 2
        miss_sentences = [
            '{actor}の攻撃は{target}に当たらなかった', '{actor}は振りかぶったが、{target}には当たらなかった',
            '{actor}の攻撃は{target}のすぐ脇を通り過ぎた', '{actor}の攻撃は{target}に当たらなかった',
        ] * 2
        for event, sentences in (('hit', hit_sentences), ('miss', miss_sentences)):
            for index, identifier in enumerate(tables[event]):
                forms[f'{identifier}.sentence'] = (sentences[index] if lang == 'ja' else
                    '{actor}' + source_verbs[event][index] + ('' if event == 'hit' else ' ') + '{target}')
            forms[f'combat.{event}.terse'] = (
                ('{actor}の攻撃が命中した' if event == 'hit' else '{actor}の攻撃は外れた') if lang == 'ja' else
                ('{actor} hit' if event == 'hit' else '{actor} missed'))
        catalog = {
            'schema': 1, 'language': lang,
            'entries': dict(sorted(entries[lang].items())),
            'tables': tables,
            'source_tables': source_tables,
            'forms': forms,
            'note': 'random scroll rune syllables and user labels remain literal; hidden type/bonuses are not inferred',
        }
        (ROOT / 'locales' / f'entities-{lang}.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'entries_per_language': len(entries['en']), 'original_tables_match': True,
                      'tables': {key: len(value) for key, value in tables.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--original-root', type=pathlib.Path, default=ORIGINAL)
    generate(parser.parse_args().original_root)
