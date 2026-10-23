// Confirmed quit shows the populated score through playable bindings, without test exports.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,browserExecutable} from '../../tools/toolchain.mjs';
import {artifactDirectory} from '../../tools/temporary-artifacts.mjs';
import {prepareBrowserRuntime} from './browser-runtime.mjs';
import {createPreviewServer} from '../../tools/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ROGUE_QUIT_OUTPUT||artifactDirectory(path.join(root,'tests/browser-smoke/output/quit-flow'));
await mkdir(output,{recursive:true});
const runtime=await prepareBrowserRuntime(root),server=createPreviewServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await loadPlaywright().chromium.launch({executablePath:browserExecutable(),headless:true,downloadsPath:runtime.downloadsPath});
const evidence={checks:[],errors:[],console:[],responses:[]};let context,page;
try{
 for(const phone of [false,true]){
  context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1400,height:900},hasTouch:phone,isMobile:phone});
  await context.addInitScript(()=>{const Native=window.Worker;window.__quitMessages=[];window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',event=>window.__quitMessages.push(event.data));}};});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>evidence.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')evidence.console.push({phone,text:message.text(),location:message.location()});});page.on('response',response=>{if(response.status()>=400)evidence.responses.push({phone,url:response.url(),status:response.status()});});
  if(process.env.ROGUE_QUIT_DIAGNOSTICS==='1'){const {installBrowserTestAdapter}=await import('./test-adapter.mjs');await installBrowserTestAdapter(page);}
  await page.goto('http://127.0.0.1:'+server.address().port+'/?trace=1&lang=ja&view=pixels');
  const tap=async id=>{const locator=page.locator('[data-control="'+id+'"]:enabled');await locator.waitFor();if(phone)await locator.tap();else await locator.click();};
  await page.locator('[data-control="new-game"]:enabled').waitFor();await page.locator('#seed').fill('17');await page.locator('#name').fill('QuitCheck');await tap('new-game');
  await page.waitForFunction(()=>{const o=JSON.parse(document.querySelector('#rogue-observation').textContent);return o.running&&o.input?.kind==='command';});
  const beforeQuit=await page.evaluate(()=>JSON.parse(document.querySelector('#rogue-observation').textContent));
  await tap('settings-toggle');await tap('mobile-system-81');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#rogue-observation').textContent).input?.kind==='confirm');
  await page.screenshot({path:path.join(output,(phone?'phone':'pc')+'-confirmation.png')});
  await tap('window-121');
  await page.waitForFunction(()=>window.__quitMessages.some(event=>event.type==='presentation'&&event.ui.lines.some(line=>line.id==='ui.score.heading')));
  await page.locator('[data-control="result-top"]:enabled').waitFor();
  await page.waitForFunction(()=>window.__quitMessages.some(event=>event.type==='exit'&&event.code===3));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const observed=await page.evaluate(()=>({public:JSON.parse(document.querySelector('#rogue-observation').textContent),messages:window.__quitMessages,diagnostics:window.__rogueUiAdapter?.state}));
  const score=observed.messages.find(event=>event.type==='presentation'&&event.ui.lines.some(line=>line.id==='ui.score.heading'));
  const heading=score.ui.lines.find(line=>line.id==='ui.score.heading').text;
  assert.ok(observed.public.lines.some(line=>line.text===heading),'populated score is painted before another key');
  assert.ok(score.ui.lines.some(line=>line.id==='ui.score.columns'),'score renders its real ranking columns even when a zero score does not enter the table');
  assert.equal(observed.messages.some(event=>event.type==='input-context'&&event.input.id==='input.show_score'),false,'quit has no empty pre-score acknowledgement');
  assert.ok(observed.messages.filter(event=>event.type==='frame').every(frame=>frame.ui.mode!=='game'||frame.map_unknown_glyphs.length===0),'terminal ASCII must never be projected as an unmapped dungeon frame');
  assert.ok(!observed.public.text.some(text=>text.includes('画面を表示できません')),'score must not retain system display failure notices');
  if(observed.diagnostics){assert.equal(observed.diagnostics.runtimeError,null);assert.deepEqual(observed.diagnostics.uiMissing,[]);assert.deepEqual(observed.diagnostics.translationFallbacks,[]);assert.ok(!observed.diagnostics.entries.some(entry=>entry.source==='system'&&entry.error));}
  const raster=await page.evaluate(()=>{const canvas=document.querySelector('#rogue-canvas'),board=canvas.getBoundingClientRect(),close=document.querySelector('[data-control="result-top"]').getBoundingClientRect(),ratio=canvas.width/board.width;const panelWidth=Math.min(600,board.width-28),rect={x:close.right+8-panelWidth+20-board.left,y:close.top+55-board.top,w:Math.min(280,panelWidth-40),h:85};const rgba=canvas.getContext('2d').getImageData(Math.round(rect.x*ratio),Math.round(rect.y*ratio),Math.round(rect.w*ratio),Math.round(rect.h*ratio)).data;let bright=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i]>150&&rgba[i+1]>150&&rgba[i+2]>150)bright++;return {rect,bright};});
  assert.ok(raster.bright>100,'Actual Canvas score heading/columns region contains painted text, not a metadata-only result');
  await page.screenshot({path:path.join(output,(phone?'phone':'pc')+'-score-stable.png')});
  evidence.checks.push({phone,beforeQuit,diagnostics:observed.diagnostics,raster,scoreHeading:heading,inputContexts:observed.messages.filter(event=>event.type==='input-context'),public:observed.public});
  console.log('PASS '+(phone?'phone':'PC')+' settings quit yes reaches painted score without another key');
  await context.close();context=null;
 }
 assert.deepEqual(evidence.errors,[]);evidence.result='pass';
}catch(error){evidence.result='fail';evidence.failure=error.stack;await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');await context?.close();await browser.close();await runtime.dispose();await new Promise(resolve=>server.close(resolve));console.log('Evidence: '+output);}
