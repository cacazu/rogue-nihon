import { browserTestAdapterSource } from "./browser-smoke/test-adapter.mjs";
import { artifactDirectory } from "../tools/temporary-artifacts.mjs";
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPreviewServer} from '../web/server.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),output=artifactDirectory(path.join(directory,'graphics-output'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await pause(100);}throw new Error('Timed out: '+label);}
class CDP{
 constructor(socket){this.socket=socket;this.id=0;this.pending=new Map();this.events=[];socket.addEventListener('message',event=>{const p=JSON.parse(event.data);if(p.id){const q=this.pending.get(p.id);if(q){this.pending.delete(p.id);clearTimeout(q.timer);p.error?q.reject(new Error(JSON.stringify(p.error))):q.resolve(p.result);}}else this.events.push(p);});}
 call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id,timer=setTimeout(()=>reject(new Error('CDP timeout '+method)),30000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression,userGesture=false){const r=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
}
await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'rogue-graphics-'));
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=spawn(process.env.ROGUE_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const evidence={started_at:new Date().toISOString(),checks:[],screenshots:[]};let socket,cdp;
async function shot(name){const r=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(output,name+'.png'),Buffer.from(r.data,'base64'));evidence.screenshots.push(name+'.png');}
try{
 let port;await until(async()=>{try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return port;}catch{return false;}},'Chrome');
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});cdp=new CDP(socket);
 await cdp.call('Runtime.enable');await cdp.call('Page.enable');
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {source: browserTestAdapterSource()});
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false});
 await cdp.call('Page.navigate',{url:base+'?trace=1'});
 await until(()=>cdp.evaluate('Boolean(window.__rogueBrowserTest?.graphics?.images===46)'),'46 images decoded');
 await cdp.evaluate("document.getElementById('seed').value='12345';document.getElementById('new-game').click()");
 await until(()=>cdp.evaluate('Boolean(__rogueBrowserTest.frame&&__rogueBrowserTest.trace)'),'game');
 assert.deepEqual(await cdp.evaluate('({ids:__rogueBrowserTest.graphics.ids.length,images:__rogueBrowserTest.graphics.images,unknown:__rogueBrowserTest.graphics.unknown,mode:__rogueBrowserTest.graphics.mode})'),{ids:49,images:46,unknown:[],mode:'tiles'});
 evidence.checks.push('Real C/Rust game starts in image mode: 49 semantic IDs, 46 decoded PNGs, no unmapped glyphs');
 assert.match((await fetch(base+'web/assets/tiles/actor.player.png')).headers.get('content-type'),/image\/png/);
 await cdp.evaluate("window.__tileTextCalls=0;const p=CanvasRenderingContext2D.prototype,f=p.fillText;p.fillText=function(...args){window.__tileTextCalls++;return f.apply(this,args)};");
 const before=await cdp.evaluate('({trace:__rogueBrowserTest.trace,input:__rogueBrowserTest.inputRequestCount})');
 evidence.initial_camera=await cdp.evaluate('({player:__rogueBrowserTest.frame.player,camera:__rogueBrowserTest.graphics.camera})');
 await cdp.evaluate('__rogueBrowserTest.centerMap()');
 evidence.centered_camera=await cdp.evaluate('({player:__rogueBrowserTest.frame.player,camera:__rogueBrowserTest.graphics.camera})');
 await shot('desktop-100');
 for(const size of [16,24,32,48,64]){
  await cdp.evaluate(`document.getElementById('tile-zoom').value='${[16,24,32,48,64].indexOf(size)}';document.getElementById('tile-zoom').dispatchEvent(new Event('input'));for(let i=0;i<10;i++)__rogueBrowserTest.redraw()`);
  const bounds=await cdp.evaluate("(()=>{const b=document.getElementById('board'),s=document.querySelector('.board-scroll');return {size:__rogueBrowserTest.graphics.tileSize,width:b.width,viewport:s.clientWidth,smoothing:b.getContext('2d').imageSmoothingEnabled,overflow:document.documentElement.scrollWidth>innerWidth};})()");
  assert.equal(bounds.size,size);assert.equal(bounds.smoothing,false);assert.equal(bounds.overflow,false);assert.ok(bounds.width<=bounds.viewport*2+1);
 }
 await shot('desktop-200');
 assert.equal(await cdp.evaluate('__tileTextCalls'),0);
 evidence.checks.push('50–200% zoom uses only raster images, disables smoothing and bounds Canvas to viewport');
 await cdp.evaluate("document.getElementById('display-mode').value='ascii';document.getElementById('display-mode').dispatchEvent(new Event('change'))");
 assert.equal(await cdp.evaluate('__rogueBrowserTest.graphics.mode'),'ascii');assert.ok(await cdp.evaluate('__tileTextCalls>0'));
 await cdp.evaluate("document.getElementById('display-mode').value='tiles';document.getElementById('display-mode').dispatchEvent(new Event('change'));window.__tileTextCalls=0;document.getElementById('tile-zoom').value='2';document.getElementById('tile-zoom').dispatchEvent(new Event('input'))");
 for(const [name,width,height,dpr] of [['mobile-portrait',390,844,3],['mobile-landscape',844,390,2]]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:true});await pause(250);
  await cdp.evaluate("document.querySelector('.board-scroll').scrollTo(301,93);__rogueBrowserTest.redraw()");
  assert.equal(await cdp.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  assert.equal(await cdp.evaluate("document.getElementById('board').width<=document.querySelector('.board-scroll').clientWidth*2+1"),true);
  await cdp.evaluate("document.getElementById('center-map').click();document.querySelector('.game-panel').scrollIntoView({block:'start'})");await pause(150);
  const center=await cdp.evaluate('({player:__rogueBrowserTest.frame.player,camera:__rogueBrowserTest.graphics.camera})');
  assert.ok(center.player.x*center.camera.size-center.camera.left>=0&&center.player.x*center.camera.size-center.camera.left<center.camera.width,'Player stays visible after centering');
  evidence[name]=center;
  await shot(name);
 }
 evidence.checks.push('390×844 and 844×390 mobile viewports pan the map without horizontal page overflow; DPR capped at 2');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false});await pause(200);
 await cdp.evaluate("document.getElementById('fullscreen').click()",true);
 await until(()=>cdp.evaluate('Boolean(document.fullscreenElement)'),'fullscreen entered');await pause(200);await shot('fullscreen');
 await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 // Headless Chrome may retain emulated fullscreen after Escape; explicit exit is a display-only operation.
 await cdp.evaluate('document.fullscreenElement?document.exitFullscreen():undefined');await pause(100);
 assert.deepEqual(await cdp.evaluate('({trace:__rogueBrowserTest.trace,input:__rogueBrowserTest.inputRequestCount})'),before);
 assert.equal(await cdp.evaluate('__rogueBrowserTest.queuePending'),0);assert.equal(await cdp.evaluate('__tileTextCalls'),0);
 evidence.checks.push('Zoom, panning, ASCII/image switching, fullscreen and Escape leave all 20 C/RNG words and input requests unchanged');
 const gallery=await cdp.evaluate("(async()=>{const tiles=await RogueTiles.load(),canvas=document.createElement('canvas');canvas.width=7*96;canvas.height=7*96;const frame={width:7,height:9,map_tile_ids:tiles.entries.map(e=>e.id),map_tiles:Array(63).fill(0),map_unknown_glyphs:[]};for(let i=0;i<49;i++)frame.map_tiles[7+i]=i;tiles.draw(canvas.getContext('2d'),frame,{size:96,ratio:1,left:0,top:0,width:672,height:672});return canvas.toDataURL('image/png').split(',')[1];})()");
 await writeFile(path.join(output,'renderer-all-49.png'),Buffer.from(gallery,'base64'));evidence.screenshots.push('renderer-all-49.png');
 evidence.checks.push('The production renderer draws every semantic ID in a separate synthetic gallery; game state is untouched');
 const clicked=await cdp.evaluate("(()=>{const f=__rogueBrowserTest.frame,c=__rogueBrowserTest.graphics.camera,b=document.getElementById('board'),rect=b.getBoundingClientRect();const dx=[-1,1].find(dx=>f.map_tiles[f.player.y*f.width+f.player.x+dx]===1);if(dx===undefined)throw new Error('No visible adjacent floor');const x=f.player.x+dx,y=f.player.y;const before=__rogueBrowserTest.inputRequestCount;b.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+(x*c.size+c.size/2-c.left)*rect.width/c.width,clientY:rect.top+((y-1)*c.size+c.size/2-c.top)*rect.height/c.height}));return {x,y,before};})()");
 await until(()=>cdp.evaluate(`__rogueBrowserTest.inputRequestCount>${clicked.before}`),'image-map click reaches C');
 assert.deepEqual(await cdp.evaluate('__rogueBrowserTest.frame.player'),{x:clicked.x,y:clicked.y});
 evidence.checks.push('An adjacent image tile click at the current zoom/camera moves the real C player to that exact cell');
 assert.deepEqual(cdp.events.filter(e=>e.method==='Runtime.exceptionThrown'),[]);evidence.checks.push('No main-browser Runtime exceptions');
 evidence.status='passed';evidence.finished_at=new Date().toISOString();await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}catch(error){evidence.status='failed';evidence.error=error.stack;await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');throw error;}
finally{socket?.close();browser.kill();await new Promise(resolve=>server.close(resolve));}
