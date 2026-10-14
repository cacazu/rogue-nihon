import {fileURLToPath} from "node:url";
// Installed by Playwright/CDP before navigation. No adapter is loaded by the game.
function browserTestAdapter() {
  let module;
  if(/^https?:$/.test(location.protocol))import("/build/browser-ui.js").then(value=>{module=value;});
  const snapshot=()=>{try{return module&&JSON.parse(module.browser_snapshot());}catch{return undefined;}};
  class Ui {
    get scene(){return snapshot()?.diagnostics;}
    get state(){return snapshot()?.state;}
    get drawCount(){return snapshot()?.drawCount;}
    request(value){return JSON.parse(module.policy_request(JSON.stringify(value)));}
    dispatchRequest(value){return JSON.parse(module.browser_request(JSON.stringify(value)));}
    dispatch(event){return this.dispatchRequest({type:"event",event});}
    invalidate(){window.dispatchEvent(new Event("resize"));}
  }
  const ui=new Ui();
  // These names exist only in the test page, to keep scenario callers independent of the ABI.
  globalThis.RogueCanvasUi=Ui;
  class Tiles {
    static async load(specification={}) {
      const plan=specification.files?specification:ui.request({type:"asset-plan",url:typeof specification==="string"?specification:specification.url});
      const tiles=new Tiles();tiles.manifest=plan.manifest;tiles.entries=plan.manifest.entries;tiles.pixelArt=plan.manifest.pixel_art;
      tiles.painter=await module.TilePainter.load(JSON.stringify(plan));
      tiles.images=new Map(plan.files.map(name=>[name,{name}]));tiles.drawCount=0;
      tiles.rotated={get size(){return tiles.painter.rotations();}};return tiles;
    }
    validate(frame){ui.request({type:"tile-plan",mode:this.manifest.browser_mode,frame,camera:{size:0}});}
    drawImage(context,entry,x,y,w,h){
      const width=context.canvas.width,height=context.canvas.height;
      const rgba=this.painter.rasterize(JSON.stringify({...entry,rect:{x,y,w,h}}),width,height);
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);this.drawCount++;
    }
    draw(context,frame,camera){
      const result=ui.request({type:"tile-plan",mode:this.manifest.browser_mode,frame,camera});this.drawCount=0;context.imageSmoothingEnabled=false;
      const commands=result.commands.map(command=>{const r=command.rect;return {...command,rect:{x:r.x*camera.ratio,y:r.y*camera.ratio,w:r.w*camera.ratio,h:r.h*camera.ratio}};});
      const width=context.canvas.width,height=context.canvas.height;
      const rgba=this.painter.rasterize(JSON.stringify(commands),width,height);
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);this.drawCount=commands.length;
    }
  }
  globalThis.RogueTiles=Tiles;
  const descriptors={
    canvas:{get:()=>ui.scene},commands:{get:()=>snapshot()?.commands},
    observedTranslationFailures:{get:()=>ui.state?.translationFallbacks||[]},
    enqueue:{value:key=>ui.dispatch({type:"enqueue",events:[key]}).accepted},
    enqueueMany:{value:events=>ui.dispatch({type:"enqueue",events}).accepted},
    rawKey:{value:(key,flags={})=>ui.request({type:"event",event:{type:"raw-key",key,...flags}}).raw},
    redraw:{value:()=>ui.invalidate()},centerMap:{value:()=>ui.dispatch({type:"center"})},
    graphics:{get:()=>ui.state&&({...ui.state.graphics,camera:ui.scene.camera,images:ui.state.ready?46:0,drawCount:ui.drawCount})},
    queuePending:{get:()=>snapshot()?.queuePending||0},diagnostics:{get:()=>ui.state}
  };
  for(const key of ["language","generation","running","topOpen","frame","frameCount","inputRequestCount","trace","traces","messages","savedLength","savePending","translationFallbacks","uiMissing"])
    descriptors[key]={get:()=>ui.state?.[key]};
  globalThis.__rogueBrowserTest=Object.freeze(Object.defineProperties({},descriptors));
  globalThis.__rogueUiAdapter=ui;
}
export const browserTestAdapterSource=()=>"("+browserTestAdapter.toString()+")();";
export async function installBrowserTestAdapter(target) {
  const headers={"Cross-Origin-Embedder-Policy":"require-corp","Cross-Origin-Resource-Policy":"same-origin"};
  await target.route("**/build/browser-ui.js",route=>route.fulfill({path:fileURLToPath(new URL("../../build/browser-test.js",import.meta.url)),contentType:"text/javascript",headers}));
  await target.route("**/build/browser-test.wasm",route=>route.fulfill({path:fileURLToPath(new URL("../../build/browser-test.wasm",import.meta.url)),contentType:"application/wasm",headers}));
  await target.addInitScript({content:browserTestAdapterSource()});
}
