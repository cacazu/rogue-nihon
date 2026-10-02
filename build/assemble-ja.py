"""Assemble reviewed translation drafts without modifying the English catalog."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PRINTF = re.compile(r'%(?P<flags>[-+ #0]*)(?P<width>\d+|\*)?(?:\.(?P<precision>\d+|\*))?(?P<length>hh|ll|[hljztL])?(?P<conversion>[diuoxXfFeEgGaAcspn%])')

def signature(text):
    types, conversions, controls = [], [], []
    for spec in PRINTF.finditer(text):
        conversion = spec['conversion']
        if conversion == '%':
            continue
        for key in ('width', 'precision'):
            if spec[key] == '*':
                controls.append(len(types)); types.append('signed'); conversions.append(key)
        types.append('string' if conversion in 'sp' else 'signed' if conversion in 'dic' else 'unsigned' if conversion in 'uoxX' else 'float')
        conversions.append(conversion)
    return types, conversions, controls

def source_arguments():
    spec = importlib.util.spec_from_file_location('reviewed_catalog_scanner', ROOT / 'tools/generate_catalog.py')
    scanner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scanner)
    result = {}
    for path in (ROOT / 'logic').glob('*.c'):
        source = path.read_text(encoding='utf-8')
        items = scanner.tokens(source)
        by_line = {}
        for index, token in enumerate(items):
            if token[1] not in ('msg', 'addmsg', 'debug') or index+1 >= len(items) or items[index+1][1] != '(':
                continue
            end = scanner.closing(items, index+1)
            groups = scanner.arguments(items,index+2,end)
            line = source.count('\n',0,token[2])+1
            by_line[line] = [''.join(piece[1] for piece in group) for group in groups[1:]]
        for call in scanner.source_calls(path):
            for fmt in call['formats']:
                result[(path.name,call['function'],fmt)] = by_line.get(call['line'],[])
    return result

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

en = load(ROOT / 'locales/en.json')
translations = load(ROOT / 'build/ja-main-translations.json')
translations.update(load(ROOT / 'build/ja-message-subset.json'))
subset = load(ROOT / 'build/ja-message-subset-values.json')
sources = source_arguments()
messages = {}
for ident, original in en['messages'].items():
    if ident not in translations:
        raise ValueError(f'missing Japanese translation: {ident}')
    types, conversions, controls = signature(original['template'])
    entry = {
        'template':translations[ident],
        'source_template':original['template'],
        'argument_types':types,
        'conversions':conversions,
        'control_indexes':controls,
        'grammar_indexes':[],
        'argument_roles':{},
        'argument_sources':{},
        'argument_values':{},
        'unresolved':[],
    }
    for key in ('source','function'):
        if key in original:
            entry[key] = original[key]
    if ident in subset:
        entry.update(subset[ident])
    elif 'source' in original:
        expressions = sources.get((original['source'].split(':')[0], original['function'], original['template']), [])
        for index, conversion in enumerate(conversions):
            if conversion == 's':
                entry['argument_sources'][str(index)] = expressions[index] if index < len(expressions) else 'source changed; recheck current C call'
    messages[ident] = entry

def values(ident,index,mapping,role='token'):
    entry = messages[ident]
    entry['argument_roles'][str(index)] = role
    entry['argument_values'][str(index)] = {
        original:{'id':semantic,'text':translated} for original,(semantic,translated) in mapping.items()
    }

for ident,entry in messages.items():
    if ident.startswith('message.'):
        entry['control'] = ident.split('.')[1]
    elif not entry['template']:
        entry['intentional_empty_reason'] = '英語の所有格または動詞の単数語尾は、日本語の後続断片で表現する。'
    elif not re.search(r'[\u3040-\u30ff\u3400-\u9fff]',entry['template']):
        entry['notation_only'] = True
    if entry['conversions']:
        for index,conv in enumerate(entry['conversions']):
            if conv == 'c':
                entry['argument_roles'][str(index)] = 'display_key'

item_ids = {
    'armor.take_off.wearing':1,'armor.wear.wearing':0,
    'command.current.character_string':1,'fight.attack.she_stole':0,
    'fight.bounce.the_misses':0,'fight.thunk.the_hits':0,
    'pack.add_pack.string_character':0,'pack.move_msg.moved_onto':0,
    'pack.picky_inven.a':0,'pack.picky_inven.character_string':1,
    'things.drop.dropped':0,'things.pick_one.string_number':0,
    'weapons.fall.the_vanishes_as_it_hits_the_ground':0,'weapons.wield.wielding':0,
    'wizard.whatis.you_must_identify_a':0,
}
for ident,index in item_ids.items():
    if ident in messages:
        messages[ident]['argument_roles'][str(index)] = 'item'
for ident in ('fight.fight.appears_confused','fight.miss.string','fight.thunk.string'):
    messages[ident]['argument_roles']['0'] = 'monster'
messages['fight.attack.by_the']['argument_roles']['0'] = 'monster'
messages['fight.fight.your_hands_stop_glowing']['argument_roles']['0'] = 'color'
for ident in ('command.help.unknown_character','command.illcom.illegal_command',
              'pack.get_item.is_not_a_valid_item','pack.picky_inven.not_in_pack','pack.pick_up.where_did_you_pick_a_up'):
    messages[ident]['argument_roles']['0'] = 'display_key'
messages['command.help.string_string']['argument_roles'] = {'0':'display_key','1':'help_description'}
messages['command.identify.string_string']['argument_roles'] = {'0':'display_key','1':'glyph_description'}
messages['command.call.called']['argument_roles']['0'] = 'appearance_or_user_label'
messages['command.command.string']['argument_roles']['0'] = 'message_recall'
messages['command.command.version_mctesq_was_here']['argument_roles']['0'] = 'version'
messages['save.restore.file_name']['argument_roles']['0'] = 'file_name'
messages['save.save_game.file_name_plain']['argument_roles']['0'] = 'file_name'
messages['save.save_game.save_file']['argument_roles']['0'] = 'file_name'
messages['save.save_game.string']['argument_roles']['0'] = 'system_error'
messages['things.inv_name.picked_up_something_funny']['argument_roles']['0'] = 'item_symbol'
messages['misc.eat.my_that_was_a_yummy']['argument_roles']['0'] = 'fruit_or_user_name'

values('command.current.you_are',0,{
    'wielding':('equipment.action.wielding','構えている物'),
    'wearing':('equipment.action.wearing','身につけている物')})
values('command.current.nothing',0,{
    'wielding':('equipment.action.wielding','構えている'),
    'wearing':('equipment.action.wearing','身につけている')})
values('command.current.string',0,{
    '(L)':('equipment.hand.left','（左手）'),
    '(R)':('equipment.hand.right','（右手）'),
    'on left hand':('equipment.hand.left','（左手）'),
    'on right hand':('equipment.hand.right','（右手）')})
values('misc.eat.that_tasted_good',0,{
    'oh, wow':('food.reaction.delighted','おお'),
    'yum':('food.reaction.delicious','うまい')})
values('misc.eat.this_food_tastes_awful',0,{
    'bummer':('food.reaction.disappointed','しまった'),
    'yuk':('food.reaction.disgusted','うえっ')})
values('io.status.level_gold_hp_str_arm_exp',11,{
    '':('hunger.normal',''),
    'Hungry':('hunger.hungry','空腹'),
    'Weak':('hunger.weak','衰弱'),
    'Faint':('hunger.faint','餓死寸前')})

for ident,entry in messages.items():
    for index,conv in enumerate(entry['conversions']):
        if conv == 's' and str(index) not in entry['argument_roles']:
            raise ValueError(f'unclassified string argument: {ident}[{index}]')

catalog = {
    'schema':1,'language':'ja',
    'fallbacks':[{'id':'message.legacy','reason':'登録されていない実行時メッセージは原語を表示する。意味IDへの移行対象をcoverage.jsonで監査する。'}],
    'messages':dict(sorted(messages.items())),
}
(ROOT / 'locales/ja.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'messages':len(messages),'literal_templates':len(messages)-3,
                  'string_arguments':sum(e['conversions'].count('s') for e in messages.values()),
                  'intentional_empty':[i for i,e in messages.items() if 'intentional_empty_reason' in e]},ensure_ascii=False))
