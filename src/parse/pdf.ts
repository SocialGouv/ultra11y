// A ZERO-DEPENDENCY PDF READER — just enough of ISO 32000 to answer the document-level
// questions a PDF/UA-1 / WCAG check asks first: is the file tagged, does it declare a language
// and a title (and does the viewer show that title), does it carry extractable text at all, and
// does its structure tree hold any heading or table header.
//
// Node built-ins only (`zlib` inflates object streams, xref streams and content streams), in
// keeping with CONTRIBUTING: the engine ships no runtime dependency, so a PDF library is not an
// option. What this reads, and what it deliberately does not:
//
//   • the cross-reference data in every shape a generator writes — a classic `xref` table, a
//     PDF 1.5 xref STREAM (PNG-predicted), a hybrid file (`/XRefStm`) and an incremental update
//     chain (`/Prev`) — and, when the offsets lie, a REPAIR scan of every `N G obj` header,
//     which is what a viewer does too;
//   • objects inside object streams (`/Type /ObjStm`);
//   • stream filters FlateDecode (with PNG/TIFF-free predictors), LZWDecode, ASCIIHexDecode,
//     ASCII85Decode and RunLengthDecode. An image filter (DCT, JPX, CCITT, JBIG2) is never
//     decoded — no question asked here needs pixels.
//
//   • NOT encryption. An encrypted file's strings and streams are ciphertext; rather than guess,
//     the reader reports it UNREADABLE, and so does every file it cannot make sense of. That is
//     the honesty rule of the whole engine applied to documents: a file nobody could read is
//     never reported as a file that passed.
//
// Passing every check this module feeds proves the absence of the gross failures (an untagged
// file, no language, no title, a scan with no text) — never PDF/UA conformance, which a
// dedicated validator (veraPDF, PAC) establishes.
import { inflateSync, constants as zlibConstants } from "node:zlib";

// ---------------------------------------------------------------------------------------------
// Object model
// ---------------------------------------------------------------------------------------------

export class PdfName {
  readonly v: string;
  constructor(v: string) {
    this.v = v;
  }
}
export class PdfRef {
  readonly num: number;
  readonly gen: number;
  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
}
export class PdfStr {
  readonly bytes: Buffer;
  constructor(bytes: Buffer) {
    this.bytes = bytes;
  }
}
export class PdfStream {
  readonly dict: PdfDict;
  readonly start: number;
  readonly end: number;
  constructor(dict: PdfDict, start: number, end: number) {
    this.dict = dict;
    this.start = start;
    this.end = end;
  }
}
export type PdfDict = Map<string, PdfVal>;
export type PdfVal = number | boolean | null | PdfName | PdfRef | PdfStr | PdfVal[] | PdfDict | PdfStream;

const isDict = (v: unknown): v is PdfDict => v instanceof Map;

/** Thrown for a file the reader cannot make sense of. `reason` is what the report says. */
export class PdfUnreadable extends Error {
  readonly reason: PdfUnreadableReason;
  constructor(reason: PdfUnreadableReason, detail: string) {
    super(detail);
    this.reason = reason;
  }
}
export type PdfUnreadableReason = "not-pdf" | "encrypted" | "malformed" | "truncated" | "too-large";

// ---------------------------------------------------------------------------------------------
// Lexer / object parser
// ---------------------------------------------------------------------------------------------

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isRegular = (c: number | undefined): boolean => c !== undefined && !WS.has(c) && !DELIM.has(c);

/** Hard ceilings, so a hostile or broken file can cost bounded work and nothing more. */
const MAX_NESTING = 64;

class Lexer {
  readonly buf: Buffer;
  pos: number;
  constructor(buf: Buffer, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  skipWs(): void {
    const b = this.buf;
    for (;;) {
      while (this.pos < b.length && WS.has(b[this.pos]!)) this.pos++;
      if (b[this.pos] === 0x25) {
        // comment, to end of line
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
        continue;
      }
      return;
    }
  }

  /** A bare keyword/number token at the cursor, without consuming it. */
  peekToken(): string {
    this.skipWs();
    let e = this.pos;
    while (isRegular(this.buf[e])) e++;
    return this.buf.toString("latin1", this.pos, e);
  }

  readToken(): string {
    const t = this.peekToken();
    this.pos += t.length;
    return t;
  }

  parse(depth = 0): PdfVal {
    if (depth > MAX_NESTING) throw new PdfUnreadable("malformed", "object nesting too deep");
    this.skipWs();
    const b = this.buf;
    const c = b[this.pos];
    if (c === undefined) throw new PdfUnreadable("truncated", "unexpected end of file");
    if (c === 0x2f) return this.name();
    if (c === 0x28) return this.literal();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) return this.dict(depth);
      return this.hex();
    }
    if (c === 0x5b) {
      this.pos++;
      const arr: PdfVal[] = [];
      for (;;) {
        this.skipWs();
        if (this.pos >= b.length) throw new PdfUnreadable("truncated", "unterminated array");
        if (b[this.pos] === 0x5d) {
          this.pos++;
          return arr;
        }
        arr.push(this.parse(depth + 1));
      }
    }
    const tok = this.readToken();
    if (tok === "") {
      // A stray delimiter (`)`, `>`, `}`): skip it rather than loop on it.
      this.pos++;
      return null;
    }
    if (tok === "true") return true;
    if (tok === "false") return false;
    if (tok === "null") return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      const n = Number(tok);
      // `N G R` — an indirect reference — is only recognisable two tokens ahead.
      if (/^\d+$/.test(tok)) {
        const save = this.pos;
        const gen = this.readToken();
        if (/^\d+$/.test(gen) && this.readToken() === "R") return new PdfRef(n, Number(gen));
        this.pos = save;
      }
      return n;
    }
    // An unknown bare keyword (an operator in a content stream, `obj`/`endobj` out of place):
    // surfaced as a name-like value the callers ignore.
    return new PdfName(`\u0000${tok}`);
  }

  private name(): PdfName {
    const b = this.buf;
    this.pos++; // '/'
    const bytes: number[] = [];
    while (isRegular(b[this.pos])) {
      const c = b[this.pos]!;
      if (c === 0x23 && /^[0-9a-f]{2}$/i.test(b.toString("latin1", this.pos + 1, this.pos + 3))) {
        bytes.push(Number.parseInt(b.toString("latin1", this.pos + 1, this.pos + 3), 16));
        this.pos += 3;
        continue;
      }
      bytes.push(c);
      this.pos++;
    }
    return new PdfName(Buffer.from(bytes).toString("utf8"));
  }

  private literal(): PdfStr {
    const b = this.buf;
    this.pos++; // '('
    let depth = 1;
    const out: number[] = [];
    while (this.pos < b.length) {
      const c = b[this.pos++]!;
      if (c === 0x5c) {
        const n = b[this.pos++];
        if (n === undefined) break;
        const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 0x28, 41: 0x29, 92: 0x5c };
        if (map[n] !== undefined) out.push(map[n]!);
        else if (n >= 0x30 && n <= 0x37) {
          let oct = n - 0x30;
          for (let i = 0; i < 2 && b[this.pos]! >= 0x30 && b[this.pos]! <= 0x37; i++) oct = oct * 8 + (b[this.pos++]! - 0x30);
          out.push(oct & 0xff);
        } else if (n === 13) {
          if (b[this.pos] === 10) this.pos++; // line continuation
        } else if (n !== 10) out.push(n);
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) return new PdfStr(Buffer.from(out));
      out.push(c);
    }
    throw new PdfUnreadable("truncated", "unterminated string");
  }

  private hex(): PdfStr {
    const b = this.buf;
    const end = b.indexOf(0x3e, this.pos);
    if (end < 0) throw new PdfUnreadable("truncated", "unterminated hex string");
    let digits = b.toString("latin1", this.pos + 1, end).replace(/[^0-9a-f]/gi, "");
    if (digits.length % 2) digits += "0";
    this.pos = end + 1;
    return new PdfStr(Buffer.from(digits, "hex"));
  }

  private dict(depth: number): PdfDict | PdfStream {
    const b = this.buf;
    this.pos += 2;
    const d: PdfDict = new Map();
    for (;;) {
      this.skipWs();
      if (this.pos >= b.length) throw new PdfUnreadable("truncated", "unterminated dictionary");
      if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      const key = this.parse(depth + 1);
      if (!(key instanceof PdfName)) continue; // tolerate junk between entries
      d.set(key.v, this.parse(depth + 1));
    }
    return d;
  }
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

/** Sum of decoded bytes a single file may produce. A zip bomb stops here, not in memory. */
const MAX_DECODED_TOTAL = 256 * 1024 * 1024;
/** Largest single decoded stream. Enforced WHILE decoding — a budget checked after a stream is
 *  fully expanded is checked after the heap has already given out, which no catch survives. */
const MAX_STREAM_DECODED = 64 * 1024 * 1024;

const tooLarge = (): PdfUnreadable => new PdfUnreadable("too-large", `a decoded stream exceeds ${MAX_STREAM_DECODED} bytes`);

/** A growable byte buffer that refuses to grow past `MAX_STREAM_DECODED`. */
class ByteSink {
  private buf = Buffer.alloc(4096);
  length = 0;
  private ensure(n: number): void {
    if (this.length + n > MAX_STREAM_DECODED) throw tooLarge();
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = Buffer.alloc(Math.min(size, MAX_STREAM_DECODED));
    this.buf.copy(next, 0, 0, this.length);
    this.buf = next;
  }
  push(b: number): void {
    this.ensure(1);
    this.buf[this.length++] = b;
  }
  fill(b: number, n: number): void {
    this.ensure(n);
    this.buf.fill(b, this.length, this.length + n);
    this.length += n;
  }
  append(bytes: ArrayLike<number>): void {
    this.ensure(bytes.length);
    for (let i = 0; i < bytes.length; i++) this.buf[this.length++] = bytes[i]!;
  }
  done(): Buffer {
    return this.buf.subarray(0, this.length);
  }
}

function inflate(data: Buffer): Buffer {
  const attempt = (opts: Parameters<typeof inflateSync>[1]): Buffer => {
    try {
      return inflateSync(data, { ...opts, maxOutputLength: MAX_STREAM_DECODED });
    } catch (e) {
      // zlib refuses to produce more than maxOutputLength with a RangeError: a bomb, not a typo.
      if (e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw tooLarge();
      throw e;
    }
  };
  try {
    return attempt({});
  } catch (e) {
    if (e instanceof PdfUnreadable) throw e;
    // A truncated or slightly corrupt deflate stream is common in the wild (a missing checksum,
    // a generator that cut the last block). Salvage what decodes, as viewers do.
    try {
      return attempt({ finishFlush: zlibConstants.Z_SYNC_FLUSH });
    } catch (e2) {
      if (e2 instanceof PdfUnreadable) throw e2;
      throw new PdfUnreadable("malformed", "a FlateDecode stream could not be inflated");
    }
  }
}

function unpredict(data: Buffer, parms: PdfDict | undefined): Buffer {
  const predictor = num(parms?.get("Predictor")) ?? 1;
  if (predictor < 10) {
    if (predictor === 1) return data;
    throw new PdfUnreadable("malformed", `unsupported predictor ${predictor}`);
  }
  const colors = num(parms?.get("Colors")) ?? 1;
  const bpc = num(parms?.get("BitsPerComponent")) ?? 8;
  const columns = num(parms?.get("Columns")) ?? 1;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const out = Buffer.alloc(Math.floor(data.length / (rowLen + 1)) * rowLen);
  let prev = Buffer.alloc(rowLen);
  let o = 0;
  for (let i = 0; i + rowLen < data.length + 1 && o < out.length; i += rowLen + 1) {
    const type = data[i]!;
    const row = Buffer.from(data.subarray(i + 1, i + 1 + rowLen));
    for (let x = 0; x < rowLen; x++) {
      const left = x >= bpp ? row[x - bpp]! : 0;
      const up = prev[x]!;
      const ul = x >= bpp ? prev[x - bpp]! : 0;
      let v = row[x]!;
      if (type === 1) v += left;
      else if (type === 2) v += up;
      else if (type === 3) v += (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      row[x] = v & 0xff;
    }
    row.copy(out, o);
    o += rowLen;
    prev = row;
  }
  return out.subarray(0, o);
}

function asciiHex(data: Buffer): Buffer {
  let s = data.toString("latin1");
  const end = s.indexOf(">");
  if (end >= 0) s = s.slice(0, end);
  s = s.replace(/[^0-9a-f]/gi, "");
  if (s.length % 2) s += "0";
  return Buffer.from(s, "hex");
}

function ascii85(data: Buffer): Buffer {
  let s = data.toString("latin1").replace(/\s+/g, "");
  if (s.startsWith("<~")) s = s.slice(2);
  const end = s.indexOf("~>");
  if (end >= 0) s = s.slice(0, end);
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number): void => {
    let v = 0;
    for (const c of group) v = v * 85 + c;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    out.push(...bytes.slice(0, n));
  };
  for (const ch of s) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) continue;
    group.push(c);
    if (group.length === 5) {
      flush(4);
      group = [];
    }
  }
  if (group.length) {
    const n = group.length - 1;
    while (group.length < 5) group.push(84);
    flush(n);
  }
  return Buffer.from(out);
}

function lzw(data: Buffer, earlyChange = 1): Buffer {
  const out = new ByteSink();
  let dict: number[][] = [];
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push([i]);
    dict.push([], []); // 256 clear, 257 EOD
  };
  reset();
  let width = 9;
  let bitBuf = 0;
  let bitCount = 0;
  let prev: number[] | null = null;
  for (const byte of data) {
    bitBuf = (bitBuf << 8) | byte;
    bitCount += 8;
    while (bitCount >= width) {
      const code = (bitBuf >>> (bitCount - width)) & ((1 << width) - 1);
      bitCount -= width;
      bitBuf &= (1 << bitCount) - 1;
      if (code === 256) {
        reset();
        width = 9;
        prev = null;
        continue;
      }
      if (code === 257) return out.done();
      let entry: number[];
      if (code < dict.length && dict[code]!.length) entry = dict[code]!;
      else if (prev) entry = [...prev, prev[0]!];
      else throw new PdfUnreadable("malformed", "corrupt LZW stream");
      out.append(entry);
      // 12-bit codes address 4096 entries; a stream that never clears cannot grow the table.
      if (prev && dict.length < 4096) dict.push([...prev, entry[0]!]);
      prev = entry;
      if (dict.length + earlyChange >= 1 << width && width < 12) width++;
    }
  }
  return out.done();
}

function runLength(data: Buffer): Buffer {
  const out = new ByteSink();
  for (let i = 0; i < data.length; ) {
    const n = data[i++]!;
    if (n === 128) break;
    if (n < 128) {
      const end = Math.min(data.length, i + n + 1);
      out.append(data.subarray(i, end));
      i = end;
    } else out.fill(data[i++] ?? 0, 257 - n);
  }
  return out.done();
}

/** Image codecs: never decoded here — nothing this reader asks needs pixels. */
const IMAGE_FILTERS = new Set(["DCTDecode", "DCT", "JPXDecode", "CCITTFaxDecode", "CCF", "JBIG2Decode"]);

function num(v: PdfVal | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function nameOf(v: PdfVal | undefined): string | undefined {
  return v instanceof PdfName ? v.v : undefined;
}

// ---------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------

interface XrefEntry {
  type: 1 | 2;
  /** type 1: byte offset; type 2: the object stream's number */
  a: number;
  /** type 1: generation; type 2: index inside the object stream */
  b: number;
}

/** A parsed PDF file: the xref, the trailer, and lazy object resolution. */
export class PdfDocument {
  readonly xref = new Map<number, XrefEntry>();
  trailer: PdfDict = new Map();
  repaired = false;
  xrefStream = false;
  objectStreams = false;
  private cache = new Map<number, PdfVal>();
  private objStmCache = new Map<number, { buf: Buffer; offsets: Map<number, number> }>();
  private resolving = new Set<number>();
  private decodedTotal = 0;
  readonly text: string;
  readonly buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.text = buf.toString("latin1");
    try {
      this.readXrefChain();
      // The chain parsed, but does it lead anywhere? A wrong offset table is the commonest
      // defect in the wild, and the cheapest proof it is right is that the catalog resolves.
      if (!isDict(this.get(this.trailer.get("Root")))) throw new PdfUnreadable("malformed", "the trailer's /Root does not resolve");
    } catch (e) {
      if (e instanceof PdfUnreadable && e.reason === "too-large") throw e;
      this.repair();
    }
  }

  // ---- xref ----------------------------------------------------------------------------------

  private readXrefChain(): void {
    const tail = this.text.slice(Math.max(0, this.text.length - 4096));
    const m = /startxref\s+(\d+)/g;
    let last: RegExpExecArray | null = null;
    for (let r = m.exec(tail); r; r = m.exec(tail)) last = r;
    if (!last) throw new PdfUnreadable("truncated", "no startxref");
    let offset: number | undefined = Number(last[1]);
    const seen = new Set<number>();
    let first = true;
    while (offset !== undefined && !seen.has(offset)) {
      seen.add(offset);
      const trailer = this.readXrefSection(offset);
      if (first) {
        this.trailer = trailer;
        first = false;
      } else {
        for (const [k, v] of trailer) if (!this.trailer.has(k)) this.trailer.set(k, v);
      }
      // Hybrid file: the table's trailer points at an xref stream holding the newer objects.
      const stm = num(trailer.get("XRefStm"));
      if (stm !== undefined && !seen.has(stm)) {
        seen.add(stm);
        this.readXrefSection(stm);
      }
      offset = num(trailer.get("Prev"));
    }
  }

  /** One xref section at `offset` — a table or a stream. Older entries never override newer
   *  ones, so the chain is walked newest-first and `set` only fills gaps. */
  private readXrefSection(offset: number): PdfDict {
    if (offset < 0 || offset >= this.buf.length) throw new PdfUnreadable("malformed", "xref offset out of range");
    const lx = new Lexer(this.buf, offset);
    if (lx.peekToken() === "xref") {
      lx.readToken();
      for (;;) {
        const tok = lx.peekToken();
        if (tok === "trailer") {
          lx.readToken();
          const t = lx.parse();
          if (!isDict(t)) throw new PdfUnreadable("malformed", "trailer is not a dictionary");
          return t;
        }
        if (!/^\d+$/.test(tok)) throw new PdfUnreadable("malformed", "bad xref subsection");
        const start = Number(lx.readToken());
        const count = Number(lx.readToken());
        for (let i = 0; i < count; i++) {
          const off = lx.readToken();
          const gen = lx.readToken();
          const kind = lx.readToken();
          if (!/^\d+$/.test(off) || !/^\d+$/.test(gen) || (kind !== "n" && kind !== "f")) throw new PdfUnreadable("malformed", "bad xref entry");
          if (kind === "n" && !this.xref.has(start + i) && Number(off) > 0) this.xref.set(start + i, { type: 1, a: Number(off), b: Number(gen) });
        }
      }
    }
    // A cross-reference STREAM (PDF 1.5+).
    const obj = this.parseIndirectAt(offset);
    if (!(obj instanceof PdfStream) || nameOf(obj.dict.get("Type")) !== "XRef")
      throw new PdfUnreadable("malformed", "startxref points at neither a table nor an xref stream");
    this.xrefStream = true;
    const data = this.decode(obj);
    const w = (obj.dict.get("W") as PdfVal[] | undefined)?.map((x) => num(x) ?? 0) ?? [];
    if (w.length !== 3) throw new PdfUnreadable("malformed", "xref stream without /W");
    const size = num(obj.dict.get("Size")) ?? 0;
    const index = ((obj.dict.get("Index") as PdfVal[] | undefined) ?? [0, size]).map((x) => num(x) ?? 0);
    const rowLen = w[0]! + w[1]! + w[2]!;
    const field = (p: number, n: number): number => {
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + data[p + i]!;
      return v;
    };
    let p = 0;
    for (let s = 0; s + 1 < index.length; s += 2) {
      const start = index[s]!;
      const count = index[s + 1]!;
      for (let i = 0; i < count && p + rowLen <= data.length; i++, p += rowLen) {
        const type = w[0] === 0 ? 1 : field(p, w[0]!);
        const a = field(p + w[0]!, w[1]!);
        const b = field(p + w[0]! + w[1]!, w[2]!);
        if (this.xref.has(start + i)) continue;
        if (type === 1 && a > 0) this.xref.set(start + i, { type: 1, a, b });
        else if (type === 2) {
          this.objectStreams = true;
          this.xref.set(start + i, { type: 2, a, b });
        }
      }
    }
    return obj.dict;
  }

  /** The xref lied or is missing: rebuild it from every `N G obj` header in the file (last
   *  definition wins, as in an incremental update), and the trailer from the last `trailer`
   *  dictionary or the last xref stream — the same recovery a viewer performs. */
  private repair(): void {
    this.repaired = true;
    this.xref.clear();
    this.cache.clear();
    const re = /(?:^|[\r\n\s])(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
    for (let m = re.exec(this.text); m; m = re.exec(this.text)) {
      const at = m.index + m[0].indexOf(m[1]!);
      this.xref.set(Number(m[1]), { type: 1, a: at, b: Number(m[2]) });
    }
    const trailer: PdfDict = new Map();
    const tre = /trailer\s*<</g;
    let lastTrailer = -1;
    for (let m = tre.exec(this.text); m; m = tre.exec(this.text)) lastTrailer = m.index;
    if (lastTrailer >= 0) {
      try {
        const lx = new Lexer(this.buf, lastTrailer + "trailer".length);
        const t = lx.parse();
        if (isDict(t)) for (const [k, v] of t) trailer.set(k, v);
      } catch {
        /* fall through to the stream/catalog scan */
      }
    }
    // Object streams hide their objects from the header scan; register them from any xref
    // stream that still parses, then fall back to scanning the object streams themselves.
    for (const [n, e] of [...this.xref]) {
      if (e.type !== 1) continue;
      let o: PdfVal;
      try {
        o = this.get(new PdfRef(n, e.b));
      } catch {
        continue;
      }
      if (!(o instanceof PdfStream)) continue;
      const type = nameOf(o.dict.get("Type"));
      if (type === "XRef") {
        for (const k of ["Root", "Info", "Encrypt", "ID"]) if (!trailer.has(k) && o.dict.has(k)) trailer.set(k, o.dict.get(k)!);
      } else if (type === "ObjStm") {
        try {
          const stm = this.loadObjStm(n);
          this.objectStreams = true;
          let i = 0;
          for (const objNum of stm.offsets.keys()) {
            if (!this.xref.has(objNum)) this.xref.set(objNum, { type: 2, a: n, b: i });
            i++;
          }
        } catch {
          /* an unreadable object stream contributes nothing */
        }
      }
    }
    if (!trailer.has("Root")) {
      for (const [n, e] of this.xref) {
        try {
          const o = this.get(new PdfRef(n, e.type === 1 ? e.b : 0));
          if (isDict(o) && nameOf(o.get("Type")) === "Catalog") {
            trailer.set("Root", new PdfRef(n, e.type === 1 ? e.b : 0));
            break;
          }
        } catch {
          /* keep scanning */
        }
      }
    }
    this.trailer = trailer;
    if (!isDict(this.get(trailer.get("Root")))) {
      throw new PdfUnreadable(this.text.includes("%%EOF") ? "malformed" : "truncated", "no document catalog could be found");
    }
  }

  // ---- objects -------------------------------------------------------------------------------

  private parseIndirectAt(offset: number): PdfVal {
    const lx = new Lexer(this.buf, offset);
    const n = lx.readToken();
    const g = lx.readToken();
    if (!/^\d+$/.test(n) || !/^\d+$/.test(g) || lx.readToken() !== "obj") throw new PdfUnreadable("malformed", `no object at offset ${offset}`);
    const val = lx.parse();
    if (isDict(val) && lx.peekToken() === "stream") {
      lx.readToken();
      let start = lx.pos;
      if (this.buf[start] === 13 && this.buf[start + 1] === 10) start += 2;
      else if (this.buf[start] === 10 || this.buf[start] === 13) start += 1;
      // /Length may itself be indirect; trust it only when `endstream` follows it.
      const len = this.lengthOf(val.get("Length"));
      let end = len !== undefined ? start + len : -1;
      if (end < 0 || end > this.buf.length || !/^\s*endstream/.test(this.text.slice(end, end + 32))) {
        const found = this.text.indexOf("endstream", start);
        if (found < 0) throw new PdfUnreadable("truncated", "stream without endstream");
        end = found;
        // strip the EOL before `endstream`, which is not part of the data
        if (this.buf[end - 1] === 10) end--;
        if (this.buf[end - 1] === 13) end--;
      }
      return new PdfStream(val, start, end);
    }
    return val;
  }

  private lengthOf(v: PdfVal | undefined): number | undefined {
    if (typeof v === "number") return v;
    if (v instanceof PdfRef) {
      try {
        return num(this.get(v));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private loadObjStm(num_: number): { buf: Buffer; offsets: Map<number, number> } {
    const hit = this.objStmCache.get(num_);
    if (hit) return hit;
    const s = this.get(new PdfRef(num_, 0));
    if (!(s instanceof PdfStream)) throw new PdfUnreadable("malformed", "object stream is not a stream");
    const buf = this.decode(s);
    const n = num(s.dict.get("N")) ?? 0;
    const first = num(s.dict.get("First")) ?? 0;
    const lx = new Lexer(buf, 0);
    const offsets = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const objNum = lx.readToken();
      const off = lx.readToken();
      if (!/^\d+$/.test(objNum) || !/^\d+$/.test(off)) break;
      offsets.set(Number(objNum), first + Number(off));
    }
    const out = { buf, offsets };
    this.objStmCache.set(num_, out);
    return out;
  }

  /** Resolve a reference (or pass a direct value through). An object that cannot be read is
   *  `null`, the PDF meaning of « absent » — callers decide what absence implies. */
  get(v: PdfVal | undefined): PdfVal {
    if (!(v instanceof PdfRef)) return v ?? null;
    const cached = this.cache.get(v.num);
    if (cached !== undefined) return cached;
    if (this.resolving.has(v.num)) return null; // a reference cycle
    const e = this.xref.get(v.num);
    if (!e) return null;
    this.resolving.add(v.num);
    try {
      let val: PdfVal;
      if (e.type === 1) val = this.parseIndirectAt(e.a);
      else {
        const stm = this.loadObjStm(e.a);
        const at = stm.offsets.get(v.num);
        val = at === undefined ? null : new Lexer(stm.buf, at).parse();
      }
      this.cache.set(v.num, val);
      return val;
    } catch (err) {
      if (err instanceof PdfUnreadable && err.reason === "too-large") throw err;
      this.cache.set(v.num, null);
      return null;
    } finally {
      this.resolving.delete(v.num);
    }
  }

  dict(v: PdfVal | undefined): PdfDict | undefined {
    const r = this.get(v);
    if (isDict(r)) return r;
    if (r instanceof PdfStream) return r.dict;
    return undefined;
  }

  array(v: PdfVal | undefined): PdfVal[] | undefined {
    const r = this.get(v);
    return Array.isArray(r) ? r : undefined;
  }

  /** A stream's decoded bytes. Throws for an image codec or an unknown filter. */
  decode(s: PdfStream): Buffer {
    let data: Buffer = this.buf.subarray(s.start, s.end);
    const fv = this.get(s.dict.get("Filter"));
    const filters = (Array.isArray(fv) ? fv : fv ? [fv] : []).map((f) => nameOf(this.get(f)) ?? "");
    const pv = this.get(s.dict.get("DecodeParms"));
    const parmsList = Array.isArray(pv) ? pv.map((p) => this.dict(p)) : [this.dict(pv)];
    filters.forEach((f, i) => {
      const parms = parmsList[i] ?? (filters.length === 1 ? parmsList[0] : undefined);
      if (f === "FlateDecode" || f === "Fl") data = unpredict(inflate(data), parms);
      else if (f === "LZWDecode" || f === "LZW") data = unpredict(lzw(data, num(parms?.get("EarlyChange")) ?? 1), parms);
      else if (f === "ASCIIHexDecode" || f === "AHx") data = asciiHex(data);
      else if (f === "ASCII85Decode" || f === "A85") data = ascii85(data);
      else if (f === "RunLengthDecode" || f === "RL") data = runLength(data);
      else if (IMAGE_FILTERS.has(f)) throw new PdfUnreadable("malformed", `image filter ${f} is not decoded`);
      else throw new PdfUnreadable("malformed", `unsupported filter ${f}`);
    });
    this.decodedTotal += data.length;
    if (this.decodedTotal > MAX_DECODED_TOTAL) throw new PdfUnreadable("too-large", "decoded content exceeds the reader's budget");
    return data;
  }
}

// ---------------------------------------------------------------------------------------------
// Text strings
// ---------------------------------------------------------------------------------------------

/** A PDF text string: UTF-16BE with a BOM, UTF-8 with a BOM (PDF 2.0), else PDFDocEncoding —
 *  which agrees with Latin-1 everywhere a title or a language tag realistically lives. */
export function pdfText(v: PdfVal | undefined): string | undefined {
  if (!(v instanceof PdfStr)) return v instanceof PdfName ? v.v : undefined;
  const b = v.bytes;
  if (b[0] === 0xfe && b[1] === 0xff) {
    const sw = Buffer.from(b.subarray(2));
    if (sw.length % 2)
      return sw
        .subarray(0, sw.length - 1)
        .swap16()
        .toString("utf16le");
    return sw.swap16().toString("utf16le");
  }
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString("utf8");
  return b.toString("latin1");
}

// ---------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------

export interface PdfStructure {
  /** Structure elements walked (bounded — see `truncated`). */
  elements: number;
  headings: number;
  tables: number;
  tablesWithoutTh: number;
  figures: number;
  figuresWithoutAlt: number;
  /** The walk hit its node budget: counts are a lower bound. */
  truncated: boolean;
}

/** What the reader established about one PDF file. Every field is an OBSERVATION; none of them,
 *  alone or together, is a statement that the document is accessible. */
export interface PdfFacts {
  readable: boolean;
  /** Set when `readable` is false: why nothing below could be established. */
  unreadable?: PdfUnreadableReason;
  detail?: string;
  /** `%PDF-x.y` header (a catalog /Version wins when newer). */
  version?: string;
  pages: number;
  /** /MarkInfo << /Marked true >> */
  marked: boolean;
  /** /StructTreeRoot present */
  structTree: boolean;
  /** Both of the above — a TAGGED file in the PDF/UA sense. */
  tagged: boolean;
  /** Catalog /Lang, trimmed; absent when missing or empty. */
  lang?: string;
  /** Document title from the Info dictionary, else from the XMP dc:title. */
  title?: string;
  titleSource?: "info" | "xmp";
  /** /ViewerPreferences /DisplayDocTitle true */
  displayDocTitle: boolean;
  /** Font resources seen on the pages (and their form XObjects). */
  fonts: number;
  /** Text-showing operators (Tj, TJ, ', ") found in the content streams. */
  textOps: number;
  /** Image XObjects / inline images drawn. */
  images: number;
  /** Every page's content could be decoded and scanned. When false, `textOps === 0` proves
   *  nothing and no text verdict may be drawn. */
  contentScanned: boolean;
  structure?: PdfStructure;
  xrefStream: boolean;
  objectStreams: boolean;
  /** The cross-reference data was wrong and had to be rebuilt by scanning the file. */
  repaired: boolean;
}

const MAX_PAGES_SCANNED = 500;
const MAX_STRUCT_NODES = 50_000;
const MAX_FORM_DEPTH = 4;
/** Files above this are not read at all — reported unreadable (`too-large`). */
export const PDF_MAX_BYTES = 64 * 1024 * 1024;

function unreadable(reason: PdfUnreadableReason, detail: string, version?: string): PdfFacts {
  return {
    readable: false,
    unreadable: reason,
    detail,
    ...(version ? { version } : {}),
    pages: 0,
    marked: false,
    structTree: false,
    tagged: false,
    displayDocTitle: false,
    fonts: 0,
    textOps: 0,
    images: 0,
    contentScanned: false,
    xrefStream: false,
    objectStreams: false,
    repaired: false,
  };
}

/** Read the document-level facts of a PDF. Never throws: a file it cannot read comes back
 *  `readable: false` with the reason. */
export function readPdf(bytes: Uint8Array): PdfFacts {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length > PDF_MAX_BYTES) return unreadable("too-large", `file is ${buf.length} bytes; the reader stops at ${PDF_MAX_BYTES}`);
  const head = buf.toString("latin1", 0, Math.min(buf.length, 1024));
  const hv = /%PDF-(\d\.\d)/.exec(head);
  if (!hv) return unreadable("not-pdf", "no %PDF- header in the first 1024 bytes");
  let version = hv[1]!;
  try {
    const doc = new PdfDocument(buf);
    if (doc.trailer.has("Encrypt") && doc.get(doc.trailer.get("Encrypt")) !== null) {
      return unreadable("encrypted", "the file is encrypted; its strings and streams cannot be read without decrypting them", version);
    }
    const catalog = doc.dict(doc.trailer.get("Root"));
    if (!catalog) return unreadable("malformed", "no document catalog", version);
    const cv = nameOf(doc.get(catalog.get("Version")));
    if (cv && /^\d\.\d$/.test(cv) && cv > version) version = cv;

    const markInfo = doc.dict(catalog.get("MarkInfo"));
    const marked = doc.get(markInfo?.get("Marked")) === true;
    const structRoot = doc.dict(catalog.get("StructTreeRoot"));
    const lang = pdfText(doc.get(catalog.get("Lang")))?.trim() || undefined;
    const prefs = doc.dict(catalog.get("ViewerPreferences"));
    const displayDocTitle = doc.get(prefs?.get("DisplayDocTitle")) === true;

    let title = pdfText(doc.get(doc.dict(doc.trailer.get("Info"))?.get("Title")))?.trim() || undefined;
    let titleSource: PdfFacts["titleSource"] = title ? "info" : undefined;
    if (!title) {
      title = xmpTitle(doc, catalog);
      if (title) titleSource = "xmp";
    }

    const pages = collectPages(doc, catalog);
    const content = scanContent(doc, pages);
    const structure = structRoot ? walkStructure(doc, structRoot) : undefined;
    return {
      readable: true,
      version,
      pages: Math.max(pages.length, num(doc.dict(catalog.get("Pages"))?.get("Count")) ?? 0),
      marked,
      structTree: !!structRoot,
      tagged: marked && !!structRoot,
      ...(lang ? { lang } : {}),
      ...(title ? { title, titleSource } : {}),
      displayDocTitle,
      fonts: content.fonts,
      textOps: content.textOps,
      images: content.images,
      contentScanned: content.complete,
      ...(structure ? { structure } : {}),
      xrefStream: doc.xrefStream,
      objectStreams: doc.objectStreams,
      repaired: doc.repaired,
    };
  } catch (e) {
    if (e instanceof PdfUnreadable) return unreadable(e.reason, e.message, version);
    return unreadable("malformed", e instanceof Error ? e.message : String(e), version);
  }
}

function xmpTitle(doc: PdfDocument, catalog: PdfDict): string | undefined {
  const md = doc.get(catalog.get("Metadata"));
  if (!(md instanceof PdfStream)) return undefined;
  let xml: string;
  try {
    xml = doc.decode(md).toString("utf8");
  } catch {
    return undefined;
  }
  const block = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(xml)?.[1];
  if (!block) return undefined;
  const li = /<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/i.exec(block)?.[1] ?? block;
  const text = li
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .trim();
  return text || undefined;
}

interface PageRef {
  dict: PdfDict;
  resources: PdfDict | undefined;
}

/** The page tree, flattened, with inherited /Resources resolved. Cycle-safe and bounded. */
function collectPages(doc: PdfDocument, catalog: PdfDict): PageRef[] {
  const out: PageRef[] = [];
  const seen = new Set<PdfDict>();
  const walk = (node: PdfDict | undefined, inherited: PdfDict | undefined, depth: number): void => {
    if (!node || seen.has(node) || depth > MAX_NESTING || out.length >= MAX_PAGES_SCANNED * 4) return;
    seen.add(node);
    const resources = doc.dict(node.get("Resources")) ?? inherited;
    const kids = doc.array(node.get("Kids"));
    const type = nameOf(doc.get(node.get("Type")));
    if (type === "Page" || (!kids && type !== "Pages")) {
      out.push({ dict: node, resources });
      return;
    }
    for (const k of kids ?? []) walk(doc.dict(k), resources, depth + 1);
  };
  walk(doc.dict(catalog.get("Pages")), undefined, 0);
  return out;
}

const TEXT_OPS = new Set(["Tj", "TJ", "'", '"']);

/** Scan page content streams for text-showing operators, fonts and images. Stops early once
 *  text is found — the only question is whether ANY text exists. */
function scanContent(doc: PdfDocument, pages: PageRef[]): { fonts: number; textOps: number; images: number; complete: boolean } {
  let fonts = 0;
  let textOps = 0;
  let images = 0;
  let complete = pages.length > 0;
  const fontSeen = new Set<PdfVal>();
  const formSeen = new Set<PdfStream>();

  const countFonts = (res: PdfDict | undefined): void => {
    const f = doc.dict(res?.get("Font"));
    if (!f) return;
    for (const v of f.values()) {
      if (fontSeen.has(v)) continue;
      fontSeen.add(v);
      fonts++;
    }
  };

  const scanStream = (data: Buffer, res: PdfDict | undefined, depth: number): void => {
    countFonts(res);
    const xobjects = doc.dict(res?.get("XObject"));
    const ops = contentOperators(data);
    textOps += ops.text;
    images += ops.inlineImages;
    for (const name of ops.xobjects) {
      const xo = doc.get(xobjects?.get(name));
      if (!(xo instanceof PdfStream)) continue;
      const sub = nameOf(doc.get(xo.dict.get("Subtype")));
      if (sub === "Image") images++;
      else if (sub === "Form" && depth < MAX_FORM_DEPTH && !formSeen.has(xo)) {
        formSeen.add(xo);
        try {
          scanStream(doc.decode(xo), doc.dict(xo.dict.get("Resources")) ?? res, depth + 1);
        } catch {
          complete = false;
        }
      }
    }
  };

  for (const [i, page] of pages.entries()) {
    if (i >= MAX_PAGES_SCANNED) {
      if (textOps === 0) complete = false;
      break;
    }
    const cv = doc.get(page.dict.get("Contents"));
    const streams = (Array.isArray(cv) ? cv.map((c) => doc.get(c)) : [cv]).filter((s): s is PdfStream => s instanceof PdfStream);
    // A page's content may be split across streams at any token boundary: concatenate first.
    const parts: Buffer[] = [];
    try {
      for (const s of streams) parts.push(doc.decode(s), Buffer.from("\n"));
    } catch {
      complete = false;
      countFonts(page.resources);
      continue;
    }
    scanStream(Buffer.concat(parts), page.resources, 0);
    if (textOps > 0) break;
  }
  return { fonts, textOps, images, complete };
}

/** Tokenise a content stream just far enough to count operators: strings, hex strings, inline
 *  dictionaries and inline image data are skipped, so a `Tj` inside a string or a run of image
 *  bytes is never mistaken for one. */
export function contentOperators(data: Buffer): { text: number; inlineImages: number; xobjects: string[] } {
  let text = 0;
  let inlineImages = 0;
  const xobjects: string[] = [];
  let lastName: string | undefined;
  let i = 0;
  const n = data.length;
  while (i < n) {
    const c = data[i]!;
    if (WS.has(c)) {
      i++;
      continue;
    }
    if (c === 0x25) {
      while (i < n && data[i] !== 10 && data[i] !== 13) i++;
      continue;
    }
    if (c === 0x28) {
      let depth = 0;
      for (; i < n; i++) {
        const d = data[i]!;
        if (d === 0x5c) {
          i++;
          continue;
        }
        if (d === 0x28) depth++;
        else if (d === 0x29 && --depth === 0) {
          i++;
          break;
        }
      }
      continue;
    }
    if (c === 0x3c) {
      if (data[i + 1] === 0x3c) {
        i += 2;
        continue;
      }
      const e = data.indexOf(0x3e, i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      i++;
      continue;
    }
    if (c === 0x2f) {
      let e = i + 1;
      while (e < n && isRegular(data[e])) e++;
      lastName = data.toString("latin1", i + 1, e);
      i = e;
      continue;
    }
    let e = i;
    while (e < n && isRegular(data[e])) e++;
    if (e === i) e = i + 1;
    const tok = data.toString("latin1", i, e);
    i = e;
    if (TEXT_OPS.has(tok)) text++;
    else if (tok === "Do" && lastName) xobjects.push(lastName);
    else if (tok === "ID") {
      // Inline image data runs to the first whitespace-delimited `EI`.
      inlineImages++;
      i++;
      while (i < n) {
        if (data[i] === 0x45 && data[i + 1] === 0x49 && WS.has(data[i - 1]!) && (i + 2 >= n || WS.has(data[i + 2]!))) {
          i += 2;
          break;
        }
        i++;
      }
    }
  }
  return { text, inlineImages, xobjects };
}

const HEADING = /^H[1-6]?$/;

/** Walk the structure tree from /StructTreeRoot: role-mapped element types, headings, tables
 *  with and without a TH, figures with and without alternative text. Bounded and cycle-safe. */
function walkStructure(doc: PdfDocument, root: PdfDict): PdfStructure {
  const roleMap = doc.dict(root.get("RoleMap"));
  const mapRole = (s: string): string => {
    let cur = s;
    for (let i = 0; i < 8; i++) {
      const next = nameOf(doc.get(roleMap?.get(cur)));
      if (!next || next === cur) break;
      cur = next;
    }
    return cur;
  };
  const st: PdfStructure = { elements: 0, headings: 0, tables: 0, tablesWithoutTh: 0, figures: 0, figuresWithoutAlt: 0, truncated: false };
  const seen = new Set<PdfDict>();
  // Arrays are remembered too: `6 0 obj [6 0 R] endobj` under /K re-expands for ever otherwise.
  const seenArrays = new Set<PdfVal[]>();
  // Each pending node carries the table it sits in, so a TH can be credited to its table.
  const tableHasTh = new Map<number, boolean>();
  let nextTable = 0;
  const stack: { v: PdfVal; table: number | undefined }[] = [{ v: root.get("K") ?? null, table: undefined }];
  while (stack.length) {
    const { v, table } = stack.pop()!;
    const r = doc.get(v);
    if (Array.isArray(r)) {
      if (seenArrays.has(r)) continue;
      seenArrays.add(r);
      if (stack.length + r.length > MAX_STRUCT_NODES * 4) {
        st.truncated = true;
        break;
      }
      for (const k of r) stack.push({ v: k, table });
      continue;
    }
    if (!isDict(r) || seen.has(r)) continue;
    seen.add(r);
    const s = nameOf(doc.get(r.get("S")));
    if (!s) continue; // a marked-content or object reference, not an element
    if (++st.elements > MAX_STRUCT_NODES) {
      st.truncated = true;
      break;
    }
    const type = mapRole(s);
    let inTable = table;
    if (HEADING.test(type)) st.headings++;
    else if (type === "Table") {
      st.tables++;
      inTable = nextTable++;
      tableHasTh.set(inTable, false);
    } else if (type === "TH" && table !== undefined) tableHasTh.set(table, true);
    else if (type === "Figure") {
      st.figures++;
      const alt = pdfText(doc.get(r.get("Alt")))?.trim() || pdfText(doc.get(r.get("ActualText")))?.trim();
      if (!alt) st.figuresWithoutAlt++;
    }
    const k = r.get("K");
    if (k !== undefined) stack.push({ v: k, table: inTable });
  }
  st.tablesWithoutTh = [...tableHasTh.values()].filter((has) => !has).length;
  return st;
}
