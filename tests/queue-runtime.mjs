// Compatibility names for transport tests; the actual ring and Atomics run in Rust.
import {browserUiBindings} from "./browser-ui-runtime.mjs";
const module=await browserUiBindings();
export default class EventQueue extends module.EventQueue {
  constructor(buffer=null,capacity=128){super(buffer,capacity);this.words=new Int32Array(this.buffer);}
  push(value){return this.pushMany(new Int32Array([value]));}
  discardPending(visitor){const values=this.discard();if(visitor)for(const value of values)visitor(value|0);return values.length;}
}
