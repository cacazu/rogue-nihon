"""Check source mapping and stable IDs without editing the source checkout."""
import importlib.util
import pathlib
import tempfile
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / 'tools' / 'generate_catalog.py'
spec = importlib.util.spec_from_file_location('catalog', MODULE_PATH)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class CatalogChecks(unittest.TestCase):
    def source(self, text):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / 'fight.c'
            path.write_text(text, encoding='utf-8')
            return list(catalog.source_calls(path))

    def test_literals_choices_nested_arguments_and_debug(self):
        calls = self.source(r'''
void hit(void) {
    // msg("comment decoy");
    char *label = "msg(\"string decoy\")";
    msg(choose_str("hit %s", "miss %s"), monster_name(obj));
    addmsg("adjacent " "literals %d", count(obj, 2));
    debug("damage %d", damage(3, 4));
    msg(label);
}
''')
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(call['function'] == 'hit' for call in calls))
        self.assertEqual(calls[0]['formats'], ['hit %s', 'miss %s'])
        self.assertEqual(calls[1]['formats'], ['adjacent literals %d'])
        self.assertEqual(calls[2]['call'], 'debug')
        self.assertEqual(calls[3]['argument_count'], 0)
        self.assertEqual(calls[3]['formats'], [])

    def test_line_changes_preserve_meaningful_id(self):
        source = 'void hit(void) { msg("the arrow misses %s", name); }\n'
        before, after = self.source(source), self.source('\n\n' + source)
        self.assertNotEqual(before[0]['line'], after[0]['line'])
        before_ids, after_ids = catalog.assign_ids(before), catalog.assign_ids(after)
        self.assertEqual(before_ids, after_ids)
        self.assertEqual(list(before_ids), ['fight.hit.the_arrow_misses'])

    def test_existing_collision_id_retained_when_new_call_precedes_it(self):
        previous = {'fight.hit.ouch': {'template': 'ouch', 'source': 'fight.c:99', 'function': 'hit'}}
        calls = self.source('void hit(void) { msg("ouch!"); msg("ouch"); }\n')
        ids = catalog.assign_ids(calls, previous)
        self.assertEqual(calls[1]['ids']['ouch'], 'fight.hit.ouch')
        self.assertNotEqual(calls[0]['ids']['ouch!'], 'fight.hit.ouch')
        self.assertEqual(ids['fight.hit.ouch'], 'ouch')


if __name__ == '__main__':
    unittest.main()
