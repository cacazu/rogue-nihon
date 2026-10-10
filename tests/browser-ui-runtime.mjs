// Test-side FFI adapter. No testing logic is imported by the browser application.
import {readFile} from "node:fs/promises";
export async function browserUiRuntime() {
  let wasm;const bytes=await readFile(new URL("../build/browser-ui.wasm",import.meta.url));
  const {instance}=await WebAssembly.instantiate(bytes,{canvas:{measure_text:(p,n,size,flags,metric)=>metric===0?new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,p,n)).length*size*.6:metric===1?0:size}});wasm=instance.exports;
  return request=>{
    const bytes=new TextEncoder().encode(JSON.stringify(request)),p=wasm.ui_alloc(bytes.length);
    try {new Uint8Array(wasm.memory.buffer,p,bytes.length).set(bytes);wasm.ui_request(p,bytes.length);
      const r=JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.ui_output_pointer(),wasm.ui_output_length())));if(r.error)throw new Error(r.error);return r;
    }finally{wasm.ui_free(p,bytes.length);}
  };
}
