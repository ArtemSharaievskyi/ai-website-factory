import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CodebaseMemoryError } from "./errors";
export type UpstreamTool = "index_repository"|"index_status"|"search_graph"|"trace_path"|"query_graph"|"get_code_snippet"|"get_architecture";
export const UPSTREAM_READ_ONLY_ALLOWLIST = new Set<UpstreamTool>(["index_repository","index_status","search_graph","trace_path","query_graph","get_code_snippet","get_architecture"]);
export type UpstreamTransport = (tool: UpstreamTool, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
export class CodebaseMemoryProcessTransport {
  private process?: ChildProcessWithoutNullStreams; private buffer = ""; private pending = new Map<number, { resolve:(v:unknown)=>void; reject:(e:unknown)=>void }>(); private nextId = 1;
  constructor(private readonly executable: string, private readonly cwd: string, private readonly timeoutMs: number) {}
  async call(tool: UpstreamTool, args: Record<string, unknown>, signal?: AbortSignal) {
    if (!UPSTREAM_READ_ONLY_ALLOWLIST.has(tool)) throw new CodebaseMemoryError("CODEBASE_MEMORY_OPERATION_NOT_ALLOWED", "The upstream operation is not on the read-only allowlist.");
    this.start(); const id=this.nextId++; const promise=new Promise<unknown>((resolve,reject)=>this.pending.set(id,{resolve,reject}));
    this.process!.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method:"tools/call",params:{name:tool,arguments:args}})+"\n");
    const timer=setTimeout(()=>{const pending=this.pending.get(id);this.pending.delete(id);pending?.reject(new CodebaseMemoryError("CODEBASE_MEMORY_TIMEOUT","Codebase Memory request timed out."));},this.timeoutMs);
    const abort=()=>{clearTimeout(timer);const pending=this.pending.get(id);this.pending.delete(id);pending?.reject(new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED","Codebase Memory request was cancelled."));}; signal?.addEventListener("abort",abort,{once:true});
    try{return await promise;}finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
  }
  private start() { if (this.process) return; this.process=spawn(this.executable,[],{cwd:this.cwd,shell:false,stdio:["pipe","pipe","pipe"]}); this.process.stdout.on("data",(chunk:Buffer)=>{this.buffer+=chunk.toString("utf8");let newline;while((newline=this.buffer.indexOf("\n"))>=0){const raw=this.buffer.slice(0,newline);this.buffer=this.buffer.slice(newline+1);try{const value=JSON.parse(raw) as {id?:number;result?:unknown;error?:{message?:string}};if(value.id&&this.pending.has(value.id)){const pending=this.pending.get(value.id)!;this.pending.delete(value.id);if(value.error)pending.reject(new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE",value.error.message??"Upstream Codebase Memory error."));else pending.resolve(value.result);}}catch{/* malformed response is bounded by request timeout */}}});this.process.on("exit",()=>{for(const pending of this.pending.values())pending.reject(new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE","Codebase Memory process exited."));this.pending.clear();this.process=undefined;}); }
  async close(){this.process?.kill();this.process=undefined;}
}
export function createProcessTransport(executable:string,cwd:string,timeoutMs:number):UpstreamTransport { const transport=new CodebaseMemoryProcessTransport(executable,cwd,timeoutMs); return (tool,args,signal)=>transport.call(tool,args,signal); }
