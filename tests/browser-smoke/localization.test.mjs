import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), Catalog = require("../../web/localization.js");
const catalogs = Object.fromEntries(await Promise.all(["ja", "en"].map(async (locale) => [locale, JSON.parse(await readFile(new URL("../../locales/ui-web-" + locale + ".json", import.meta.url), "utf8"))])));

test("UI catalogs have identical semantic IDs and named argument contracts", () => {
  assert.deepEqual(Object.keys(catalogs.ja.messages).sort(), Object.keys(catalogs.en.messages).sort());
  for (const id of Object.keys(catalogs.ja.messages)) {
    const placeholders = (text) => Array.from(text.matchAll(/\{([a-zA-Z_][a-zA-Z_0-9]*)\}/g), (match) => match[1]).sort();
    assert.deepEqual(placeholders(catalogs.ja.messages[id]), placeholders(catalogs.en.messages[id]), id);
    assert.equal(catalogs.ja.messages[id].includes("\ufffd"), false, id);
  }
});
test("Every static interface label and direct notice ID has an entry", async () => {
  const html = await readFile(new URL("../../web/index.html", import.meta.url), "utf8"), app = await readFile(new URL("../../web/app.js", import.meta.url), "utf8");
  const ids = [...Array.from(html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g), (match) => match[1]), ...Array.from(app.matchAll(/\b(?:notice|t)\("([^"]+)"/g), (match) => match[1])];
  for (const id of ids) assert.equal(typeof catalogs.ja.messages[id], "string", id);
});
test("UI argument text stays literal and missing Japanese IDs never fall back to English", () => {
  const catalog = new Catalog(catalogs, "ja");
  assert.equal(catalog.text("notice.input_flush", { count: "<script>1</script>" }).includes("<script>1</script>"), true);
  assert.throws(() => catalog.text("missing.id"), /Missing UI catalog entry/);
  assert.deepEqual(catalog.missing, [{ locale: "ja", id: "missing.id" }]);
});
test("UTF-8 input budget accepts Japanese and rejects overlong or control input", () => {
  assert.equal(Catalog.validText("勇者".repeat(8), 49, false), true);
  assert.equal(Catalog.validText("勇者".repeat(9), 49, false), false);
  assert.equal(Catalog.validText("勇者\0", 49, false), false);
  assert.equal(Catalog.validText("", 49, false), false);
  assert.equal(Catalog.validText("", 50), true);
});
