/* Canvas image loading and rasterization only; Rust supplies the draw plan. */
(function(root) {
  "use strict";
  class RogueTiles {
    constructor(manifest, images) {
      this.manifest=manifest;this.entries=manifest.entries;this.images=images;
      this.drawCount=0;this.rotated=new Map();this.pixelArt=manifest.pixel_art;
    }
    static request(value) {return (this.planRequest||((request)=>root.RogueCanvasUi.active.request(request)))(value);}
    static async load(specification={}) {
      let plan=specification;
      if(!plan.files)plan=this.request({type:"asset-plan",url:typeof plan==="string"?plan:plan.url});
      const images=new Map();
      await Promise.all(plan.files.map(async filename=>{
        const image=new Image();image.src=new URL(plan.base+filename,location.href).href;
        await image.decode();images.set(filename,image);
      }));
      return new RogueTiles(plan.manifest,images);
    }
    validate(frame) {RogueTiles.request({type:"tile-plan",mode:this.manifest.browser_mode,frame,camera:{size:0}});}
    drawImage(context, entry, x, y, width, height) {
      let image=this.images.get(entry.image);if(!image)throw new Error("Missing image: "+entry.image);
      if(entry.rotation && entry.pixelArt) {
        const key=entry.image+":"+entry.rotation;
        if(!this.rotated.has(key))this.rotated.set(key,RogueTiles.pixelRotation(image,entry.rotation));
        image=this.rotated.get(key);context.drawImage(image,x,y,width,height);
      } else if(entry.rotation) {
        context.save();context.translate(x+width/2,y+height/2);context.rotate(entry.rotation*Math.PI/180);
        context.drawImage(image,-width/2,-height/2,width,height);context.restore();
      } else context.drawImage(image,x,y,width,height);
      this.drawCount++;
    }
    // Rasterize rotation once on the native pixel grid; never rotate enlarged clusters.
    static pixelRotation(image, degrees, createCanvas = () => document.createElement("canvas")) {
      const size = 32, source = createCanvas(), result = createCanvas();
      source.width = source.height = result.width = result.height = size;
      const sourceContext = source.getContext("2d"); sourceContext.imageSmoothingEnabled = false; sourceContext.drawImage(image, 0, 0);
      const pixels = sourceContext.getImageData(0, 0, size, size).data, context = result.getContext("2d"), output = context.createImageData(size, size);
      const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians), half = size / 2;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = x + .5 - half, dy = y + .5 - half;
        const sx = Math.floor(dx * cos + dy * sin + half), sy = Math.floor(-dx * sin + dy * cos + half);
        if (sx >= 0 && sx < size && sy >= 0 && sy < size) {
          const from = (sy * size + sx) * 4, to = (y * size + x) * 4;
          output.data.set(pixels.subarray(from, from + 4), to);
        }
      }
      context.putImageData(output, 0, 0); return result;
    }
    draw(context, frame, camera) {
      const result=RogueTiles.request({type:"tile-plan",mode:this.manifest.browser_mode,frame,camera});
      this.drawCount=0;context.imageSmoothingEnabled=false;
      for(const command of result.commands){const r=command.rect;this.drawImage(context,command,r.x*camera.ratio,r.y*camera.ratio,r.w*camera.ratio,r.h*camera.ratio);}
    }
  }
  if(typeof module!=="undefined"&&module.exports)module.exports=RogueTiles;
  root.RogueTiles=RogueTiles;
})(typeof globalThis!=="undefined"?globalThis:this);
