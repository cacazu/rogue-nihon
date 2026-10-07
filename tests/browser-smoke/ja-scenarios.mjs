import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export async function prepareJapanese(cdp, evidence) {
  assert.equal(await cdp.evaluate("__rogueBrowserTest.language"), "ja");
  await cdp.evaluate("document.getElementById('name').value='界'.repeat(17);document.getElementById('new-game').click();");
  assert.equal(await cdp.evaluate("__rogueBrowserTest.generation"), 0);
  assert.match(await cdp.evaluate("document.getElementById('notice').textContent"), /49/);
  await cdp.evaluate("document.getElementById('name').value='風来の勇者';");
  evidence.checks.push("Japanese UI validates the 49-byte UTF-8 name limit before starting");
}

export async function japaneseScenarios(cdp, until, evidence, output) {
  const screenshot = async (file) => {
    const capture = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const bytes = Buffer.from(capture.data, "base64"), width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.ok(width >= 320 && height >= 300, "screen capture contains a complete visible layout");
    await writeFile(path.join(output, file), bytes);
    (evidence.ja_screenshots ??= []).push({ file, width, height, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  const count = () => cdp.evaluate("__rogueBrowserTest.inputRequestCount");
  const key = async (character, label) => {
    const before = await count();
    await cdp.evaluate("__rogueBrowserTest.enqueue(" + character.codePointAt(0) + ");");
    await until(() => cdp.evaluate("__rogueBrowserTest.inputRequestCount > " + before), label);
  };
  const assertNoFallback = async (label) => {
    const record = await cdp.evaluate("({fallbacks:__rogueBrowserTest.translationFallbacks,missing:__rogueBrowserTest.uiMissing})");
    assert.deepEqual(record, { fallbacks: [], missing: [] }, label);
  };
  const first = await cdp.evaluate("({ui:__rogueBrowserTest.frame.ui,map:__rogueBrowserTest.frame.map_cells,cells:__rogueBrowserTest.frame.cells})");
  assert.equal(first.ui.name, "風来の勇者");
  assert.match(first.ui.status.text, /[\u3040-\u30ff\u3400-\u9fff]/u);
  assert.equal(first.map.length, first.cells.length);
  assert.doesNotMatch(first.map, /Level:|Gold:|Hp:|Press space|Some food/);
  await assertNoFallback("initial and restored menu translations");
  await screenshot("ja-game.png");
  evidence.checks.push("Japanese real name and translated status render outside ASCII map cells");

  await key("?", "help question");
  await key("*", "full help listing");
  await until(() => cdp.evaluate("__rogueBrowserTest.frame.ui.mode === 'help'"), "Japanese help view");
  const help = await cdp.evaluate("({ui:__rogueBrowserTest.frame.ui,text:document.getElementById('presentation-lines').innerText,height:document.getElementById('log-scroll').scrollHeight,client:document.getElementById('log-scroll').clientHeight})");
  assert.ok(help.ui.lines.length >= 20);
  assert.match(help.text, /[\u3040-\u30ff\u3400-\u9fff]/u);
  assert.ok(help.height > help.client, "help remains vertically scrollable");
  assert.equal(await cdp.evaluate("document.querySelector('.board-scroll').hidden"), false, "map area remains while menu lives in logs");
  await screenshot("ja-help-top.png");
  await cdp.evaluate("document.getElementById('log-scroll').scrollTop=document.getElementById('log-scroll').scrollHeight;");
  await screenshot("ja-help-bottom.png");
  const measureWrapping = () => cdp.evaluate("(()=>{const e=document.getElementById('presentation-lines');return {viewport:innerWidth,text:e.innerText,scroll:e.scrollWidth,client:e.clientWidth,wrapped:[...e.children].some(l=>l.getBoundingClientRect().height>parseFloat(getComputedStyle(l).lineHeight)*1.5),lines:[...e.children].map(l=>{const r=document.createRange();r.selectNodeContents(l);return {text:l.textContent,textWidth:r.getBoundingClientRect().width,width:l.getBoundingClientRect().width,height:l.getBoundingClientRect().height,lineHeight:getComputedStyle(l).lineHeight,font:getComputedStyle(l).fontSize}})}})()");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 850, deviceScaleFactor: 1, mobile: false });
  const at360 = await measureWrapping();
  evidence.help_wrapping_360 = at360;
  assert.equal(at360.viewport, 360);
  assert.equal(at360.text, help.text, "all Japanese help text remains available at 360px");
  assert.ok(at360.scroll <= at360.client + 1, "Japanese descriptions do not overflow horizontally at 360px");
  await screenshot("ja-help-360.png");
  // Real 14px help fits at 360px in both baseline and unified layouts. At 320px it must wrap.
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 320, height: 850, deviceScaleFactor: 1, mobile: false });
  const wrapping = await measureWrapping();
  evidence.help_wrapping = wrapping;
  assert.equal(wrapping.viewport, 320);
  assert.equal(wrapping.text, help.text, "all Japanese help text remains available at 320px");
  assert.ok(wrapping.scroll <= wrapping.client + 1, "Japanese descriptions do not overflow horizontally");
  assert.ok(wrapping.wrapped, "actual Japanese help descriptions wrap at a narrow width");
  await screenshot("ja-help-wrap.png");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1240, height: 900, deviceScaleFactor: 1, mobile: false });
  await assertNoFallback("help translations");
  evidence.help = help.ui; evidence.checks.push("Japanese help scrolls and wraps without truncation or English fallback");
  await key(" ", "help acknowledgement");
  assert.equal(await cdp.evaluate("document.querySelector('.board-scroll').hidden"), false, "game map returns after the menu");

  await key("~", "localized illegal-command message");
  const message = await cdp.evaluate("__rogueBrowserTest.messages.filter(m=>m.text).at(-1)");
  assert.match(message.text, /[\u3040-\u30ff\u3400-\u9fff]/u);
  assert.equal(Boolean(message.fallback_used), false);
  evidence.checks.push("Original game messages are displayed in Japanese through semantic IDs");

  await key("c", "name-item selection prompt");
  await key("c", "weapon-name text prompt");
  await until(() => cdp.evaluate("!document.getElementById('text-prompt').hidden"), "IME text field visible");
  const beforeComposition = await count();
  await cdp.evaluate("(()=>{const e=document.getElementById('prompt-text');e.focus();e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true,isComposing:true}));e.value='旅人';e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'旅人',isComposing:true}));e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'旅人'}));})()");
  assert.equal(await count(), beforeComposition, "IME composition has not sent game commands");
  await screenshot("ja-text-draft.png");
  await cdp.evaluate("document.getElementById('save').click();");
  await until(() => cdp.evaluate("__rogueBrowserTest.savedLength > 0 && !__rogueBrowserTest.savePending && __rogueBrowserTest.queuePending === 0"), "partial Japanese text save");
  const saved = await cdp.evaluate("({trace:__rogueBrowserTest.trace,generation:__rogueBrowserTest.generation})");
  await cdp.evaluate("document.getElementById('load').click();");
  await until(() => cdp.evaluate("__rogueBrowserTest.generation > " + saved.generation + " && __rogueBrowserTest.inputRequestCount > 0 && !document.getElementById('text-prompt').hidden"), "pending UTF-8 text restore");
  assert.deepEqual(await cdp.evaluate("__rogueBrowserTest.trace.words"), saved.trace.words);
  assert.equal(await cdp.evaluate("document.getElementById('prompt-text').value"), "旅人");
  await screenshot("ja-text-restored.png");
  evidence.checks.push("IME draft saves as a pending UTF-8 input journal and restores the exact logical trace and text");

  await cdp.evaluate("(()=>{const e=document.getElementById('prompt-text');e.value='長い長い旅人の大切なメイス';e.dispatchEvent(new InputEvent('input',{bubbles:true}));document.getElementById('text-prompt').requestSubmit();})()");
  await until(() => cdp.evaluate("document.getElementById('text-prompt').hidden && __rogueBrowserTest.queuePending === 0"), "Japanese item name committed");
  await key("i", "named-item inventory");
  const items = await cdp.evaluate("({ui:__rogueBrowserTest.frame.ui,text:document.getElementById('presentation-lines').innerText})");
  assert.match(items.text, /長い長い旅人の大切なメイス/u);
  assert.match(items.text, /[\u3040-\u30ff\u3400-\u9fff]/u);
  await screenshot("ja-inventory.png");
  await assertNoFallback("named inventory translations");
  evidence.inventory_ja = items.ui; evidence.checks.push("Japanese named items and original item keys appear in the inventory");
  await key(" ", "named inventory acknowledgement");
  await key("w", "wield item selection");
  await key("c", "select the named weapon by its original item key");
  evidence.checks.push("Original item-selection keys still operate on translated Japanese items");

  await key("o", "Japanese options");
  await until(() => cdp.evaluate("__rogueBrowserTest.frame.ui.mode === 'options'"), "Japanese options view");
  assert.match(await cdp.evaluate("document.getElementById('presentation-lines').innerText"), /[\u3040-\u30ff\u3400-\u9fff]/u);
  assert.doesNotMatch(await cdp.evaluate("document.getElementById('presentation-lines').innerText"), /slime-mold/i);
  await assertNoFallback("options translations");
  await screenshot("ja-options.png");
  for (let index = 0; index < 7; index++) await key("\r", "keep original option value " + index);
  await until(() => cdp.evaluate("!document.getElementById('text-prompt').hidden"), "player-name option editor");
  assert.equal(await cdp.evaluate("document.getElementById('prompt-text').value"), "風来の勇者");
  await cdp.evaluate("(()=>{const e=document.getElementById('prompt-text');e.value='白銀の旅人';e.dispatchEvent(new InputEvent('input',{bubbles:true}));document.getElementById('text-prompt').requestSubmit();})()");
  await until(() => cdp.evaluate("__rogueBrowserTest.frame.ui.name === '白銀の旅人'"), "Japanese player-name change");
  await until(() => cdp.evaluate("!document.getElementById('text-prompt').hidden && document.getElementById('prompt-text').placeholder.length > 0"), "localized unchanged-fruit placeholder");
  const fruitEditor = await cdp.evaluate("({value:document.getElementById('prompt-text').value,placeholder:document.getElementById('prompt-text').placeholder})");
  assert.equal(fruitEditor.value, "", "the unchanged original fruit value is kept by empty input");
  assert.match(fruitEditor.placeholder, /[\u3040-\u30ff\u3400-\u9fff]/u);
  assert.doesNotMatch(fruitEditor.placeholder, /slime-mold/i);
  await screenshot("ja-name-editor.png");
  await key("\u001b", "leave option editing");
  await key(" ", "options acknowledgement");
  assert.equal(await cdp.evaluate("document.getElementById('player-name').textContent"), "白銀の旅人");
  evidence.checks.push("Original options and player-name editor display and accept Japanese text");

  await key("Q", "quit confirmation");
  await key("y", "confirm original quit command");
  await cdp.evaluate("__rogueBrowserTest.enqueue(13);");
  await until(() => cdp.evaluate("!__rogueBrowserTest.running && __rogueBrowserTest.frame.ui.mode === 'score'"), "Japanese score view after quit");
  const score = await cdp.evaluate("__rogueBrowserTest.frame.ui");
  assert.ok(score.lines.some(line => line.id === "ui.score.heading"));
  assert.ok(!score.lines.some(line => line.id === "ui.ending.return"), "completed score view removes the consumed return prompt");
  assert.equal(score.input.kind, "ended");
  assert.equal(await cdp.evaluate("document.querySelector('.log-column #game-message') !== null"), true, "game history remains available after ending");
  assert.equal(await cdp.evaluate("document.getElementById('presentation-hint').hidden"), true);
  assert.equal(await cdp.evaluate("document.getElementById('connection') === null"), true);
  assert.equal(await cdp.evaluate("document.getElementById('screen-status').textContent"), "ゲームを終了しました");
  assert.match(await cdp.evaluate("document.getElementById('presentation-lines').innerText"), /[\u3040-\u30ff\u3400-\u9fff]/u);
  await screenshot("ja-score.png");
  evidence.score_ja = score;
  evidence.checks.push("Original quit command ends the game with a translated Japanese score screen");
  await assertNoFallback("all executed Japanese screens");
  evidence.ja_fallbacks = await cdp.evaluate("__rogueBrowserTest.translationFallbacks");
  evidence.checks.push("Executed Japanese messages, status, help, item lists and text prompts report zero fallback or missing UI IDs");
}
