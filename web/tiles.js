(function(root) {
  "use strict";
  class RogueTiles {
    constructor(manifest, images) {
      if (manifest.entries?.length !== 49 || ![32, 96].includes(manifest.tile_pixels)) throw new Error("Incomplete tile manifest");
      this.manifest = manifest; this.entries = manifest.entries; this.images = images;
      this.drawCount = 0; this.unknown = [];
      this.pixelArt = manifest.tile_pixels === 32; this.rotated = new Map();
    }
    static async load(url = "/web/assets/tiles/manifest.json") {
      const response = await fetch(url); if (!response.ok) throw new Error("Tile manifest unavailable");
      const manifest = await response.json(), images = new Map();
      if (![32, 96].includes(manifest.tile_pixels)) throw new Error("Invalid tile dimensions");
      await Promise.all([...new Set(manifest.entries.map(entry => entry.image))].map(async filename => {
        if (!/^[a-z_.]+\.png$/.test(filename)) throw new Error("Invalid tile path");
        const image = new Image(); image.src = new URL(filename, new URL(url, location.href)).href;
        await image.decode(); if (image.naturalWidth !== manifest.tile_pixels || image.naturalHeight !== manifest.tile_pixels) throw new Error("Invalid tile dimensions");
        images.set(filename, image);
      }));
      return new RogueTiles(manifest, images);
    }
    validate(frame) {
      if (!Array.isArray(frame.map_tiles) || frame.map_tiles.length !== frame.width * frame.height ||
          !Array.isArray(frame.map_tile_ids) || frame.map_tile_ids.length !== this.entries.length ||
          frame.map_tile_ids.some((id, index) => id !== this.entries[index].id) ||
          frame.map_tiles.some(index => !Number.isInteger(index) || index < 0 || index >= this.entries.length) ||
          frame.map_unknown_glyphs?.length) throw new Error("Unmapped graphical map cell");
    }
    drawImage(context, entry, x, y, width, height) {
      let image = this.images.get(entry.image); if (!image) throw new Error("Missing image: " + entry.id);
      if (entry.rotation && this.pixelArt) {
        const key = entry.image + ":" + entry.rotation;
        if (!this.rotated.has(key)) this.rotated.set(key, RogueTiles.pixelRotation(image, entry.rotation));
        image = this.rotated.get(key);
        context.drawImage(image, x, y, width, height);
      } else if (entry.rotation) {
        context.save(); context.translate(x + width / 2, y + height / 2); context.rotate(entry.rotation * Math.PI / 180);
        context.drawImage(image, -width / 2, -height / 2, width, height); context.restore();
      } else context.drawImage(image, x, y, width, height);
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
      this.validate(frame); this.drawCount = 0;
      context.imageSmoothingEnabled = false;
      const { size, ratio, left, top, width, height } = camera;
      const startX = Math.max(0, Math.floor(left / size)), endX = Math.min(frame.width, Math.ceil((left + width) / size));
      const startY = Math.max(1, 1 + Math.floor(top / size)), endY = Math.min(frame.height - 1, 1 + Math.ceil((top + height) / size));
      for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
        const entry = this.entries[frame.map_tiles[y * frame.width + x]];
        const px = Math.round((x * size - left) * ratio), py = Math.round(((y - 1) * size - top) * ratio);
        const w = Math.round(((x + 1) * size - left) * ratio) - px, h = Math.round((y * size - top) * ratio) - py;
        // Neutral stage below a presented entity, never the hidden C terrain.
        const base = entry.id === "terrain.unexplored" ? this.entries[0] : entry.id === "terrain.passage" ? this.entries[2] : this.entries[1];
        this.drawImage(context, base, px, py, w, h);
        if (entry !== base) this.drawImage(context, entry, px, py, w, h);
      }
    }
    coordinate(event, canvas, frame, camera) {
      const bounds = canvas.getBoundingClientRect();
      const x = Math.floor(((event.clientX - bounds.left) * camera.width / bounds.width + camera.left) / camera.size);
      const y = 1 + Math.floor(((event.clientY - bounds.top) * camera.height / bounds.height + camera.top) / camera.size);
      return x >= 0 && x < frame.width && y >= 1 && y < frame.height - 1 ? { x, y } : null;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = RogueTiles;
  root.RogueTiles = RogueTiles;
})(typeof globalThis !== "undefined" ? globalThis : this);
