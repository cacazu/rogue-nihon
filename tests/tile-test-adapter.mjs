// Test convenience methods use the real Rust planner and production image painter.
export function installTileTestAdapter(Tiles, request) {
  const load = Tiles.load;
  Tiles.load = function(specification = {}) {
    const plan = specification.files ? specification : request({type: "asset-plan",
      url: typeof specification === "string" ? specification : specification.url});
    return load.call(this, plan);
  };
  Tiles.prototype.validate = function(frame) {
    request({type: "tile-plan", mode: this.manifest.browser_mode, frame, camera: {size: 0}});
  };
  Tiles.prototype.draw = function(context, frame, camera) {
    const result = request({type: "tile-plan", mode: this.manifest.browser_mode, frame, camera});
    this.drawCount = 0; context.imageSmoothingEnabled = false;
    for (const command of result.commands) {
      const r = command.rect;
      this.drawImage(context, command, r.x*camera.ratio, r.y*camera.ratio, r.w*camera.ratio, r.h*camera.ratio);
    }
  };
}
