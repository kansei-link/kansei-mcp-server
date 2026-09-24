/**
 * Minimal MCP stdio client (newline-delimited JSON-RPC).
 * Extracted verbatim from exec-harness/agentic-executor.mjs so that
 * run-marker.mjs can reuse it without changing the executor's bytes
 * (the executor's own sha256 is recorded in existing Evidence Bundles).
 */
import { spawn } from 'node:child_process';

export class McpClient {
  constructor(command, cmdArgs) {
    this.proc = spawn(command, cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    this.buf = ''; this.pending = new Map(); this.nextId = 1; this.stderr = '';
    this.proc.stderr.on('data', (d) => { this.stderr += d; });
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim(); this.buf = this.buf.slice(idx + 1);
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && this.pending.has(msg.id)) { const r = this.pending.get(msg.id); this.pending.delete(msg.id); r(msg); }
        } catch { /* partial */ }
      }
    });
  }
  request(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    return new Promise((resolvefn) => {
      this.pending.set(id, resolvefn);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolvefn({ error: { message: 'timeout' } }); } }, timeoutMs);
    });
  }
  notify(method) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); }
  kill() { try { this.proc.kill(); } catch { /* noop */ } }
}

export const textOf = (result) => (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

/** First JSON object/array embedded in a tool's text output, or null. */
export function extractJson(text) {
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
