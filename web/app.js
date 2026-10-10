/* Browser API connections. Session and input policy live in browser-ui.wasm. */
"use strict";
(async () => {
  let canvasUi, worker=null, queue=null, savedBytes=null, databasePromise=null;
  const tileSets=new Map(), board=document.getElementById("rogue-canvas");
  function database() {
    if(!databasePromise)databasePromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open("original-rogue-web",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("saves");
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error("Save database blocked"));
    });return databasePromise;
  }
  async function readSave() {
    const db=await database();return new Promise((resolve,reject)=>{
      const transaction=db.transaction("saves","readonly"),request=transaction.objectStore("saves").get("manual");
      transaction.oncomplete=()=>resolve(request.result?new Uint8Array(request.result):null);
      transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error("Save read aborted"));
    });
  }
  async function writeSave(bytes) {
    const db=await database();await new Promise((resolve,reject)=>{
      const transaction=db.transaction("saves","readwrite");transaction.objectStore("saves").put(bytes,"manual");
      transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error||new Error("Save write aborted"));
    });
  }
  function result(effect,operation,ok,values={}) {
    return canvasUi.dispatchRequest({type:"api",operation,ok,generation:effect.generation,...values});
  }
  function execute(effect) {
    switch(effect.kind) {
      case "worker-stop":queue?.close();worker?.terminate();worker=queue=null;break;
      case "queue-close":queue?.close();break;
      case "worker-start":{
        queue=new RogueEventQueue(null,effect.capacity);worker=new Worker("/web/worker.js");
        worker.onmessage=({data})=>canvasUi.dispatchRequest({type:"worker",generation:effect.generation,data});
        worker.onerror=e=>canvasUi.dispatchRequest({type:"worker",generation:effect.generation,data:{type:"error",text:e.message}});
        const restore=effect.restore?savedBytes.slice():null;
        worker.postMessage({type:"start",queue:queue.buffer,capacity:queue.capacity,seed:effect.seed,name:effect.name,restore,locale:effect.locale,files:effect.files},restore?[restore.buffer]:[]);break;
      }
      case "queue":return result(effect,"queue",queue?.pushMany(effect.events)??false,{after:effect.after,request:effect.request});
      case "save-read":readSave().then(bytes=>{savedBytes=bytes;result(effect,effect.operation,true,{length:bytes?.byteLength||0});},error=>result(effect,effect.operation,false,{error:error.stack||String(error)}));break;
      case "save-write":{
        const bytes=new Uint8Array(effect.bytes);
        writeSave(bytes).then(()=>{savedBytes=bytes;result(effect,"save-write",true,{length:bytes.byteLength});},error=>result(effect,"save-write",false,{error:error.stack||String(error)}));break;
      }
      case "assets":RogueTiles.load(effect).then(tiles=>{tileSets.set(effect.set,tiles);result(effect,"assets",true,{set:effect.set,images:[...tiles.images.values()].map(image=>({width:image.naturalWidth,height:image.naturalHeight}))});},error=>result(effect,"assets",false,{error:error.stack||String(error)}));break;
      case "storage-write":try{localStorage.setItem(effect.key,effect.value);}catch(error){result(effect,"storage-write",false,{error:String(error)});}break;
      case "random":return result(effect,"random",true,{id:effect.id,value:crypto.getRandomValues(new Uint32Array(1))[0]});
      case "fullscreen":{
        const promise=effect.enter?document.getElementById("canvas-stage").requestFullscreen():document.exitFullscreen();
        promise.then(()=>result(effect,"fullscreen",true),error=>result(effect,"fullscreen",false,{error:String(error)}));break;
      }
      case "download":{
        const url=URL.createObjectURL(new Blob([savedBytes],{type:effect.mime})),link=document.createElement("a");
        link.href=url;link.download=effect.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),effect.revokeAfter);break;
      }
      case "open":window.open(effect.url,"_blank","noopener");break;
      case "document":document.documentElement.lang=effect.language;document.title=effect.title;break;
      case "console":console[effect.level](effect.text);break;
      default:throw new Error("Unknown Rust browser effect: "+effect.kind);
    }
  }
  canvasUi=await RogueCanvasUi.create(board,{execute,tileSets});
  let preference=null;try{preference=localStorage.getItem("rogue-map-display-v1");}catch{}
  canvasUi.dispatchRequest({type:"boot",preference,environment:{parameters:Object.fromEntries(new URLSearchParams(location.search)),isolated:crossOriginIsolated&&typeof SharedArrayBuffer!=="undefined"}});
  const enqueueMany=events=>canvasUi.dispatch({type:"enqueue",events}).accepted;
  const descriptors={
    canvas:{get:()=>canvasUi.diagnostics()},enqueue:{value:key=>enqueueMany([key])},enqueueMany:{value:enqueueMany},
    rawKey:{value:(key,flags={})=>canvasUi.rawKey(key,flags)},redraw:{value:()=>canvasUi.invalidate()},centerMap:{value:()=>canvasUi.center()},
    graphics:{get:()=>({...canvasUi.state.graphics,camera:canvasUi.camera,images:tileSets.get(canvasUi.state.graphics.set)?.images.size||0,drawCount:canvasUi.drawCount})},
    queuePending:{get:()=>queue?.pending||0},diagnostics:{get:()=>canvasUi.state}
  };
  // Read-only snapshots; these adapters call the same Rust entry points as the UI.
  for(const key of ["language","generation","running","topOpen","frame","frameCount","inputRequestCount","trace","traces","messages","savedLength","savePending","translationFallbacks","uiMissing"])descriptors[key]={get:()=>canvasUi.state[key]};
  window.__rogueBrowserTest=Object.freeze(Object.defineProperties({},descriptors));
})().catch(error=>console.error("Browser host startup failed",error));
