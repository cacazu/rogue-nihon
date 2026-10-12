/* Semantic mirrors of Rust's rendered controls. No command/key interpretation. */
globalThis.RogueCanvasAccessibility = {
  attach(ui) {
    const stage = ui.canvas.parentElement;
    const layer = document.createElement("div");
    layer.id = "canvas-controls";
    Object.assign(layer.style,{position:"absolute",inset:"0",pointerEvents:"none"});
    stage.append(layer);
    const description = document.createElement("pre");
    description.id = "rogue-observation";
    Object.assign(description.style,{position:"absolute",width:"1px",height:"1px",overflow:"hidden",clipPath:"inset(50%)",pointerEvents:"none"});
    stage.append(description);
    const nodes = new Map();
    const forward = (event,type) => {
      ui.dispatch({type,id:event.pointerId,...ui.point(event.clientX,event.clientY),pointerType:event.pointerType,button:event.button,buttons:event.buttons,primary:event.isPrimary,captures:[...ui.captured].filter(id=>ui.canvas.hasPointerCapture(id)),hasCapture:ui.canvas.hasPointerCapture(event.pointerId)},event);
    };
    for(const [native,type] of [["pointerdown","down"],["pointermove","move"],["pointerup","up"]])layer.addEventListener(native,event=>forward(event,type));
    layer.addEventListener("wheel",event=>{
      ui.dispatch(ui.wheel(event),event);
    },{passive:false});
    layer.addEventListener("contextmenu",event=>event.preventDefault());
    layer.addEventListener("touchstart",event=>event.preventDefault(),{passive:false});
    layer.addEventListener("pointercancel",event=>ui.dispatch({type:"cancel",id:event.pointerId}));
    const paint=ui.paint.bind(ui);
    ui.paint=()=>{
      paint();
      const active=new Set();
      for(const control of ui.scene.controls){
        if(control.type!=="button"||control.rect.w<=0||control.rect.h<=0)continue;
        active.add(control.id);
        let node=nodes.get(control.id);
        if(!node){node=document.createElement("button");node.type="button";node.tabIndex=-1;node.dataset.control=control.id;nodes.set(control.id,node);layer.append(node);}
        node.setAttribute("aria-label",control.label);node.disabled=control.disabled;
        const r=control.rect;
        Object.assign(node.style,{position:"absolute",left:r.x+"px",top:r.y+"px",width:r.w+"px",height:r.h+"px",opacity:"0",padding:"0",border:"0",pointerEvents:"auto",touchAction:"none"});
      }
      for(const [id,node] of nodes)if(!active.has(id)){node.remove();nodes.delete(id);}
      const frame=ui.state.frame;
      // Only the presentation already supplied to the renderer is described.
      description.textContent=JSON.stringify({scope:ui.scene.scope,status:frame?.ui?.status?.text,player:frame?.player,width:frame?.width,height:frame?.height,map:frame?.map_cells,input:frame?.ui?.input,window:frame?.ui?.window,lines:frame?.ui?.lines?.map(line=>({text:line.text,key:line.key,selectable:line.selectable})),messages:ui.state.messages?.slice(-6).map(message=>message.text),running:ui.state.running,text:ui.scene.text});
    };
  }
};
