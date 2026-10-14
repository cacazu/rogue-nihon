// Modify only a regression Worker's startup data, before Rust sees the message.
export function fixtureWorker(source,fixture) {
  return workerFiles(source,[["/fixture.id",fixture]]);
}
export function workerFiles(source,files) {
  return 'self.addEventListener("message",event=>{if(event.data.type==="start")event.data.files.push(...'+JSON.stringify(files)+');});\n'+source;
}
