"""Check all reviewed English/Japanese presentation catalog pairs.

This is a read-only test: it never regenerates or edits catalogs or C sources.
Run with the existing Python: python tests/localization.test.py
"""
from __future__ import annotations

import collections
import json
from pathlib import Path
import re
import string
import unittest

ROOT = Path(__file__).resolve().parents[1]
PRINTF = re.compile(r'%(?P<flags>[-+ #0]*)(?P<width>\d+|\*)?(?:\.(?P<precision>\d+|\*))?(?P<length>hh|ll|[hljztL])?(?P<conversion>[diuoxXfFeEgGaAcspn%])')
CJK = re.compile(r'[\u3040-\u30ff\u3400-\u9fff]')
CONTROL_IDS = {'message.clear','message.legacy','message.sequence'}
CATALOG_FAMILIES = {
    'game': ('en.json', 'ja.json', ('messages',)),
    'ui-game': ('ui-game-en.json', 'ui-game-ja.json', ('messages',)),
    'runtime': ('runtime-en.json', 'runtime-ja.json', ('messages',)),
    'endings': ('endings-en.json', 'endings-ja.json', ('messages',)),
    'ui-web': ('ui-web-en.json', 'ui-web-ja.json', ('messages',)),
    'entities': ('entities-en.json', 'entities-ja.json', ('entries', 'forms')),
}
# display.rs merges only these families, in this order. ui-web is looked up
# separately by RogueUiCatalog in app.js; entity entries/forms have namespaces.
MERGED_MESSAGE_FAMILIES = ('game', 'ui-game', 'runtime', 'endings')
MESSAGE_ALIASES = {
    'ui.text': frozenset({'ui-game', 'runtime'}),
    'ui.inventory.entry': frozenset({'ui-game', 'runtime'}),
}
# These are exact presentation IDs, not a blanket exemption for Latin text.
LITERAL_EXCEPTIONS = {
    ('ui-web', 'messages', 'app.title'): 'Rogue 5.4.4 — Web',
    ('ui-web', 'messages', 'language.en'): 'English',
    ('ui-web', 'messages', 'language.ja'): '日本語',
}
STRUCTURAL_EXCEPTIONS = {
    ('ui-game', 'messages', 'ui.help.entry'),
    ('ui-game', 'messages', 'ui.text'),
    ('ui-game', 'messages', 'ui.inventory.entry'),
    ('runtime', 'messages', 'message.entity'),
    ('runtime', 'messages', 'ui.text'),
    ('runtime', 'messages', 'ui.inventory.entry'),
    ('endings', 'messages', 'ui.ending.cause'),
    ('endings', 'messages', 'ui.ending.name'),
    *(('entities', 'forms', ident) for ident in (
        'quantity', 'weapon_bonus', 'ring_bonus', 'fruit_count',
        'details', 'definite', 'indefinite', 'appearance_known')),
}
# Japanese has no indefinite article. Only this field in this form may disappear.
OMITTED_NAMED_FIELDS = {
    ('entities', 'forms', 'indefinite'): collections.Counter({'article': 1}),
}
# platform_system.h defines Numname as Ten; this exact token becomes decimal 10.
FINITE_TEXT_EXCEPTIONS = {
    ('endings', 'ui.score.heading', '0', 'Ten'): ('ui.score.number.ten', '10'),
}


def unique_object(pairs):
    value = {}
    for key, entry in pairs:
        if key in value:
            raise ValueError(f'duplicate JSON key: {key}')
        value[key] = entry
    return value


def decode_catalog(raw, label='<catalog>'):
    if raw.startswith(b'\xef\xbb\xbf'):
        raise ValueError(f'UTF-8 BOM not allowed: {label}')
    return json.loads(raw.decode('utf-8'),object_pairs_hook=unique_object)


def read_catalog(path):
    return decode_catalog(path.read_bytes(), path)


def presentation_text(entry):
    if isinstance(entry, str):
        return entry
    if not isinstance(entry, dict):
        raise ValueError(f'presentation entry must be text or an object: {entry!r}')
    key = 'template' if 'template' in entry else 'text'
    value = entry[key]
    if not isinstance(value, str):
        raise ValueError(f'presentation text must be a string: {entry!r}')
    return value


def placeholder_counts(template):
    """Preserve names and occurrence counts; allow reordering, never renaming."""
    fields = []
    for _, name, spec, conversion in string.Formatter().parse(template):
        if name is None:
            continue
        if (not name or not name.isascii() or spec or conversion
                or not re.fullmatch(r'(?:[0-9]+|[A-Za-z_][A-Za-z0-9_]*)', name)):
            raise ValueError(f'unsupported placeholder: {template!r}')
        fields.append(name)
    return collections.Counter(fields)


def string_leaves(value, path='$'):
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, entry in value.items():
            yield f'{path}.<key>', key
            yield from string_leaves(entry, f'{path}.{key}')
    elif isinstance(value, list):
        for index, entry in enumerate(value):
            yield from string_leaves(entry, f'{path}[{index}]')


def expected_signature(template):
    types, conversions, controls = [], [], []
    for spec in PRINTF.finditer(template):
        conversion = spec['conversion']
        if conversion == '%':
            continue
        for role in ('width','precision'):
            if spec[role] == '*':
                controls.append(len(types))
                types.append('signed')
                conversions.append(role)
        if conversion in 'sp':
            kind = 'string'
        elif conversion in 'dic':
            kind = 'signed'
        elif conversion in 'uoxX':
            kind = 'unsigned'
        elif conversion in 'fFeEgGaA':
            kind = 'float'
        else:
            raise ValueError(f'unsupported printf conversion: {spec.group()}')
        types.append(kind)
        conversions.append(conversion)
    return types, conversions, controls


def indexes(template):
    found = []
    for _,name,spec,conversion in string.Formatter().parse(template):
        if name is not None:
            if not name.isascii() or not name.isdecimal() or spec or conversion:
                raise ValueError(f'only {{index}} is supported: {template!r}')
            found.append(int(name))
    return found


def sample_render(entry, supplied=None):
    """Small specification fixture for indexed JA, not the Rust implementation."""
    values = []
    for index,(kind,conversion) in enumerate(zip(entry['argument_types'],entry['conversions'])):
        value = supplied[index] if supplied and index in supplied else (
            '試験名' if kind == 'string' else 97 if conversion == 'c' else 7.5 if kind == 'float' else 7)
        finite = entry.get('argument_values',{}).get(str(index),{})
        if isinstance(value,str) and value in finite:
            value = finite[value]['text']
        if conversion == 'c' and isinstance(value,int):
            value = chr(value)
        values.append(value)
    return entry['template'].format(*values)


class JapaneseCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.en = read_catalog(ROOT / 'locales/en.json')
        cls.ja = read_catalog(ROOT / 'locales/ja.json')

    def test_schema_utf8_unique_and_exact_id_coverage(self):
        self.assertEqual(self.en['schema'],self.ja['schema'])
        self.assertEqual(self.ja['language'],'ja')
        self.assertEqual(set(self.en['messages']),set(self.ja['messages']),
                         'Regenerated English IDs must all have reviewed Japanese entries')
        with self.assertRaisesRegex(ValueError,'duplicate JSON key'):
            json.loads('{"messages":{"same":1,"same":2}}',object_pairs_hook=unique_object)

    def test_each_template_retains_the_source_signature_and_meaning_revision(self):
        for ident,original in self.en['messages'].items():
            with self.subTest(id=ident):
                translated = self.ja['messages'][ident]
                self.assertEqual(translated['source_template'],original['template'])
                kinds,conversions,controls = expected_signature(original['template'])
                self.assertEqual(translated['argument_types'],kinds)
                self.assertEqual(translated['conversions'],conversions)
                self.assertEqual(translated['control_indexes'],controls)
                grammar = translated.get('grammar_indexes',[])
                self.assertEqual(len(grammar),len(set(grammar)))
                self.assertTrue(set(grammar) <= set(range(len(kinds))))
                for index in grammar:
                    self.assertIn(str(index),translated.get('argument_sources',{}))
                    self.assertTrue(translated.get('grammar_reason'))
                actual = indexes(translated['template'])
                values = set(range(len(kinds))) - set(controls) - set(grammar)
                self.assertEqual(set(actual),values)
                self.assertEqual(len(actual),len(values),'Every value appears exactly once')
                self.assertFalse(PRINTF.search(translated['template']),
                                 'Japanese templates must use indexed placeholders')

    def test_all_japanese_text_is_translated_or_explicit_structural_notation(self):
        for ident,entry in self.ja['messages'].items():
            with self.subTest(id=ident):
                template = entry['template']
                self.assertNotIn('\ufffd',template)
                if ident in CONTROL_IDS:
                    self.assertEqual(template,'')
                    self.assertEqual(entry['control'],ident.split('.')[1])
                elif not template:
                    self.assertTrue(entry.get('intentional_empty_reason'))
                elif not CJK.search(template):
                    self.assertTrue(entry.get('notation_only'))
                    remainder = re.sub(r'\{\d+\}','',template)
                    self.assertFalse(re.search(r'[A-Zb-z]{2,}',remainder))
                else:
                    self.assertNotEqual(template,entry['source_template'])
                self.assertEqual(entry.get('unresolved',[]),[],
                                 'Unresolved string sources must be resolved before shipping')
                sample_render(entry)

    def test_each_string_argument_has_source_role_and_finite_maps_are_typed(self):
        for ident,entry in self.ja['messages'].items():
            with self.subTest(id=ident):
                for index,conversion in enumerate(entry['conversions']):
                    if conversion == 's':
                        self.assertTrue(entry['argument_roles'].get(str(index)))
                        self.assertTrue(entry['argument_sources'].get(str(index)))
                for index,mapping in entry.get('argument_values',{}).items():
                    self.assertTrue(index.isdecimal())
                    self.assertLess(int(index),len(entry['argument_types']))
                    self.assertEqual(entry['argument_types'][int(index)],'string')
                    for token,value in mapping.items():
                        self.assertIsInstance(token,str)
                        self.assertRegex(value['id'],r'^[a-z][a-z0-9_.]*$')
                        self.assertIsInstance(value['text'],str)
                        if value['text']:
                            self.assertRegex(value['text'],CJK)
                        else:
                            self.assertTrue(value['id'].endswith('.normal') or int(index) in entry.get('grammar_indexes',[]))

    def test_fallbacks_are_explicit_and_not_misreported_as_translations(self):
        fallbacks = self.ja['fallbacks']
        self.assertEqual({entry['id'] for entry in fallbacks},{'message.legacy'})
        for entry in fallbacks:
            self.assertTrue(CJK.search(entry['reason']))
            self.assertIn(entry['id'],self.ja['messages'])

    def test_fragment_sequences_match_the_actual_c_branches(self):
        m = self.ja['messages']
        render = lambda ident,supplied=None:sample_render(m[ident],supplied)
        armor = render('armor.take_off.you_used_to_be') + render('armor.take_off.wearing',{0:98,1:'鎖かたびら'})
        self.assertEqual(armor,'外した防具：鎖かたびら（b）')
        self.assertEqual(render('armor.take_off.was') + render('armor.take_off.wearing',{0:98,1:'鎖かたびら'}),armor)
        wearing = render('armor.wear.you_are_now') + render('armor.wear.wearing',{0:'鎖かたびら'})
        self.assertEqual(wearing,'あなたは鎖かたびらを身につけた。')
        wielding = render('weapons.wield.you_are_now') + render('weapons.wield.wielding',{0:'メイス',1:99})
        self.assertEqual(wielding,'あなたはメイス（c）を構えた。')
        singular = render('scrolls.read_scroll.the_monster') + render('scrolls.read_scroll.freeze') + render('scrolls.read_scroll.s')
        plural = render('scrolls.read_scroll.the_monster') + render('scrolls.read_scroll.s_around_you') + render('scrolls.read_scroll.freeze')
        self.assertIn('の動きが止まった',singular)
        self.assertIn('たちの動きが止まった',plural)
        gaze = render('monsters.wake_monster.string',{0:'メドゥーサ'}) + render('monsters.wake_monster.possessive_apostrophe') + render('monsters.wake_monster.s_gaze_has_confused_you')
        self.assertEqual(gaze,'メドゥーサの視線で混乱してしまった')
        hunger = render('daemons.stomach.you_feel_too_weak_from_lack_of_food') + render('daemons.stomach.you_faint')
        self.assertIn('空腹',hunger)
        self.assertIn('気を失った',hunger)

    def test_characters_star_widths_and_state_words_render_without_english(self):
        entry = self.ja['messages']['io.status.level_gold_hp_str_arm_exp']
        output = sample_render(entry,{0:3,1:21,2:99,3:12,4:88,5:20,6:16,7:18,8:6,9:2,10:27,11:'Hungry'})
        self.assertEqual(entry['control_indexes'],[2,4])
        self.assertIn('HP：12（20）',output)
        self.assertNotIn('99',output)
        self.assertNotIn('88',output)
        self.assertIn('空腹',output)
        self.assertNotIn('Hungry',output)
        output = sample_render(self.ja['messages']['things.discovered.please_type_one_of_escape_to_quit'],{0:33,1:63,2:61,3:47})
        self.assertIn('!?=/',output)


class AllCatalogFamilyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pairs = {}
        cls.unavailable = {}
        for family, (english, japanese, _) in CATALOG_FAMILIES.items():
            try:
                cls.pairs[family] = (
                    read_catalog(ROOT / 'locales' / english),
                    read_catalog(ROOT / 'locales' / japanese))
            except (OSError, ValueError) as error:
                cls.unavailable[family] = str(error)

    def test_required_families_are_available_as_valid_utf8_without_duplicate_keys(self):
        for family in CATALOG_FAMILIES:
            with self.subTest(family=family):
                self.assertNotIn(family, self.unavailable,
                    f'required family unavailable: {family}: '
                    f'{self.unavailable.get(family, "")}')

    def test_every_family_has_matching_schema_language_and_exact_id_sets(self):
        for family, (english, japanese) in self.pairs.items():
            with self.subTest(family=family):
                schema_key, language_key = (
                    ('version', 'locale') if family == 'ui-web' else ('schema', 'language'))
                self.assertIs(type(english[schema_key]), int)
                self.assertIs(type(japanese[schema_key]), int)
                self.assertEqual(english[schema_key], 1)
                self.assertEqual(japanese[schema_key], english[schema_key])
                self.assertEqual(english[language_key], 'en')
                self.assertEqual(japanese[language_key], 'ja')
            for section in CATALOG_FAMILIES[family][2]:
                with self.subTest(family=family, section=section):
                    self.assertIsInstance(english[section], dict)
                    self.assertIsInstance(japanese[section], dict)
                    self.assertTrue(english[section], 'Required presentation sections cannot be empty')
                    self.assertEqual(set(english[section]), set(japanese[section]),
                                     'Every English ID needs exactly one Japanese counterpart')

    def test_all_placeholders_match_in_name_index_and_occurrence_count(self):
        for family, (english, japanese) in self.pairs.items():
            for section in CATALOG_FAMILIES[family][2]:
                for ident, original in english[section].items():
                    with self.subTest(family=family, section=section, id=ident):
                        translated = japanese[section][ident]
                        source = presentation_text(original)
                        target = presentation_text(translated)
                        if PRINTF.search(source):
                            # Game printf arguments include signed * controls and
                            # explicit English-only grammar fields, never lost values.
                            kinds, conversions, controls = expected_signature(source)
                            self.assertIsInstance(translated, dict)
                            self.assertEqual(translated['argument_types'], kinds)
                            self.assertEqual(translated['conversions'], conversions)
                            self.assertEqual(translated['control_indexes'], controls)
                            grammar = translated.get('grammar_indexes', [])
                            self.assertEqual(len(grammar), len(set(grammar)))
                            self.assertTrue(set(grammar) <= set(range(len(kinds))))
                            for index in grammar:
                                self.assertTrue(translated.get('grammar_reason'))
                                self.assertTrue(translated.get('argument_sources', {}).get(str(index)))
                            required = collections.Counter(
                                str(index) for index in range(len(kinds))
                                if index not in controls and index not in grammar)
                        else:
                            required = placeholder_counts(source)
                            if isinstance(original, dict) and 'conversions' in original:
                                # Runtime templates are already indexed. Their
                                # conversion vector is still the original ABI order.
                                self.assertIsInstance(translated, dict)
                                conversions = original['conversions']
                                self.assertIsInstance(conversions, list)
                                self.assertEqual(translated['conversions'], conversions)
                                self.assertEqual(required, collections.Counter(
                                    str(index) for index in range(len(conversions))),
                                    'English indexed placeholders must match the conversion vector')
                                for conversion in conversions:
                                    self.assertIn(conversion, 'diuoxXfFeEgGaAcsp')
                                    self.assertEqual(len(conversion), 1)
                                if 'argument_types' in original:
                                    expected_types = [expected_signature('%' + conversion)[0][0]
                                                      for conversion in conversions]
                                    self.assertEqual(original['argument_types'], expected_types,
                                                     'Indexed argument types must agree with their conversions')
                            for metadata in ('argument_types', 'control_indexes'):
                                if isinstance(original, dict) and metadata in original:
                                    self.assertEqual(translated[metadata], original[metadata],
                                                     'Typed/index metadata must match across languages')
                                elif isinstance(translated, dict) and family != 'game':
                                    self.assertNotIn(metadata, translated,
                                                     'Indexed metadata must also be present in English')
                            grammar = (translated.get('grammar_indexes', [])
                                       if isinstance(translated, dict) else [])
                            if (family, section, ident) == ('runtime', 'messages', 'ui.untranslated'):
                                # Only the raw diagnostic string may stay audit-only;
                                # the Japanese UI presents a fixed warning instead.
                                self.assertEqual(source, '{0}')
                                self.assertEqual(original['conversions'], ['s'])
                                self.assertEqual(grammar, [0])
                                self.assertIs(type(grammar[0]), int)
                                self.assertIsInstance(translated.get('grammar_reason'), str)
                                self.assertTrue(translated.get('grammar_reason'),
                                                'Audit-only omission needs a documented reason')
                                required.subtract({'0': 1})
                                required = +required
                            elif (family, section, ident) == ('endings', 'messages', 'ui.ending.death_summary'):
                                # The first string is C's empty/a/an article. Death
                                # cause (1) and gold (2) remain mandatory values.
                                self.assertEqual(original['conversions'], ['s', 's', 'd'])
                                self.assertEqual(grammar, [0])
                                self.assertIs(type(grammar[0]), int)
                                article_source = translated.get('argument_sources', {}).get('0')
                                reason = translated.get('grammar_reason')
                                self.assertIsInstance(article_source, str)
                                self.assertTrue(article_source)
                                self.assertIsInstance(reason, str)
                                self.assertTrue(reason)
                                required.subtract({'0': 1})
                                required = +required
                            elif family != 'game':
                                self.assertEqual(grammar, [],
                                                 'No other indexed field may be omitted as grammar')
                        allowed_omission = OMITTED_NAMED_FIELDS.get(
                            (family, section, ident), collections.Counter())
                        self.assertTrue(allowed_omission <= required,
                                        'The documented grammar exception must still exist in English')
                        required.subtract(allowed_omission)
                        required = +required
                        self.assertEqual(placeholder_counts(target), required,
                                         'Only documented grammar/control fields may be omitted')
                        self.assertFalse(PRINTF.search(target),
                                         'Translated templates must not retain printf conversions')

    def test_every_japanese_presentation_leaf_is_translated_or_an_exact_exception(self):
        for family, (english, japanese) in self.pairs.items():
            rune_ids = set(english.get('tables', {}).get('scroll_syllables', []))
            for section in CATALOG_FAMILIES[family][2]:
                for ident, entry in japanese[section].items():
                    with self.subTest(family=family, section=section, id=ident):
                        text = presentation_text(entry)
                        source = presentation_text(english[section][ident])
                        key = family, section, ident
                        if isinstance(entry, dict):
                            self.assertFalse(entry.get('unresolved'), 'Unresolved text cannot ship')
                        if family == 'game':
                            # The original seven tests additionally verify control
                            # metadata, intentional empties and structural notation.
                            continue
                        if family == 'endings':
                            self.assertTrue(text, 'No empty ending entry has been approved')
                        if family == 'endings' and ident == 'ui.score.heading':
                            self.assertEqual(entry.get('argument_values'), {
                                '0': {'Ten': {'id': 'ui.score.number.ten', 'text': '10'}},
                                '1': {
                                    'Scores': {'id': 'ui.score.kind.scores', 'text': '得点'},
                                    'Rogueists': {'id': 'ui.score.kind.rogueists', 'text': '冒険者'},
                                },
                            }, 'All finite score-heading tokens must have reviewed mappings')
                        if isinstance(entry, dict):
                            for index, mapping in entry.get('argument_values', {}).items():
                                self.assertIsInstance(index, str)
                                self.assertTrue(index.isascii() and index.isdecimal())
                                self.assertLess(int(index), len(entry['conversions']))
                                self.assertEqual(entry['conversions'][int(index)], 's')
                                source_expression = entry.get('argument_sources', {}).get(index)
                                self.assertIsInstance(source_expression, str)
                                self.assertTrue(source_expression)
                                self.assertIsInstance(mapping, dict)
                                self.assertTrue(mapping)
                                for token, value in mapping.items():
                                    self.assertIsInstance(token, str)
                                    self.assertIsInstance(value, dict)
                                    self.assertIsInstance(value.get('id'), str)
                                    self.assertRegex(value['id'], r'^[a-z][a-z0-9_.]*$')
                                    self.assertIsInstance(value.get('text'), str)
                                    finite_key = family, ident, index, token
                                    if finite_key in FINITE_TEXT_EXCEPTIONS:
                                        self.assertEqual((value['id'], value['text']),
                                                         FINITE_TEXT_EXCEPTIONS[finite_key])
                                        self.assertEqual(source_expression, 'platform_system.h:Numname=Ten',
                                                         'Decimal exception must retain its source-defined token')
                                    else:
                                        self.assertRegex(value['text'], CJK,
                                                         'Finite text needs Japanese unless this exact token is exempt')
                        if key in LITERAL_EXCEPTIONS:
                            self.assertEqual(text, LITERAL_EXCEPTIONS[key])
                            self.assertEqual(source, text)
                        elif family == 'entities' and section == 'entries' and ident in rune_ids:
                            # These are the original randomized scroll runes, not prose.
                            self.assertTrue(ident.startswith('scroll.syllable.'))
                            self.assertRegex(text, r'^[a-z]+$')
                            self.assertEqual(text, source)
                        elif not text:
                            self.assertIsInstance(entry, dict,
                                                  'Empty grammar needs an explicit reason')
                            self.assertTrue(entry.get('intentional_empty_reason'))
                        elif key in STRUCTURAL_EXCEPTIONS:
                            if family == 'endings':
                                self.assertIs(entry.get('notation_only'), True)
                                self.assertIs(english[section][ident].get('notation_only'), True)
                            literal = ''.join(part[0] for part in string.Formatter().parse(text))
                            self.assertFalse(re.search(r'[A-Za-z]', literal),
                                             'Structural exceptions cannot conceal untranslated words')
                        else:
                            self.assertRegex(text, CJK, 'Japanese prose must contain Japanese text')
                            self.assertNotEqual(text, source,
                                                'Unchanged English is not a reviewed translation')

    def test_all_string_leaves_are_valid_unicode_without_replacement_characters(self):
        for family, pair in self.pairs.items():
            for language, catalog in zip(('en', 'ja'), pair):
                for path, text in string_leaves(catalog):
                    with self.subTest(family=family, language=language, path=path):
                        self.assertNotIn('\ufffd', text)
                        self.assertFalse(re.search(r'[\ud800-\udfff]', text),
                                         'Unpaired escaped surrogates are invalid Unicode')

    def test_entity_tables_and_source_records_match_and_reference_existing_ids(self):
        if 'entities' not in self.pairs:
            self.fail('required family unavailable: entities')
        english, japanese = self.pairs['entities']
        self.assertEqual(english['tables'], japanese['tables'])
        self.assertEqual(english['source_tables'], japanese['source_tables'])
        for language, catalog in zip(('en', 'ja'), (english, japanese)):
            for table, references in catalog['tables'].items():
                with self.subTest(language=language, table=table):
                    self.assertIsInstance(references, list)
                    self.assertTrue(references)
                    self.assertTrue(set(references) <= set(catalog['entries']),
                                    'Every indexed entity reference must resolve')

    def test_merged_message_id_collisions_are_exact_documented_aliases(self):
        for family in MERGED_MESSAGE_FAMILIES:
            self.assertIn(family, self.pairs, f'required family unavailable: {family}')
        for language_index, language in enumerate(('en', 'ja')):
            occurrences = collections.defaultdict(dict)
            for family in MERGED_MESSAGE_FAMILIES:
                for ident, entry in self.pairs[family][language_index]['messages'].items():
                    occurrences[ident][family] = entry
            collisions = {ident: frozenset(entries) for ident, entries in occurrences.items()
                          if len(entries) > 1}
            with self.subTest(language=language):
                self.assertEqual(collisions, MESSAGE_ALIASES,
                                 'Only exact documented ID/family aliases may collide in the merged lookup')
            for ident, families in collisions.items():
                with self.subTest(language=language, id=ident):
                    entries = [occurrences[ident][family] for family in sorted(families)]
                    self.assertEqual(presentation_text(entries[0]), presentation_text(entries[1]),
                                     'Alias priority must not change the displayed template')
                    if all(isinstance(entry, dict) for entry in entries):
                        for metadata in (set(entries[0]) & set(entries[1])) - {'template'}:
                            self.assertEqual(entries[0][metadata], entries[1][metadata],
                                             f'Alias metadata must agree: {metadata}')

    def test_utf8_and_duplicate_key_guards_reject_invalid_catalog_data(self):
        for raw, pattern in (
                (b'\xef\xbb\xbf{}', 'UTF-8 BOM'),
                (b'{"nested":{"id":1,"id":2}}', 'duplicate JSON key'),
                (b'{"id":1,"id":2}', 'duplicate JSON key')):
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, pattern):
                decode_catalog(raw)
        with self.assertRaises(UnicodeDecodeError):
            decode_catalog(b'{"text":"\xff"}')

    def test_placeholder_parser_preserves_repeated_fields_and_rejects_invalid_syntax(self):
        self.assertEqual(placeholder_counts('{name} {0} {name}'),
                         collections.Counter({'name': 2, '0': 1}))
        self.assertEqual(placeholder_counts('{{literal}} {count}'),
                         collections.Counter({'count': 1}))
        self.assertNotEqual(placeholder_counts('{actor}{target}'),
                            placeholder_counts('{actor}{actor}'))
        for text in ('{}', '{name!r}', '{name:03}', '{user.name}', '{name', '{名前}'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                placeholder_counts(text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
