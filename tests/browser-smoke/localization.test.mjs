import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const canvas = await readFile(new URL("../../rust/crates/browser-display/src/controller.rs", import.meta.url), "utf8");
  const widgets = (await Promise.all(["screens.rs","hud.rs"].map(file=>readFile(new URL("../../rust/crates/display/src/browser_ui/"+file,import.meta.url),"utf8")))).join("\n");
  const ids = [...Array.from(html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g), (match) => match[1]), ...Array.from((app+"\n"+canvas+"\n"+widgets).matchAll(/\b(?:notice|t|label)\("([^"]+)"(?=\s*[,)])/g), (match) => match[1])];
  for (const id of ids) assert.equal(typeof catalogs.ja.messages[id], "string", id);
});
// Runtime catalog and UTF-8 validation tests now live in the Rust controller crate.

test("Version footer exposes only GitHub distribution and license guidance", async () => {
  const app = await readFile(new URL("../../rust/crates/browser-display/src/controller.rs", import.meta.url), "utf8");
  const links = Array.from(app.matchAll(/"url"\s*:\s*"(https:[^"]+)"/g), match => match[1]);
  assert.deepEqual(links, ["https://github.com/cacazu/jrogue/tree/main/rogue-nihon", "https://github.com/cacazu/jrogue/blob/main/rogue-nihon/docs/LICENSES-ja.md"]);
  for (const catalog of Object.values(catalogs)) {
    const text = Object.entries(catalog.messages).filter(([id]) => id.startsWith("credits.")).map(([, value]) => value).join(" ");
    assert.doesNotMatch(text, /\b(?:Rust|Worker|Wasm|ABI|C)\b|表示・入力・プラットフォーム/);
  }
  const guide = await readFile(new URL("../../docs/LICENSES-ja.md", import.meta.url), "utf8");
  assert.match(guide, /https:\/\/raw\.githubusercontent\.com\/cacazu\/jrogue\/main\/rogue-nihon\/distribution\/rogue-5\.4\.4-licenses\.zip/);
});

test("Selection guidance describes only the user's action", () => {
  assert.equal(catalogs.ja.messages['instruction.selection'], '表示された持ち物キーで選びます。');
  assert.equal(catalogs.en.messages['instruction.selection'], 'Choose a displayed item key.');
});
