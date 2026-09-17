// 純Node実装のtgz読み書き（外部tarコマンド非依存・Codex Release Safety rev3条件6/8）
//
// 読み: untgz(buffer) -> Map<path, {data, mode}>
// 書き: buildTgz(entries, {mtime}) -> Buffer
//   決定性: エントリはパス昇順・mtime固定・uid/gid=0・uname/gname空・
//   gzipはlevel 9（同一Node系列で同一バイト列。SHA-256はビルド環境のzlib実装に
//   依存するため、照合はtar層のSHA（sha256Tar）を第一とし、gzip層SHAを併記する）

import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

function readOctal(buf, off, len) {
  const s = buf.subarray(off, off + len).toString("ascii").replace(/\0.*$/, "").trim();
  return s ? parseInt(s, 8) : 0;
}

export function untgz(tgzBuffer) {
  const tar = gunzipSync(tgzBuffer);
  const out = new Map();
  let off = 0;
  while (off + 512 <= tar.length) {
    const block = tar.subarray(off, off + 512);
    if (block.every((b) => b === 0)) break; // end blocks
    let name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    if (prefix) name = `${prefix}/${name}`;
    const size = readOctal(block, 124, 12);
    const mode = readOctal(block, 100, 8);
    const type = String.fromCharCode(block[156] || 48);
    const dataStart = off + 512;
    if (type === "0" || type === "\0" || block[156] === 0) {
      out.set(name, { data: tar.subarray(dataStart, dataStart + size), mode });
    }
    // longname(L)等のGNU拡張はnpm tarballでは非使用（100+155文字以内）——遭遇したら明示エラー
    if (type === "L" || type === "K") throw new Error(`GNU long name entries not supported: near ${name}`);
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

function writeOctal(buf, off, len, value) {
  const s = value.toString(8).padStart(len - 1, "0");
  buf.write(s, off, "ascii");
  buf[off + len - 1] = 0;
}

export function buildTgz(entries, { mtime = Date.UTC(2026, 7, 16) / 1000 } = {}) {
  const paths = [...entries.keys()].sort();
  const chunks = [];
  for (const p of paths) {
    const { data, mode } = entries.get(p);
    const header = Buffer.alloc(512);
    if (p.length > 100) {
      // ustar prefix分割（/で区切れる位置を探す）
      const idx = p.slice(0, 155).lastIndexOf("/");
      if (idx <= 0 || p.length - idx - 1 > 100) throw new Error(`path too long for ustar: ${p}`);
      header.write(p.slice(idx + 1), 0, "utf8");
      header.write(p.slice(0, idx), 345, "utf8");
    } else {
      header.write(p, 0, "utf8");
    }
    writeOctal(header, 100, 8, mode || 0o644);
    writeOctal(header, 108, 8, 0); // uid
    writeOctal(header, 116, 8, 0); // gid
    writeOctal(header, 124, 12, data.length);
    writeOctal(header, 136, 12, mtime);
    header[156] = 48; // '0' regular file
    header.write("ustar", 257, "ascii"); header[262] = 0;
    header.write("00", 263, "ascii");
    // checksum
    header.fill(32, 148, 156);
    let sum = 0; for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, "0"), 148, "ascii");
    header[154] = 0; header[155] = 32;
    chunks.push(header, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(chunks);
  return { tgz: gzipSync(tar, { level: 9 }), tarSha256: createHash("sha256").update(tar).digest("hex") };
}

export function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }
