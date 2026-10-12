// Package each complete generated pose, even when a long weapon crosses an
// nominal grid boundary. Connected artwork belongs to its character; separate
// droplets/wisps belong to the closest pose. No body parts are rearranged.
export async function splitGeneratedIllustrationSheet(sharp, png, size=96){
  const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height}=info,n=width*height,labels=new Int32Array(n).fill(-1),queue=new Int32Array(n),components=[];
  for(let start=0;start<n;start++){
    // Near-transparent generation noise can bridge two otherwise separate
    // poses. Identify solid shapes first, then retain their soft edge pixels.
    if(data[start*4+3]<128||labels[start]!==-1)continue;
    const id=components.length;let read=0,write=1;queue[0]=start;labels[start]=id;
    const component={minX:width,minY:height,maxX:0,maxY:0,area:0,sumX:0,sumY:0};
    while(read<write){
      const p=queue[read++],x=p%width,y=Math.floor(p/width);
      component.minX=Math.min(component.minX,x);component.maxX=Math.max(component.maxX,x);
      component.minY=Math.min(component.minY,y);component.maxY=Math.max(component.maxY,y);
      component.area++;component.sumX+=x;component.sumY+=y;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if((!dx&&!dy)||xx<0||xx>=width||yy<0||yy>=height)continue;
        const q=yy*width+xx;if(labels[q]===-1&&data[q*4+3]>=128){labels[q]=id;queue[write++]=q;}
      }
    }
    component.x=component.sumX/component.area;component.y=component.sumY/component.area;
    components.push(component);
  }
  const primary=Array(12).fill(-1);
  for(const [id,c]of components.entries()){
    const cell=Math.min(3,Math.floor(c.y/(height/4)))*3+Math.min(2,Math.floor(c.x/(width/3)));
    if(primary[cell]===-1||c.area>components[primary[cell]].area)primary[cell]=id;
  }
  if(primary.some(id=>id===-1))throw Error('Generated sheet is missing a pose');
  const solidLabels=labels.slice();
  for(let p=0;p<n;p++){
    if(labels[p]!==-1||!data[p*4+3])continue;
    const x=p%width,y=Math.floor(p/width);let nearest=-1,best=Infinity;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
      const id=solidLabels[yy*width+xx],distance=dx*dx+dy*dy;
      if(id!==-1&&distance<best){best=distance;nearest=id;}
    }
    if(nearest!==-1){
      labels[p]=nearest;const c=components[nearest];c.minX=Math.min(c.minX,x);c.maxX=Math.max(c.maxX,x);c.minY=Math.min(c.minY,y);c.maxY=Math.max(c.maxY,y);
    }
  }
  const owner=components.map((c,id)=>{
    const fixed=primary.indexOf(id);if(fixed!==-1)return fixed;
    let nearest=0,distance=Infinity;
    primary.forEach((p,cell)=>{const a=components[p],d=(a.x-c.x)**2+(a.y-c.y)**2;if(d<distance){distance=d;nearest=cell;}});
    return nearest;
  });
  const bounds=Array.from({length:12},()=>({minX:width,minY:height,maxX:0,maxY:0}));
  components.forEach((c,id)=>{
    const b=bounds[owner[id]];b.minX=Math.min(b.minX,c.minX);b.minY=Math.min(b.minY,c.minY);
    b.maxX=Math.max(b.maxX,c.maxX);b.maxY=Math.max(b.maxY,c.maxY);
  });
  const maxWidth=Math.max(...bounds.map(b=>b.maxX-b.minX+1)),maxHeight=Math.max(...bounds.map(b=>b.maxY-b.minY+1));
  if(maxWidth>width/3*1.5||maxHeight>height/4*1.5)throw Error('Pose extraction joined adjacent characters');
  const scale=Math.min((size-12)/maxWidth,(size-12)/maxHeight);
  const frames=[];
  for(let cell=0;cell<12;cell++){
    const b=bounds[cell],w=b.maxX-b.minX+1,h=b.maxY-b.minY+1,cropped=Buffer.alloc(w*h*4);
    for(let y=b.minY;y<=b.maxY;y++)for(let x=b.minX;x<=b.maxX;x++){
      const p=y*width+x;if(labels[p]!==-1&&owner[labels[p]]===cell)data.copy(cropped,((y-b.minY)*w+x-b.minX)*4,p*4,p*4+4);
    }
    const targetWidth=Math.max(1,Math.round(w*scale)),targetHeight=Math.max(1,Math.round(h*scale));
    const artwork=await sharp(cropped,{raw:{width:w,height:h,channels:4}}).resize(targetWidth,targetHeight).png().toBuffer();
    frames.push(await sharp({create:{width:size,height:size,channels:4,background:'#00000000'}})
      .composite([{input:artwork,left:Math.floor((size-targetWidth)/2),top:size-6-targetHeight}]).png().toBuffer());
  }
  return {frames,bounds,scale};
}
