/* Browser API adapter. Rust owns components, layout, focus and input decisions. */
(function(root) {
  "use strict";
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  class RogueCanvasUi {
    static async create(canvas,host) {
      const ui=new RogueCanvasUi(canvas,host);
      const {instance}=await WebAssembly.instantiateStreaming(fetch("/build/browser-ui.wasm"),{
        canvas:{measure_text:(pointer,length,size,flags,metric)=>ui.measure(pointer,length,size,flags,metric)}
      });
      ui.wasm=instance.exports;ui.connect();return ui;
    }
    constructor(canvas,host) {
      this.canvas=canvas;this.ctx=canvas.getContext("2d",{alpha:false});this.host=host;
      this.nativeInputs=new Map(["name","seed","prompt-text","command-key"].map(id=>[id,document.getElementById(id)]));
      this.pending=false;this.scene={paintCount:0,controls:[],pointer:{}};this.captured=new Set();this.metrics=new Map();
      this.state={};this.drawCount=0;
    }
    font(size,flags=0) {
      this.ctx.font=((flags&1)?"600 ":"")+size+"px "+((flags&2)?'Consolas, "Courier New", monospace':'system-ui, "Yu Gothic", sans-serif');
      this.ctx.textBaseline="top";
    }
    measure(pointer,length,size,flags,metric) {
      const text=decoder.decode(new Uint8Array(this.wasm.memory.buffer,pointer,length)),key=flags+":"+size+":"+text;
      let metrics=this.metrics.get(key);
      if(!metrics){this.font(size,flags);metrics=this.ctx.measureText(text);if(this.metrics.size>20000)this.metrics.clear();this.metrics.set(key,metrics);}
      return metric===0?metrics.width:metric===1?metrics.actualBoundingBoxAscent:metrics.actualBoundingBoxDescent;
    }
    request(value) {
      const bytes=encoder.encode(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v)),pointer=this.wasm.ui_alloc(bytes.length);
      try {
        new Uint8Array(this.wasm.memory.buffer,pointer,bytes.length).set(bytes);this.wasm.ui_request(pointer,bytes.length);
        const response=JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer,this.wasm.ui_output_pointer(),this.wasm.ui_output_length())));
        if(response.error)throw new Error(response.error);if(response.diagnostics)this.scene=response.diagnostics;if(response.state)this.state=response.state;return response;
      } finally {this.wasm.ui_free(pointer,bytes.length);}
    }
    connect() {
      for(const input of this.nativeInputs.values()){
        input.addEventListener("input",()=>this.dispatch({type:"native-input",id:input.id}));
        for(const event of ["keyup","focus","blur","compositionupdate"])input.addEventListener(event,()=>this.invalidate());
      }
      for(const type of ["compositionstart","compositionend"])document.addEventListener(type,()=>this.dispatch({type}));
      this.canvas.addEventListener("touchstart",e=>this.dispatch({type:"touchstart"},e),{passive:false});
      this.canvas.addEventListener("contextmenu",e=>this.dispatch({type:"contextmenu"},e));
      for(const [native,type] of [["pointerdown","down"],["pointermove","move"],["pointerup","up"]])this.canvas.addEventListener(native,e=>{
        const bounds=this.canvas.getBoundingClientRect();
        this.dispatch({type,id:e.pointerId,x:(e.clientX-bounds.left)*this.scene.width/bounds.width,y:(e.clientY-bounds.top)*this.scene.height/bounds.height,pointerType:e.pointerType,button:e.button,buttons:e.buttons,primary:e.isPrimary,captures:[...this.captured].filter(id=>this.canvas.hasPointerCapture(id)),hasCapture:this.canvas.hasPointerCapture(e.pointerId)},e);
      });
      for(const type of ["pointercancel","lostpointercapture"])this.canvas.addEventListener(type,e=>this.dispatch({type:"cancel",id:e.pointerId}));
      this.canvas.addEventListener("pointerleave",()=>this.dispatch({type:"leave"}));
      this.canvas.addEventListener("wheel",e=>{const bounds=this.canvas.getBoundingClientRect();this.dispatch({type:"wheel",x:(e.clientX-bounds.left)*this.scene.width/bounds.width,y:(e.clientY-bounds.top)*this.scene.height/bounds.height,dx:e.deltaX,dy:e.deltaY},e);},{passive:false});
      document.addEventListener("keydown",e=>this.dispatch({type:"key",key:e.key,shift:e.shiftKey,shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,altKey:e.altKey,metaKey:e.metaKey,repeat:e.repeat,native:document.activeElement?.id,composing:e.isComposing,keyCode:e.keyCode},e),true);
      window.addEventListener("blur",()=>this.dispatch({type:"blur"}));
      window.addEventListener("pagehide",()=>this.dispatch({type:"pagehide"}));
      window.addEventListener("resize",()=>this.dispatch({type:"surface-change",reason:"resize"}));
      document.addEventListener("visibilitychange",()=>this.dispatch({type:"visibilitychange",hidden:document.hidden}));
      document.addEventListener("fullscreenchange",()=>this.dispatch({type:"surface-change",reason:"fullscreen"}));
      document.addEventListener("selectionchange",()=>this.invalidate());
      new ResizeObserver(()=>this.invalidate()).observe(this.canvas.parentElement);
    }
    dispatch(event,native) {
      const result=this.dispatchRequest({type:"event",event});
      if(result.consumed&&native)native.preventDefault();
      if(result.stopPropagation&&native)native.stopImmediatePropagation();
      return result;
    }
    observations() {
      return {inputs:Object.fromEntries([...this.nativeInputs].map(([id,input])=>[id,{value:input.value,placeholder:input.placeholder,start:input.selectionStart,end:input.selectionEnd,active:document.activeElement===input}])),environment:{fullscreen:Boolean(document.fullscreenElement)}};
    }
    dispatchRequest(value) {
      const result=this.request({...this.observations(),...value});
      for(const effect of result.effects){const response=this.effect(effect);if(response?.accepted)result.accepted=response.accepted;}
      this.invalidate();return result;
    }
    effect(effect) {
      switch(effect.kind) {
        case "timer":this.blink=setInterval(()=>this.invalidate(),effect.interval);break;
        case "field":Object.assign(this.nativeInputs.get(effect.id),effect.properties);break;
        case "native-position":{const input=this.nativeInputs.get(effect.id),r=effect.rect;Object.assign(input.style,{left:r.x+"px",top:r.y+"px",width:r.w+"px",height:r.h+"px"});break;}
        case "native-focus":this.nativeInputs.get(effect.id).focus({preventScroll:true});break;
        case "native-blur":this.nativeInputs.get(effect.id).blur();break;
        case "focus":{const input=this.nativeInputs.get(effect.id),r=effect.rect;Object.assign(input.style,{left:r.x+"px",top:r.y+"px",width:r.w+"px",height:r.h+"px"});input.focus({preventScroll:true});break;}
        case "canvas-focus":this.canvas.focus({preventScroll:true});break;
        case "capture":this.canvas.setPointerCapture(effect.id);this.captured.add(effect.id);break;
        case "release":this.captured.delete(effect.id);if(this.canvas.hasPointerCapture(effect.id))this.canvas.releasePointerCapture(effect.id);break;
        case "cursor":this.canvas.style.cursor=effect.value;break;
        default:return this.host.execute(effect);
      }
    }
    invalidate() {if(this.pending||!this.wasm)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.paint();});}
    paint() {
      const result=this.request({type:"render",...this.observations(),captured:[...this.captured],view:{width:this.canvas.parentElement.clientWidth,height:this.canvas.parentElement.clientHeight,ratio:devicePixelRatio,coarse:matchMedia("(pointer: coarse)").matches,fullscreen:Boolean(document.fullscreenElement),now:Date.now()}});
      const {width,height,ratio}=result.surface;
      if(this.canvas.width!==Math.round(width*ratio)||this.canvas.height!==Math.round(height*ratio)){this.canvas.width=Math.round(width*ratio);this.canvas.height=Math.round(height*ratio);}
      this.ctx.setTransform(ratio,0,0,ratio,0,0);
      this.drawCount=0;
      for(const command of result.commands)this.draw(command);
      for(const effect of result.effects)this.effect(effect);
    }
    draw(command) {
      const c=this.ctx,r=command.rect;
      switch(command.op) {
        case "rect":c.fillStyle=command.color;c.fillRect(r.x,r.y,r.w,r.h);break;
        case "box":c.beginPath();c.roundRect(r.x,r.y,Math.max(0,r.w),Math.max(0,r.h),command.radius);c.fillStyle=command.fill;c.fill();if(command.stroke){c.strokeStyle=command.stroke;c.lineWidth=1;c.stroke();}break;
        case "circle":c.fillStyle=command.color;c.beginPath();c.arc(command.x,command.y,command.radius,0,Math.PI*2);c.fill();break;
        case "text":this.font(command.size,(command.bold?1:0)|(command.mono?2:0));c.fillStyle=command.color;c.fillText(command.text,command.x,command.y);break;
        case "save":c.save();c.globalAlpha=command.alpha;break;
        case "restore":c.restore();break;
        case "clip":c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();break;
        case "path":{c.save();c.translate(r.x,r.y);c.scale(r.w/24,r.h/24);c.strokeStyle=c.fillStyle=command.color;c.lineWidth=1.8;c.lineJoin=c.lineCap="round";const path=new Path2D(command.path);if(command.fill)c.fill(path);else c.stroke(path);c.restore();break;}
        case "image":c.imageSmoothingEnabled=false;this.host.tileSets.get(command.set).drawImage(c,command,r.x,r.y,r.w,r.h);this.drawCount++;break;
        default:throw new Error("Unknown Rust draw command: "+command.op);
      }
    }
  }
  root.RogueCanvasUi=RogueCanvasUi;
})(globalThis);
