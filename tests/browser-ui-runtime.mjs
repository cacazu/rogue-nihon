// Test-side caller of the generated Rust ABI; each consumer gets independent policy state.
import {readFile} from "node:fs/promises";
export async function browserUiBindings() {
  const code=await readFile(new URL("../build/browser-test.js",import.meta.url),"utf8");
  const module=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64")+"#"+Math.random());
  await module.default({module_or_path:await readFile(new URL("../build/browser-test.wasm",import.meta.url))});
  return module;
}
export async function browserUiRuntime() {
  const module=await browserUiBindings();
  return request=>{const result=JSON.parse(module.policy_request(JSON.stringify(request)));if(result.error)throw Error(result.error);return result;};
}
