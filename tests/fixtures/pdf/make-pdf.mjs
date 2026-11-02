#!/usr/bin/env node
// DEV-ONLY fixture generator for the PDF reader (src/parse/pdf.ts). Writes the small, fully
// synthetic PDFs under tests/fixtures/pdf/ — no third-party document, no font licence: the
// tagged files use a Type 3 font drawn here (one box glyph), which PDF/UA accepts as embedded
// by construction, with a ToUnicode CMap so the text stays extractable.
//
//   node tests/fixtures/pdf/make-pdf.mjs            # (re)write every fixture
//
// `objstm.pdf` is the tagged file rewritten by qpdf with object streams and an xref stream
// (PDF 1.5+): `qpdf --object-streams=generate tagged-ua1.pdf objstm.pdf`. It is regenerated
// here only when qpdf is on the PATH; the committed copy is what the tests read.
//
// Validated with veraPDF (`verapdf --flavour ua1 --format text tagged-ua1.pdf` → PASS).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));

/** Serialise numbered objects into a PDF with a correct classic xref table. Each object is
 *  either a string (the object body) or `{ dict, data }` for a stream. */
export function buildPdf(objects, { version = "1.7", root = 1, info } = {}) {
  const chunks = [];
  let size = 0;
  const push = (b) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    chunks.push(buf);
    size += buf.length;
  };
  push(`%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`);
  const offsets = [];
  objects.forEach((o, i) => {
    offsets[i + 1] = size;
    if (typeof o === "string") push(`${i + 1} 0 obj\n${o}\nendobj\n`);
    else {
      const data = typeof o.data === "string" ? Buffer.from(o.data, "latin1") : o.data;
      push(`${i + 1} 0 obj\n<< ${o.dict} /Length ${data.length} >>\nstream\n`);
      push(data);
      push("\nendstream\nendobj\n");
    }
  });
  const xref = size;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R${info ? ` /Info ${info} 0 R` : ""} /ID [<75313179667978747572653031> <75313179667978747572653031>] >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return Buffer.concat(chunks);
}

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);

// ---- a Type 3 font: printable ASCII, every glyph a box (space is empty) ----------------------
const FIRST = 32;
const LAST = 126;
function type3Font(n) {
  // n = object number of the font; n+1 CharProcs dict, n+2 space glyph, n+3 box glyph, n+4 ToUnicode
  const names = [];
  for (let c = FIRST; c <= LAST; c++) names.push(`/g${c}`);
  const procs = names.map((nm, i) => `${nm} ${i === 0 ? n + 2 : n + 3} 0 R`).join(" ");
  const widths = names.map(() => "500").join(" ");
  const ranges = [];
  for (let c = FIRST; c <= LAST; c++) ranges.push(`<${c.toString(16).padStart(2, "0")}> <${c.toString(16).padStart(4, "0")}>`);
  const cmap = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <ff>",
    "endcodespacerange",
    `${ranges.length} beginbfchar`,
    ...ranges,
    "endbfchar",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
  return [
    `<< /Type /Font /Subtype /Type3 /Name /F1 /FontBBox [0 0 500 700] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs ${n + 1} 0 R /Encoding << /Type /Encoding /Differences [${FIRST} ${names.join(" ")}] >> /FirstChar ${FIRST} /LastChar ${LAST} /Widths [${widths}] /Resources << >> /ToUnicode ${n + 4} 0 R >>`,
    `<< ${procs} >>`,
    { dict: "", data: "500 0 0 0 0 0 d1" },
    { dict: "", data: "500 0 50 0 450 700 d1\n50 0 400 700 re f" },
    { dict: "", data: cmap },
  ];
}

function xmp(title, ua = true) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"${ua ? ' xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"' : ""}>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>${ua ? "\n<pdfuaid:part>1</pdfuaid:part>" : ""}
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** The tagged document: H1, P and a one-row table with a header cell, every content item
 *  marked, language, title and DisplayDocTitle set. Options knock individual pieces out. */
export function taggedPdf({ lang = "fr-FR", title = "Attestation de dépôt", displayDocTitle = true, headings = true, th = true } = {}) {
  // 1 Catalog, 2 Pages, 3 Page, 4 Contents, 5..9 font, 10 StructTreeRoot, 11 Document, 12 H1|P,
  // 13 P, 14 Table, 15 TR, 16 TH|TD, 17 TD, 18 ParentTree, 19 Metadata, 20 Info
  const titleTag = headings ? "H1" : "P";
  const headTag = th ? "TH" : "TD";
  const content = [
    `/${titleTag} <</MCID 0>> BDC BT /F1 24 Tf 72 760 Td (${esc("Attestation")}) Tj ET EMC`,
    `/P <</MCID 1>> BDC BT /F1 12 Tf 72 720 Td (${esc("Declaration transmise le 2 novembre")}) Tj ET EMC`,
    `/${headTag} <</MCID 2>> BDC BT /F1 12 Tf 72 680 Td (Indice) Tj ET EMC`,
    "/TD <</MCID 3>> BDC BT /F1 12 Tf 272 680 Td (94) Tj ET EMC",
  ].join("\n");
  const catalog = [
    "/Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 10 0 R /Metadata 19 0 R",
    lang ? `/Lang (${lang})` : "",
    displayDocTitle ? "/ViewerPreferences << /DisplayDocTitle true >>" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const titleXml = title ?? "";
  const objects = [
    `<< ${catalog} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /StructParents 0 /Tabs /S >>",
    { dict: "/Filter /FlateDecode", data: deflateSync(Buffer.from(content, "latin1"), { level: 9 }) },
    ...type3Font(5),
    "<< /Type /StructTreeRoot /K 11 0 R /ParentTree 18 0 R /ParentTreeNextKey 1 >>",
    "<< /Type /StructElem /S /Document /P 10 0 R /K [12 0 R 13 0 R 14 0 R] >>",
    `<< /Type /StructElem /S /${titleTag} /P 11 0 R /Pg 3 0 R /K 0 >>`,
    "<< /Type /StructElem /S /P /P 11 0 R /Pg 3 0 R /K 1 >>",
    "<< /Type /StructElem /S /Table /P 11 0 R /K [15 0 R] >>",
    "<< /Type /StructElem /S /TR /P 14 0 R /K [16 0 R 17 0 R] >>",
    `<< /Type /StructElem /S /${headTag} /P 15 0 R /Pg 3 0 R /K 2${th ? " /A << /O /Table /Scope /Row >>" : ""} >>`,
    "<< /Type /StructElem /S /TD /P 15 0 R /Pg 3 0 R /K 3 >>",
    "<< /Nums [0 [12 0 R 13 0 R 16 0 R 17 0 R]] >>",
    { dict: "/Type /Metadata /Subtype /XML", data: Buffer.from(xmp(titleXml), "utf8") },
    title ? `<< /Title <feff${Buffer.from(title, "utf16le").swap16().toString("hex")}> /Producer (ultra11y test fixture) >>` : "<< /Producer (ultra11y test fixture) >>",
  ];
  return buildPdf(objects, { version: "1.7", info: 20 });
}

/** What a generator with no accessibility support writes: PDF 1.3, untagged, no language,
 *  no title, text drawn with a standard font. */
export function untaggedPdf() {
  const content = "BT /F1 12 Tf 72 760 Td (Impossible de generer le PDF) Tj ET";
  return buildPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      { dict: "/Filter /FlateDecode", data: deflateSync(Buffer.from(content, "latin1"), { level: 9 }) },
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Producer (ultra11y test fixture) >>",
    ],
    { version: "1.3", info: 6 },
  );
}

/** A scan: one page, one image, no font and no text operator. */
export function imageOnlyPdf() {
  const pixels = Buffer.alloc(16 * 16, 0x80);
  return buildPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R /Lang (fr) >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
      { dict: "", data: "q 451 0 0 698 72 72 cm /Im1 Do Q" },
      { dict: "/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode", data: deflateSync(pixels) },
      "<< /Title (Numerisation) /Producer (ultra11y test fixture) >>",
    ],
    { version: "1.4", info: 6 },
  );
}

const FIXTURES = {
  "tagged-ua1.pdf": () => taggedPdf(),
  "untagged.pdf": () => untaggedPdf(),
  "no-lang.pdf": () => taggedPdf({ lang: "" }),
  "image-only.pdf": () => imageOnlyPdf(),
  "shallow.pdf": () => taggedPdf({ headings: false, th: false }),
  "no-display-title.pdf": () => taggedPdf({ displayDocTitle: false }),
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [name, make] of Object.entries(FIXTURES)) {
    writeFileSync(join(here, name), make());
    console.log(`wrote tests/fixtures/pdf/${name}`);
  }
  try {
    execFileSync("qpdf", ["--object-streams=generate", "--deterministic-id", join(here, "tagged-ua1.pdf"), join(here, "objstm.pdf")]);
    console.log("wrote tests/fixtures/pdf/objstm.pdf (qpdf)");
    execFileSync("qpdf", ["--encrypt", "", "owner", "256", "--", join(here, "untagged.pdf"), join(here, "encrypted.pdf")]);
    console.log("wrote tests/fixtures/pdf/encrypted.pdf (qpdf)");
  } catch (e) {
    console.error(`qpdf unavailable — objstm.pdf / encrypted.pdf left as committed (${e instanceof Error ? e.message : e})`);
  }
}
