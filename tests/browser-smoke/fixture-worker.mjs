// Modify only a regression Worker's startup data, before Rust sees the message.
export function fixtureWorker(source,fixture) {
  return workerStartup(source,{fixture});
}
export function workerStartup(source,configuration) {
  return 'self.addEventListener("message",event=>{if(event.data.type==="start")Object.assign(event.data,'+JSON.stringify(configuration)+');});\n'+source;
}
