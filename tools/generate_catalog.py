"""Generate meaningful message IDs and source-site metadata from the C logic.

Line numbers locate calls in a build; IDs depend on function and English meaning,
never on the source line or a hash. Runtime-composed formats remain explicit legacy
fallbacks rather than being presented as translated messages.
"""

from __future__ import annotations

import argparse
import ast
import bisect
import collections
import json
import pathlib
import re

TOKEN = re.compile(
    r'(?P<skip>\s+|/\*.*?\*/|//[^\n]*)'
    r'|(?P<string>"(?:\\.|[^"\\])*")'
    r"|(?P<char>'(?:\\.|[^'\\])*')"
    r'|(?P<identifier>[A-Za-z_]\w*)|(?P<other>.)', re.S
)
PRINTF = re.compile(r'%(?:[-+ #0]*)(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|ll|[hljztL])?[diuoxXfFeEgGaAcspn%]')


def tokens(source):
    return [(match.lastgroup, match.group(), match.start(), match.end())
            for match in TOKEN.finditer(source) if match.lastgroup != 'skip']


def closing(items, start, left='(', right=')'):
    depth = 0
    for index in range(start, len(items)):
        text = items[index][1]
        if text == left:
            depth += 1
        elif text == right:
            depth -= 1
            if depth == 0:
                return index
    raise ValueError(f'unbalanced {left} at token {start}')


def arguments(items, start, end):
    groups, group = [], []
    nesting = 0
    for token in items[start:end]:
        text = token[1]
        if text in ('(', '[', '{'):
            nesting += 1
        elif text in (')', ']', '}'):
            nesting -= 1
        if text == ',' and nesting == 0:
            groups.append(group)
            group = []
        else:
            group.append(token)
    groups.append(group)
    return groups


def first_argument_literals(items):
    values, pending = [], []
    for token in items + [('other', '', 0, 0)]:
        if token[0] == 'string':
            pending.append(ast.literal_eval(token[1]))
        elif pending:
            values.append(''.join(pending))
            pending = []
    return list(dict.fromkeys(values))


def source_calls(path):
    source = path.read_text(encoding='utf-8')
    items = tokens(source)
    line_ends = [match.start() for match in re.finditer('\n', source)]
    function, brace_depth = None, 0
    for index, token in enumerate(items):
        text = token[1]
        if text == '{':
            if brace_depth == 0 and index and items[index - 1][1] == ')':
                depth, begin = 1, index - 2
                while begin >= 0 and depth:
                    if items[begin][1] == ')':
                        depth += 1
                    elif items[begin][1] == '(':
                        depth -= 1
                    begin -= 1
                if begin >= 0 and items[begin][0] == 'identifier':
                    function = items[begin][1]
            brace_depth += 1
        elif text == '}':
            brace_depth -= 1
            if brace_depth == 0:
                function = None
        # rogue.h's debug macro expands to msg at the caller's source line.
        if function and text in ('msg', 'addmsg', 'debug') and index + 1 < len(items) and items[index + 1][1] == '(':
            end = closing(items, index + 1)
            groups = arguments(items, index + 2, end)
            yield {
                'file': path.name,
                'line': bisect.bisect_left(line_ends, token[2]) + 1,
                'function': function,
                'call': text,
                'argument_count': max(0, len(groups) - 1),
                'expression': ''.join(part[1] for part in groups[0]),
                'formats': first_argument_literals(groups[0]),
            }


def meaning(template):
    words = re.findall(r'[a-z]+', PRINTF.sub(' ', template).lower().replace("'", ''))
    if words:
        return '_'.join(words)
    if template == '':
        return 'clear'
    if template.strip() == '.':
        return 'sentence_separator'
    if template.strip() == "'":
        return 'possessive_apostrophe'
    if template.strip().startswith('?'):
        return 'question_prompt'
    names = {'s': 'string', 'c': 'character', 'd': 'number', 'i': 'number',
             'u': 'unsigned', 'f': 'float', 'x': 'hexadecimal'}
    kinds = [names.get(spec[-1].lower(), 'value') for spec in PRINTF.findall(template) if spec != '%%']
    return '_'.join(kinds) or 'punctuation'


def assign_ids(calls, previous=None):
    # Use all meaning words to avoid line-dependent collision suffixes.
    templates = {}
    retained = {}
    for ident, entry in (previous or {}).items():
        if not isinstance(entry, dict) or 'source' not in entry or 'function' not in entry:
            continue
        key = (entry['source'].split(':', 1)[0], entry['function'], entry['template'])
        retained[key] = ident
        templates[ident] = entry['template']
    active = {}
    for call in calls:
        for fmt in call['formats']:
            if not fmt:
                continue
            base = f"{pathlib.Path(call['file']).stem}.{call['function']}.{meaning(fmt)}"
            candidate = retained.get((call['file'], call['function'], fmt), base)
            if candidate in templates and templates[candidate] != fmt:
                if fmt.startswith(' '):
                    candidate += '_leading_space'
                elif fmt.endswith(' '):
                    candidate += '_trailing_space'
                elif fmt[:1].isupper():
                    candidate += '_capitalized'
                else:
                    candidate += '_plain'
                if candidate in templates and templates[candidate] != fmt:
                    # Punctuation is meaning too; keep distinctions deterministic.
                    marks = {'?': 'question', '!': 'exclamation', '.': 'period', ':': 'colon',
                             '(': 'opening_parenthesis', ')': 'closing_parenthesis', "'": 'apostrophe'}
                    candidate += '_' + '_'.join(marks[ch] for ch in fmt if ch in marks)
            if candidate in templates and templates[candidate] != fmt:
                raise ValueError(f'meaningful ID collision: {candidate}: {fmt!r}')
            templates[candidate] = fmt
            active[candidate] = fmt
            call.setdefault('ids', {})[fmt] = candidate
    return active


def generate(root):
    calls = [call for path in sorted((root / 'logic').glob('*.c')) for call in source_calls(path)]
    previous_path = root / 'locales' / 'en.json'
    previous = json.loads(previous_path.read_text(encoding='utf-8')).get('messages', {}) if previous_path.exists() else {}
    templates = assign_ids(calls, previous)
    entries = {
        'message.sequence': {'template': '', 'note': 'structured sequence of message_part values'},
        'message.clear': {'template': '', 'note': 'clear the current message'},
        'message.legacy': {'template': '', 'note': 'runtime-composed English fallback; not a translated template'},
    }
    sites = []
    formats = collections.Counter()
    for call in calls:
        for fmt in call['formats']:
            if not fmt:
                continue
            ident = call['ids'][fmt]
            entries.setdefault(ident, {'template': fmt, 'source': f"{call['file']}:{call['line']}",
                                       'function': call['function'], 'note': 'original English printf format'})
            sites.append((call['file'], call['line'], fmt, ident, call['argument_count']))
            formats.update(PRINTF.findall(fmt))
        # Fallback metadata is also used to safely handle zero-vararg dynamic text.
        sites.append((call['file'], call['line'], None, None, call['argument_count']))
    catalog = {'schema': 1, 'language': 'en', 'messages': dict(sorted(entries.items()))}
    (root / 'locales').mkdir(exist_ok=True)
    (root / 'locales' / 'en.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    c_quote = lambda value: 'NULL' if value is None else json.dumps(value, ensure_ascii=True)
    c_rows = [f'    {{{c_quote(file)}, {line}, {c_quote(fmt)}, {c_quote(ident)}, {argc}}},'
              for file, line, fmt, ident, argc in sites]
    (root / 'logic' / 'message_catalog.inc').write_text(
        '/* Generated by tools/generate_catalog.py. IDs do not encode source line numbers. */\n'
        'static const struct rg_message_site rg_message_sites[] = {\n'
        + '\n'.join(c_rows) + '\n};\n', encoding='utf-8')
    coverage = {
        'schema': 1,
        'count_basis': 'all C source msg/addmsg/debug sites, including inactive conditional and legacy OS code',
        'calls': len(calls),
        'literal_template_ids': len(templates),
        'literal_or_choice_calls': sum(bool(call['formats']) for call in calls),
        'dynamic_calls': [{key: value for key, value in call.items() if key != 'ids'}
                          for call in calls if not call['formats']],
        'printf_formats': dict(sorted(formats.items())),
        'limitations': ['runtime names, item purpose/name fragments and English grammar are not yet ID-separated',
                        'curses printw/addstr/menu/status text outside msg/addmsg is outside this catalog'],
    }
    (root / 'locales' / 'coverage.json').write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: coverage[key] for key in ('calls', 'literal_template_ids', 'literal_or_choice_calls', 'printf_formats')}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    generate(parser.parse_args().root)
