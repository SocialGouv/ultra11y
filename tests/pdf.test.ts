// THE PDF READER AND THE DOCUMENT RULES (issue #90).
//
// ultra11y could not open a PDF, so RGAA 13.3 (« chaque document bureautique en téléchargement
// possède-t-il, si nécessaire, une version accessible ? ») reached the adjudicator with nothing
// to cite — and egapro's five untagged receipts went unseen. These tests pin the reader against
// fixtures veraPDF has ruled on (tests/fixtures/pdf/make-pdf.mjs: tagged-ua1.pdf and objstm.pdf
// PASS PDF/UA-1, the others FAIL), its robustness on garbage, and the honesty contract: a
// document's checks never decide a WCAG verdict, and an unreadable file is never « conforming ».
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { readPdf, contentOperators } from "../src/parse/pdf.js";
import { resolveRemediation } from "../src/messages.js";
import { runAudit } from "../src/audit.js";
import { derivePackResults } from "../src/standards/index.js";
import { buildAdjudicationWorklist } from "../src/adjudicate.js";
import { pdfDocFromBytes } from "../src/documents.js";
import { runRules, ruleById } from "../src/rules/registry.js";
import { groundFinding } from "../src/grounding.js";
import { renderReport } from "../src/report.js";

const FIX = join(import.meta.dirname, "fixtures", "pdf");
const bytes = (name: string): Buffer => readFileSync(join(FIX, name));
const facts = (name: string) => readPdf(bytes(name));
const fired = (name: string): string[] => runRules(pdfDocFromBytes(bytes(name), join(FIX, name))).map((f) => f.ruleId);

const root = mkdtempSync(join(tmpdir(), "u11y-pdf-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the reader establishes the document-level facts", () => {
  it("reads a tagged PDF/UA-1 file: marked, structure tree, language, title shown, text, headings, a TH", () => {
    const f = facts("tagged-ua1.pdf");
    expect(f).toMatchObject({ readable: true, version: "1.7", pages: 1, tagged: true, lang: "fr-FR", title: "Attestation de dépôt", titleSource: "info" });
    expect(f.displayDocTitle).toBe(true);
    expect(f.textOps).toBeGreaterThan(0);
    expect(f.contentScanned).toBe(true);
    expect(f.structure).toMatchObject({ headings: 1, tables: 1, tablesWithoutTh: 0 });
  });

  it("reads the same document rewritten with object streams and an xref stream (PDF 1.5+)", () => {
    const f = facts("objstm.pdf");
    expect(f.xrefStream).toBe(true);
    expect(f.objectStreams).toBe(true);
    const { xrefStream: _x, objectStreams: _o, ...rest } = f;
    const { xrefStream: _x2, objectStreams: _o2, ...plain } = facts("tagged-ua1.pdf");
    expect(rest).toEqual(plain);
  });

  it("reads what a generator with no accessibility support writes (react-pdf's shape): PDF 1.3, untagged, no language, no title", () => {
    const f = facts("untagged.pdf");
    expect(f).toMatchObject({ readable: true, version: "1.3", tagged: false, marked: false, structTree: false });
    expect(f.lang).toBeUndefined();
    expect(f.title).toBeUndefined();
    expect(f.textOps).toBeGreaterThan(0);
  });

  it("sees an image-only page: an image drawn, no font, no text operator", () => {
    const f = facts("image-only.pdf");
    expect(f).toMatchObject({ readable: true, fonts: 0, textOps: 0, images: 1, contentScanned: true });
  });

  it("reports an encrypted file UNREADABLE — never guesses at ciphertext", () => {
    const f = facts("encrypted.pdf");
    expect(f.readable).toBe(false);
    expect(f.unreadable).toBe("encrypted");
  });

  it("falls back to the XMP dc:title when the Info dictionary carries none", () => {
    const src = bytes("tagged-ua1.pdf")
      .toString("latin1")
      .replace(/\/Title <feff[0-9a-f]+>/, "");
    // Offsets shift, so the reader has to repair the xref as well — two recoveries at once.
    const f = readPdf(Buffer.from(src, "latin1"));
    expect(f.readable).toBe(true);
    expect(f.repaired).toBe(true);
    expect(f.title).toBe("Attestation de dépôt");
    expect(f.titleSource).toBe("xmp");
  });

  it("does not count a `Tj` sitting inside a string or inline image data as a text operator", () => {
    expect(contentOperators(Buffer.from("q (not a Tj) pop Q")).text).toBe(0);
    expect(contentOperators(Buffer.from("BI /W 2 /H 1 /CS /G /BPC 8 ID \x00Tj\x00 EI Q")).text).toBe(0);
    expect(contentOperators(Buffer.from("BT /F1 12 Tf (a) Tj [(b) 3 (c)] TJ ET")).text).toBe(2);
  });
});

describe("the remediation of an untagged PDF", () => {
  it("recommends PDFKit with the options PDF/UA needs, and says what it cannot tag", () => {
    for (const lang of ["fr", "en"] as const) {
      const text = resolveRemediation({ remediation: "", msg: { id: "pdf-untagged" } }, lang);
      expect(text).toContain("https://github.com/foliojs/pdfkit");
      expect(text).toContain("subset: 'PDF/UA'");
      expect(text).toContain("tagged: true");
      expect(text).toMatch(/annotations/);
    }
  });
});

describe("the reader never throws, whatever it is handed", () => {
  // A seeded generator, so a failure is reproducible.
  let seed = 0x9e3779b9;
  const rand = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };

  it("garbage: random bytes, with and without a PDF header", () => {
    for (let i = 0; i < 200; i++) {
      const buf = Buffer.alloc(Math.floor(rand() * 4096));
      for (let k = 0; k < buf.length; k++) buf[k] = Math.floor(rand() * 256);
      const withHeader = Buffer.concat([Buffer.from("%PDF-1.4\n"), buf]);
      for (const b of [buf, withHeader]) {
        const f = readPdf(b);
        expect(typeof f.readable).toBe("boolean");
        if (!f.readable) expect(f.unreadable).toBeTruthy();
      }
    }
  });

  it("every truncation of every fixture: readable or unreadable, and never a tagged verdict out of nothing", () => {
    for (const name of ["tagged-ua1.pdf", "objstm.pdf", "untagged.pdf", "image-only.pdf"]) {
      const full = bytes(name);
      for (let cut = 0; cut < full.length; cut += Math.max(1, Math.floor(full.length / 97))) {
        const f = readPdf(full.subarray(0, cut));
        if (!f.readable) expect(f.unreadable).toBeTruthy();
        // A truncated untagged file can never come back tagged.
        if (name === "untagged.pdf" || name === "image-only.pdf") expect(f.tagged).toBe(false);
      }
    }
  });

  it("flipped bytes in the middle of a file", () => {
    const full = bytes("tagged-ua1.pdf");
    for (let i = 0; i < 300; i++) {
      const b = Buffer.from(full);
      for (let k = 0; k < 8; k++) b[Math.floor(rand() * b.length)] = Math.floor(rand() * 256);
      const f = readPdf(b);
      expect(typeof f.readable).toBe("boolean");
    }
  });

  it("a file with no header is not a PDF; a header with nothing after it is unreadable", () => {
    expect(readPdf(Buffer.from("<html>Impossible de générer le PDF</html>")).unreadable).toBe("not-pdf");
    expect(readPdf(Buffer.from("%PDF-1.7\n")).readable).toBe(false);
  });

  // A hostile file must cost bounded work: a self-referential ARRAY in the structure tree used to
  // loop for ever (only dictionaries were remembered), and a decompression bomb used to expand in
  // full before any budget was checked — an abort no catch can intercept.
  const wrap = (objects: string[], extra = ""): Buffer =>
    Buffer.concat([
      Buffer.from(`%PDF-1.4\n${objects.map((o, i) => `${i + 1} 0 obj ${o} endobj\n`).join("")}`, "latin1"),
      Buffer.from(extra, "latin1"),
      Buffer.from("trailer << /Root 1 0 R >>\n%%EOF", "latin1"),
    ]);

  it("a self-referential array under /StructTreeRoot /K terminates", () => {
    const f = readPdf(
      wrap([
        "<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 3 0 R >>",
        "<< /Type /Pages /Kids [] /Count 0 >>",
        "<< /Type /StructTreeRoot /K 4 0 R >>",
        "[4 0 R]",
      ]),
    );
    expect(f.readable).toBe(true);
    expect(f.structure?.elements).toBe(0);
  });

  it("a RunLengthDecode bomb is refused within budget, not expanded until the heap gives out", () => {
    // Each 2-byte run (129, v) expands to 128 bytes: 2 MiB in, 128 MiB out — over the per-stream cap.
    const bomb = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < bomb.length; i += 2) bomb[i] = 129;
    const head =
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n";
    const pdf = Buffer.concat([
      Buffer.from(`${head}4 0 obj << /Filter /RunLengthDecode /Length ${bomb.length} >>\nstream\n`, "latin1"),
      bomb,
      Buffer.from("\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF", "latin1"),
    ]);
    const f = readPdf(pdf);
    // A budget overrun ends the read (#113): skipping the page would re-run the bomb on the next.
    expect(f).toMatchObject({ readable: false, unreadable: "too-large", contentScanned: false });
  });

  it("a FlateDecode bomb is refused within budget", async () => {
    const { deflateSync } = await import("node:zlib");
    const bomb = deflateSync(Buffer.alloc(80 * 1024 * 1024));
    const head =
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n";
    const pdf = Buffer.concat([
      Buffer.from(`${head}4 0 obj << /Filter /FlateDecode /Length ${bomb.length} >>\nstream\n`, "latin1"),
      bomb,
      Buffer.from("\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF", "latin1"),
    ]);
    const f = readPdf(pdf);
    expect(f).toMatchObject({ readable: false, unreadable: "too-large", contentScanned: false });
  });

  it("a reference cycle in the page tree and the structure tree terminates", () => {
    const cyc = Buffer.from(
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 3 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [2 0 R] /Count 1 >> endobj\n3 0 obj << /Type /StructTreeRoot /K 4 0 R >> endobj\n4 0 obj << /S /P /K [4 0 R 3 0 R] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF",
      "latin1",
    );
    const f = readPdf(cyc);
    expect(f.readable).toBe(true);
    expect(f.tagged).toBe(true);
    expect(f.structure?.elements).toBe(1);
  });
});

describe("the document rules", () => {
  it("raise nothing on the file veraPDF passes", () => {
    expect(fired("tagged-ua1.pdf")).toEqual([]);
    expect(fired("objstm.pdf")).toEqual([]);
  });

  it("flag the untagged, unlabelled receipt three ways", () => {
    expect(fired("untagged.pdf").sort()).toEqual(["pdf-lang-missing", "pdf-title-missing", "pdf-untagged"]);
  });

  it("flag a missing language, and a title the viewer is never told to show", () => {
    expect(fired("no-lang.pdf")).toEqual(["pdf-lang-missing"]);
    const doc = pdfDocFromBytes(bytes("no-display-title.pdf"), "x.pdf");
    const [f] = runRules(doc);
    expect(f?.ruleId).toBe("pdf-title-missing");
    expect(f?.msg?.params?.titleState).toBe("not-displayed");
    expect(f?.severity).toBe("mineur");
  });

  it("flag an image-only scan, which has no text to read at all", () => {
    expect(fired("image-only.pdf")).toEqual(expect.arrayContaining(["pdf-no-text", "pdf-untagged"]));
    expect(fired("image-only.pdf")).not.toContain("pdf-lang-missing");
  });

  it("recommend — never require — headings and table headers in a tagged file", () => {
    const doc = pdfDocFromBytes(bytes("shallow.pdf"), "x.pdf");
    const fs = runRules(doc);
    expect(fs.map((f) => f.ruleId)).toEqual(["pdf-structure-shallow", "pdf-structure-shallow"]);
    expect(fs.every((f) => f.advisory)).toBe(true);
    expect(ruleById("pdf-structure-shallow")?.advisory).toBe(true);
  });

  it("say nothing about a file they could not read", () => {
    expect(fired("encrypted.pdf")).toEqual([]);
  });

  it("never run on markup, and markup rules never run on a document", () => {
    const html = runRules(pdfDocFromBytes(Buffer.from("%PDF-1.4\n"), "x.pdf"));
    expect(html.every((f) => f.ruleId.startsWith("pdf-"))).toBe(true);
  });

  it("anchor at the file's header line, which grounding finds when it re-opens the PDF", () => {
    const file = join(FIX, "untagged.pdf");
    const [f] = runRules(pdfDocFromBytes(bytes("untagged.pdf"), file));
    expect(f?.line).toBe(1);
    expect(f?.snippet).toBe("%PDF-1.3");
    expect(groundFinding({ file, line: f!.line, snippet: f!.snippet }).ok).toBe(true);
  });
});

describe("audit: a PDF is an input, and its checks stay out of the WCAG verdict", () => {
  const all = runAudit({ inputs: [join(FIX, "*.pdf")] });

  it("audits PDF inputs named by a glob", () => {
    expect(all.documents?.map((d) => d.file.split("/").pop()).sort()).toEqual([
      "encrypted.pdf",
      "image-only.pdf",
      "no-display-title.pdf",
      "no-lang.pdf",
      "objstm.pdf",
      "shallow.pdf",
      "tagged-ua1.pdf",
      "untagged.pdf",
    ]);
    expect(all.scope.files).toBe(8);
  });

  it("lists each document with the outcome of every check — « not detected », never « pass »", () => {
    const ua = all.documents!.find((d) => d.file.endsWith("tagged-ua1.pdf"))!;
    expect(Object.values(ua.checks).every((c) => c === "not-detected")).toBe(true);
    const un = all.documents!.find((d) => d.file.endsWith("untagged.pdf"))!;
    expect(un.checks).toMatchObject({ "pdf-untagged": "fail", "pdf-lang-missing": "fail", "pdf-title-missing": "fail", "pdf-no-text": "not-detected" });
    // No structure tree to walk: the shallow-structure check could not run.
    expect(un.checks["pdf-structure-shallow"]).toBe("not-checked");
  });

  it("reports an encrypted file as unreadable, with every check « not checked »", () => {
    const enc = all.documents!.find((d) => d.file.endsWith("encrypted.pdf"))!;
    expect(enc.readable).toBe(false);
    expect(enc.unreadable).toBe("encrypted");
    expect(Object.values(enc.checks).every((c) => c === "not-checked")).toBe(true);
  });

  it("keeps document findings out of `findings` and `criteria`, so no WCAG criterion is decided by them", () => {
    expect(all.documentFindings?.length).toBeGreaterThan(0);
    expect(all.findings).toEqual([]);
    expect(all.criteria.every((c) => c.findings.length === 0)).toBe(true);
    // A PDF-only scope earns no conformity either: the static criteria have no page to apply to.
    expect(all.criteria.filter((c) => c.status === "C" && !c.inapplicable)).toEqual([]);
  });

  it("records that a downloadable document exists, so 13.3 can never close for want of one", () => {
    expect(all.scope.subjectsSeen).toContain("downloadDocs");
  });

  it("de-duplicates identical files like any other input", () => {
    const dir = join(root, "dup");
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(FIX, "untagged.pdf"), join(dir, "a.pdf"));
    copyFileSync(join(FIX, "untagged.pdf"), join(dir, "b.pdf"));
    const r = runAudit({ inputs: [join(dir, "a.pdf"), join(dir, "b.pdf")] });
    expect(r.documents).toHaveLength(1);
    expect(r.scope.dedup?.duplicateFiles).toBe(1);
  });

  it("never walks a directory into the PDFs it happens to hold — a PDF is audited when asked for", () => {
    const r = runAudit({ inputs: [FIX] });
    expect(r.documents ?? []).toEqual([]);
  });
});

describe("the RGAA projection: every document finding is CANDIDATE evidence for 13.3", () => {
  const page = join(root, "page.html");
  writeFileSync(
    page,
    `<!doctype html><html lang="fr"><head><title>Déclaration</title></head><body><main><h1>Déclaration</h1><p><a href="untagged.pdf">Télécharger le récépissé (PDF, 1 Ko)</a></p></main></body></html>`,
  );
  const pdf = join(root, "untagged.pdf");
  copyFileSync(join(FIX, "untagged.pdf"), pdf);
  const audit = runAudit({ inputs: [page, pdf] });
  const rows = derivePackResults(audit, "rgaa");
  const row = (id: string) => rows.find((r) => r.id === id)!;

  it("routes all three of the receipt's failures onto 13.3 — the title one included, though 13.3 does not map 2.4.2", () => {
    const ids = (row("13.3").candidateFindings ?? []).map((f) => f.ruleId).sort();
    expect(ids).toEqual(["pdf-lang-missing", "pdf-title-missing", "pdf-untagged"]);
  });

  it("leaves 13.3 to the adjudicator: candidate evidence never makes it non-conformant, and nothing makes it conformant", () => {
    expect(row("13.3").status).toBe("manual");
  });

  it("does not leak the document's language or title onto the PAGE's criteria (8.3, 8.5)", () => {
    expect(row("8.3").status).toBe("C");
    expect(row("8.5").status).toBe("C");
    for (const id of ["8.3", "8.5", "8.6", "1.1", "9.1"]) {
      const r = row(id);
      expect(
        [...(r.findings ?? []), ...(r.candidateFindings ?? [])].some((f) => f.ruleId.startsWith("pdf-")),
        id,
      ).toBe(false);
    }
  });

  it("hands the 13.3 brief the document with its checks, citable at the file's header", () => {
    const items = buildAdjudicationWorklist(audit, { standard: "rgaa" });
    const item = items.find((i) => i.criteriaId === "13.3");
    expect(item).toBeDefined();
    const ev = item!.evidence.find((e) => e.file === pdf && e.note?.includes("downloadable PDF document"));
    expect(ev?.note).toContain("tagged: no");
    expect(ev?.note).toContain("language: none");
    expect(ev?.note).toContain("title: none");
    expect(ev?.note).toContain("never PDF/UA conformance");
    expect(groundFinding({ file: ev!.file, line: ev!.line, snippet: ev!.snippet }).ok).toBe(true);
  });

  it("an unreadable document reaches the brief as unreadable, to be judged by hand", () => {
    const enc = join(root, "enc.pdf");
    copyFileSync(join(FIX, "encrypted.pdf"), enc);
    const a = runAudit({ inputs: [page, enc] });
    expect(derivePackResults(a, "rgaa").find((r) => r.id === "13.3")!.status).toBe("manual");
    const item = buildAdjudicationWorklist(a, { standard: "rgaa" }).find((i) => i.criteriaId === "13.3")!;
    expect(item.evidence.some((e) => e.note?.includes("UNREADABLE (encrypted"))).toBe(true);
  });
});

describe("the report lists each document with its checks", () => {
  it("renders a documents section — fails, « not detected », and the reminder that this is not PDF/UA conformance", () => {
    const a = runAudit({ inputs: [join(FIX, "untagged.pdf"), join(FIX, "tagged-ua1.pdf"), join(FIX, "encrypted.pdf")] });
    for (const lang of ["fr", "en"] as const) {
      const md = renderReport(a, lang);
      expect(md).toContain('<a id="documents"></a>');
      expect(md).toContain("untagged.pdf");
      expect(md).toContain("tagged-ua1.pdf");
      expect(md).toContain(lang === "fr" ? "illisible" : "unreadable");
      expect(md).toContain("veraPDF");
    }
  });
});

// Issue #113: text detection is only « complete » when every reference it followed resolved and
// every form it met was opened; a decoder is bounded however it is chained; and an /Encrypt
// entry makes the file unreadable even when the dictionary it points at cannot be found.
describe("text detection never concludes « no text » from what it could not see (#113)", () => {
  type Obj = string | { dict: string; data: Buffer | string };
  /** A PDF with a CORRECT classic xref table, so a recovery scan never hides what is tested.
   *  `shift` moves one object's xref offset by a few bytes — the commonest defect in the wild. */
  const pdf = (objects: Obj[], opts: { trailer?: string; shift?: { obj: number; by: number } } = {}): Buffer => {
    const chunks: Buffer[] = [];
    let size = 0;
    const push = (b: Buffer | string): void => {
      const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
      chunks.push(buf);
      size += buf.length;
    };
    push("%PDF-1.7\n");
    const offsets: number[] = [];
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
    if (opts.shift) offsets[opts.shift.obj]! += opts.shift.by;
    const xref = size;
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (let i = 1; i <= objects.length; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${opts.trailer ?? ""} >>\nstartxref\n${xref}\n%%EOF\n`);
    return Buffer.concat(chunks);
  };
  const CATALOG = "<< /Type /Catalog /Pages 2 0 R >>";
  const ONE_PAGE = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  const page = (extra: string): string => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] ${extra} >>`;
  const TEXT = "BT /F1 12 Tf 10 10 Td (Bonjour) Tj ET";
  const noTextFired = (b: Buffer): boolean => runRules(pdfDocFromBytes(b, "x.pdf")).some((f) => f.ruleId === "pdf-no-text");

  /** Forms nested `n` deep, the innermost drawing text with a font of its own. */
  const nestedForms = (n: number): Buffer => {
    const objs: Obj[] = [CATALOG, ONE_PAGE, page("/Contents 4 0 R /Resources << /XObject << /X 5 0 R >> >>"), { dict: "", data: "/X Do" }];
    for (let k = 0; k < n; k++) {
      const num = 5 + k;
      const inner = k === n - 1;
      objs.push({
        dict: inner
          ? `/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /Font << /F1 ${num + 1} 0 R >> >>`
          : `/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /X ${num + 1} 0 R >> >>`,
        data: inner ? TEXT : "/X Do",
      });
    }
    objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    return pdf(objs);
  };

  it("controls: a text page is read, and a genuinely empty page is « complete » with no text", () => {
    const text = readPdf(pdf([CATALOG, ONE_PAGE, page("/Contents 4 0 R"), { dict: "", data: TEXT }]));
    expect(text).toMatchObject({ readable: true, repaired: false, contentScanned: true });
    expect(text.textOps).toBe(1);
    // No /Contents at all is an empty page (ISO 32000 7.7.3.3): nothing was left unseen.
    const empty = readPdf(pdf([CATALOG, ONE_PAGE, page("")]));
    expect(empty).toMatchObject({ readable: true, textOps: 0, contentScanned: true });
  });

  it("a /Contents reference to an object that does not exist leaves detection incomplete — no pdf-no-text", () => {
    const b = pdf([CATALOG, ONE_PAGE, page("/Contents 9 0 R")]);
    expect(readPdf(b)).toMatchObject({ readable: true, textOps: 0, contentScanned: false });
    expect(noTextFired(b)).toBe(false);
  });

  it("one dangling element in a /Contents array is enough to leave detection incomplete", () => {
    const b = pdf([CATALOG, ONE_PAGE, page("/Contents [4 0 R 9 0 R]"), { dict: "", data: "q Q" }]);
    expect(readPdf(b)).toMatchObject({ readable: true, textOps: 0, contentScanned: false });
    expect(noTextFired(b)).toBe(false);
  });

  it("a Form XObject whose xref offset is a few bytes off leaves detection incomplete — no pdf-no-text", () => {
    const objs: Obj[] = [
      CATALOG,
      ONE_PAGE,
      page("/Contents 4 0 R /Resources << /XObject << /Fm0 5 0 R >> >>"),
      { dict: "", data: "/Fm0 Do" },
      { dict: "/Type /XObject /Subtype /Form /BBox [0 0 1 1]", data: TEXT },
    ];
    // Sanity: with the right offset the text inside the form is found.
    expect(readPdf(pdf(objs)).textOps).toBe(1);
    const b = pdf(objs, { shift: { obj: 5, by: 3 } });
    const f = readPdf(b);
    expect(f).toMatchObject({ readable: true, repaired: false, textOps: 0, contentScanned: false });
    expect(noTextFired(b)).toBe(false);
  });

  it("a `Do` naming no XObject in the resources leaves detection incomplete", () => {
    const b = pdf([CATALOG, ONE_PAGE, page("/Contents 4 0 R /Resources << /XObject << >> >>"), { dict: "", data: "/Missing Do" }]);
    expect(readPdf(b)).toMatchObject({ readable: true, textOps: 0, contentScanned: false });
    expect(noTextFired(b)).toBe(false);
  });

  it("a page-tree /Kids entry that does not resolve leaves detection incomplete: the page it names may hold the text", () => {
    const b = pdf([CATALOG, "<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>", page("/Contents 4 0 R"), { dict: "", data: "q Q" }]);
    expect(readPdf(b)).toMatchObject({ readable: true, textOps: 0, contentScanned: false });
    expect(noTextFired(b)).toBe(false);
  });

  it("forms nested deeper than the reader opens leave detection incomplete; within the bound the text is found", () => {
    expect(readPdf(nestedForms(3))).toMatchObject({ readable: true, contentScanned: true });
    expect(readPdf(nestedForms(3)).textOps).toBe(1);
    const deep = nestedForms(8);
    expect(readPdf(deep)).toMatchObject({ readable: true, textOps: 0, contentScanned: false });
    expect(noTextFired(deep)).toBe(false);
  });

  it("text found settles the question, even when another reference on the page dangles", () => {
    const b = pdf([CATALOG, ONE_PAGE, page("/Contents 4 0 R /Resources << /XObject << /Im0 9 0 R >> >>"), { dict: "", data: `/Im0 Do ${TEXT}` }]);
    expect(readPdf(b)).toMatchObject({ readable: true, textOps: 1, contentScanned: true });
  });

  /** Wall-clock bound for the bomb cases. Each takes well under a second alone; the payloads are
   *  sized so the unfixed reader needed a minute or more, so a loaded CI machine stays far from a
   *  false failure while a regression stays far past the bound. */
  const BOUND_MS = 20_000;
  const SLOW = 30_000;
  const pagesOf = (n: number, from: number): string =>
    `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${i + from} 0 R`).join(" ")}] /Count ${n} >>`;

  /** ASCII85 (Adobe), for the decoder's round trip. */
  const a85 = (bytes: Buffer): string => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 4) {
      const chunk = Buffer.alloc(4);
      bytes.copy(chunk, 0, i, i + 4);
      const n = Math.min(4, bytes.length - i);
      let v = chunk.readUInt32BE(0);
      if (v === 0 && n === 4) {
        s += "z";
        continue;
      }
      const digits: string[] = [];
      for (let k = 0; k < 5; k++) {
        digits.unshift(String.fromCharCode(33 + (v % 85)));
        v = Math.floor(v / 85);
      }
      s += digits.slice(0, n + 1).join("");
    }
    return `${s}~>`;
  };

  it("decodes ASCII85 content (with `z` groups, a short final group and line breaks) to the text it encodes", () => {
    const content = Buffer.concat([Buffer.from(`${TEXT}\n`), Buffer.alloc(8), Buffer.from("% end")]);
    const encoded = a85(content).replace(/(.{20})/g, "$1\n");
    const f = readPdf(pdf([CATALOG, ONE_PAGE, page("/Contents 4 0 R"), { dict: "/Filter /ASCII85Decode", data: encoded }]));
    expect(f).toMatchObject({ readable: true, contentScanned: true, textOps: 1 });
  });

  it(
    "an ASCII85 bomb behind FlateDecode, shared by 50 pages, is refused once at the per-stream cap — unreadable « too-large »",
    async () => {
      const { deflateSync } = await import("node:zlib");
      // 20 MiB of `z` inflates fine (under the cap), then each `z` is four zero bytes: 80 MiB. The
      // unfixed reader built that in a number[], swallowed the error and did it again per page.
      const bomb = deflateSync(Buffer.alloc(20 * 1024 * 1024, "z"));
      expect(bomb.length).toBeLessThan(64 * 1024);
      const objs: Obj[] = [CATALOG, pagesOf(50, 4), { dict: "/Filter [/FlateDecode /ASCII85Decode]", data: bomb }];
      for (let i = 0; i < 50; i++) objs.push(page("/Contents 3 0 R"));
      const t0 = performance.now();
      const f = readPdf(pdf(objs));
      expect(performance.now() - t0).toBeLessThan(BOUND_MS);
      expect(f).toMatchObject({ readable: false, unreadable: "too-large" });
      // The per-stream cap, enforced while decoding — not the per-file total checked afterwards.
      expect(f.detail).toContain("a decoded stream exceeds");
    },
    SLOW,
  );

  it(
    "a content stream shared by many pages is decoded and scanned once, not once per page",
    async () => {
      const { deflateSync } = await import("node:zlib");
      // 8 MiB of `z` → 32 MiB of zero bytes per decode: under every cap, but 200 pages decoding it
      // anew was minutes of work and gigabytes of garbage.
      const shared = deflateSync(Buffer.alloc(8 * 1024 * 1024, "z"));
      const pages = 200;
      const objs: Obj[] = [CATALOG, pagesOf(pages, 4)];
      objs.push({ dict: "/Filter [/FlateDecode /ASCII85Decode]", data: shared });
      for (let i = 0; i < pages; i++) objs.push(page("/Contents 3 0 R"));
      const t0 = performance.now();
      const f = readPdf(pdf(objs));
      expect(performance.now() - t0).toBeLessThan(BOUND_MS);
      expect(f).toMatchObject({ readable: true, pages, textOps: 0, contentScanned: true });
    },
    SLOW,
  );

  it(
    "the same shared stream under a different /Resources on every page stops at the scan budget — incomplete, fast",
    async () => {
      const { deflateSync } = await import("node:zlib");
      // 4 MiB of `z` → 16 MiB per scan: 200 pages tokenised 3.2 GiB without the budget.
      const shared = deflateSync(Buffer.alloc(4 * 1024 * 1024, "z"));
      const pages = 200;
      const objs: Obj[] = [CATALOG, pagesOf(pages, 4)];
      objs.push({ dict: "/Filter [/FlateDecode /ASCII85Decode]", data: shared });
      for (let i = 0; i < pages; i++) objs.push(page(`/Contents 3 0 R /Resources << /ProcSet [/PDF] /N ${i} >>`));
      const t0 = performance.now();
      const f = readPdf(pdf(objs));
      expect(performance.now() - t0).toBeLessThan(BOUND_MS);
      expect(f).toMatchObject({ readable: true, pages, textOps: 0, contentScanned: false });
    },
    SLOW,
  );

  it(
    "a bomb is never swallowed as « this page could not be read »: page, form and XMP streams all make the file too-large",
    async () => {
      const { deflateSync } = await import("node:zlib");
      const bomb = deflateSync(Buffer.alloc(80 * 1024 * 1024));
      const onPage = readPdf(pdf([CATALOG, ONE_PAGE, page("/Contents 4 0 R"), { dict: "/Filter /FlateDecode", data: bomb }]));
      expect(onPage).toMatchObject({ readable: false, unreadable: "too-large" });
      const inForm = readPdf(
        pdf([
          CATALOG,
          ONE_PAGE,
          page("/Contents 4 0 R /Resources << /XObject << /X 5 0 R >> >>"),
          { dict: "", data: "/X Do" },
          { dict: "/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Filter /FlateDecode", data: bomb },
        ]),
      );
      expect(inForm).toMatchObject({ readable: false, unreadable: "too-large" });
      const inXmp = readPdf(
        pdf([
          "<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>",
          ONE_PAGE,
          page(""),
          { dict: "/Type /Metadata /Subtype /XML /Filter /FlateDecode", data: bomb },
        ]),
      );
      expect(inXmp).toMatchObject({ readable: false, unreadable: "too-large" });
    },
    SLOW,
  );

  it("an /Encrypt entry makes the file unreadable (encrypted) even when its dictionary does not resolve", () => {
    const base: Obj[] = [CATALOG, ONE_PAGE, page("/Contents 4 0 R"), { dict: "", data: TEXT }];
    expect(readPdf(pdf(base, { trailer: "/Encrypt 99 0 R" }))).toMatchObject({ readable: false, unreadable: "encrypted" });
    expect(readPdf(pdf(base, { trailer: "/Encrypt << /Filter /Standard /V 1 /R 2 >>" }))).toMatchObject({ readable: false, unreadable: "encrypted" });
    expect(noTextFired(pdf(base, { trailer: "/Encrypt 99 0 R" }))).toBe(false);
  });
});
