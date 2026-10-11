/* Opt-in local play evidence; observes UI requests without changing them. */
globalThis.RoguePlayRecording = {
  attach(ui) {
    if(new URLSearchParams(location.search).get("record")!=="1")return;
    const session=crypto.randomUUID();
    let sequence=0,chain=Promise.resolve(),pendingSave=null;
    const send=entry=>{
      const body=JSON.stringify({n:++sequence,session,time:new Date().toISOString(),...entry});
      chain=chain.then(async()=>{
        const response=await fetch("/play-log",{method:"POST",headers:{"Content-Type":"application/json"},body});
        if(!response.ok)throw new Error("Play recording failed: "+response.status);
      }).catch(error=>console.error(error));
    };
    const observation=()=>{
      const frame=ui.state.frame;
      return {status:frame?.ui?.status?.text,player:frame?.player,width:frame?.width,height:frame?.height,map:frame?.map_cells,input:frame?.ui?.input,window:frame?.ui?.window,lines:frame?.ui?.lines?.map(line=>({text:line.text,key:line.key,selectable:line.selectable})),messages:ui.state.messages?.slice(-6).map(message=>message.text),running:ui.state.running};
    };
    const request=ui.dispatchRequest.bind(ui);
    ui.dispatchRequest=value=>{
      const before=observation();
      const pointer=value.type==="event"&&value.event.type==="up"?value.event:null;
      const control=pointer?ui.scene?.controls?.findLast(c=>c.type==="button"&&pointer.x>=c.rect.x&&pointer.y>=c.rect.y&&pointer.x<c.rect.x+c.rect.w&&pointer.y<c.rect.y+c.rect.h):null;
      const result=request(value);
      for(const effect of result.effects||[])if(effect.kind==="save-write")pendingSave=effect.bytes;
      if(value.type==="event"&&["up","key","native-input"].includes(value.event.type)){
        send({kind:"action",event:value.event,control:control?{id:control.id,label:control.label}:null,consumed:result.consumed,before,after:observation()});
      }
      if(value.type==="worker"&&["frame","input","error","exit"].includes(value.data?.type))send({kind:"observation",state:observation()});
      if(value.type==="api"&&value.operation==="save-write"&&value.ok&&pendingSave){send({kind:"checkpoint",bytes:pendingSave,state:observation()});pendingSave=null;}
      return result;
    };
  }
};
