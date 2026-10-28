// Theme 5 — Data tables (+ layout-table heuristic to avoid false positives).
import type { Doc, El } from "../parse/html.js";
import { attr, hasAttr, hasBoundAttr, descendants, ancestors, visibleText, textContent } from "../parse/html.js";
import { mayInjectContent, isHiddenFromAT } from "../name.js";
import type { Rule, RuleFinding } from "./rule.js";

const declaredLayout = (t: El): boolean => ["presentation", "none"].includes((attr(t, "role") ?? "").trim());
const named = (t: El): boolean => !!(attr(t, "aria-label") ?? "").trim() || hasAttr(t, "aria-labelledby");

// Heuristic: treat a table as LAYOUT (skip data-table rules) when it declares
// role=presentation/none, OR nests another table (data tables don't nest), OR is
// a trivial single-row table with no <th>/<caption>. Cuts the classic
// table-based-layout false positive without missing real data tables.
function isLayoutTable(t: El): boolean {
  if (declaredLayout(t)) return true;
  const desc = descendants(t);
  if (desc.some((d) => d.tag === "table")) return true;
  const hasTh = desc.some((d) => d.tag === "th");
  const hasCaption = t.children.some((c) => c.type === "element" && c.tag === "caption");
  const rows = desc.filter((d) => d.tag === "tr").length;
  return !hasTh && !hasCaption && rows <= 1;
}

const dataTableNoHeaders: Rule = {
  id: "data-table-no-headers",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const t of doc.elements) {
      if (t.tag !== "table" || isLayoutTable(t)) continue;
      const desc = descendants(t);
      // No statically-visible rows/cells means the body is injected dynamically
      // ({children}/slot — e.g. a generic <table> wrapper component) or simply absent;
      // we cannot tell whether headers exist, so we do not assert a definite NC.
      if (!desc.some((d) => d.tag === "tr" || d.tag === "td" || d.tag === "th")) continue;
      const ths = desc.filter((d) => d.tag === "th");
      const hasTh = ths.length > 0;
      // hasBoundAttr also matches a dynamic :scope / v-bind:scope binding (Vue/Svelte).
      const hasAssoc = desc.some((d) => (d.tag === "td" || d.tag === "th") && (hasBoundAttr(d, "scope") || hasBoundAttr(d, "headers")));
      // Implicit scope per HTML's header-association algorithm (WCAG technique H51): a simple
      // table needs no explicit scope= when its headers sit in <thead>, OR form one complete
      // header ROW (column headers), OR are the first cell of every row (row headers).
      // (Order-independent: descendants() is not in document order.)
      const rows = desc.filter((d) => d.tag === "tr");
      const cellsOf = (tr: El): El[] => tr.children.filter((c): c is El => c.type === "element" && (c.tag === "th" || c.tag === "td"));
      const allThInThead = hasTh && ths.every((th) => ancestors(th).some((a) => a.tag === "thead"));
      const headerRow = rows.find((r) => {
        const cells = cellsOf(r);
        return cells.length > 0 && cells.every((c) => c.tag === "th");
      });
      const allThInHeaderRow = hasTh && headerRow !== undefined && ths.every((th) => cellsOf(headerRow).includes(th));
      const allThFirstCol =
        hasTh &&
        ths.every((th) => {
          const tr = ancestors(th).find((a) => a.tag === "tr");
          return tr !== undefined && cellsOf(tr)[0] === th;
        });
      if (hasTh && (hasAssoc || allThInThead || allThInHeaderRow || allThFirstCol)) continue;
      if (!hasTh) {
        out.push({
          criteriaId: "1.3.1",
          el: t,
          msgId: "data-table-no-headers.no-th",
        });
      } else if (!hasAssoc) {
        out.push({
          criteriaId: "1.3.1",
          el: t,
          msgId: "data-table-no-headers.no-assoc",
        });
      }
    }
    return out;
  },
};

const tableCaptionMissing: Rule = {
  id: "table-caption-missing",
  criteria: ["1.3.1"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const t of doc.elements) {
      if (t.tag !== "table" || isLayoutTable(t)) continue;
      const hasCaption = t.children.some((c) => c.type === "element" && c.tag === "caption");
      if (hasCaption || named(t)) continue;
      out.push({
        criteriaId: "1.3.1",
        el: t,
        msgId: "table-caption-missing",
      });
    }
    return out;
  },
};

const layoutTableDataMarkup: Rule = {
  id: "layout-table-data-markup",
  criteria: ["1.3.1"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const t of doc.elements) {
      if (t.tag !== "table" || !declaredLayout(t)) continue;
      const desc = descendants(t);
      const dataMarkup =
        desc.some((d) => d.tag === "th") ||
        t.children.some((c) => c.type === "element" && c.tag === "caption") ||
        desc.some((d) => hasAttr(d, "scope") || hasAttr(d, "headers"));
      if (!dataMarkup) continue;
      out.push({
        criteriaId: "1.3.1",
        el: t,
        msgId: "layout-table-data-markup",
        params: { role: attr(t, "role") ?? "" },
      });
    }
    return out;
  },
};

// A sortable column header that doesn't expose its sort state. When a <th>
// (or role=columnheader) contains a real sort control (button/link) AND signals
// sorting (a sort/tri class or label) but carries no aria-sort, AT cannot restitute
// the current sort order (WCAG 1.3.1). Layout tables are skipped.
const SORT_SIGNAL = /sort|trier|tri\b/i;
const isSortControl = (e: El): boolean => e.tag === "button" || (e.tag === "a" && hasAttr(e, "href")) || (attr(e, "role") ?? "").trim() === "button";
const signalsSort = (e: El): boolean => SORT_SIGNAL.test(`${attr(e, "class") ?? ""} ${attr(e, "aria-label") ?? ""}`) || hasAttr(e, "data-sort");

const sortableHeaderNoAriaSort: Rule = {
  id: "sortable-header-no-aria-sort",
  criteria: ["1.3.1"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const isHeader = el.tag === "th" || (attr(el, "role") ?? "").trim() === "columnheader";
      if (!isHeader) continue;
      if (hasAttr(el, "aria-sort")) continue; // already declares sort state (any value)
      const table = ancestors(el).find((a) => a.tag === "table");
      if (table && isLayoutTable(table)) continue;
      const desc = descendants(el);
      if (!isSortControl(el) && !desc.some(isSortControl)) continue; // no actual sort control
      if (!signalsSort(el) && !desc.some(signalsSort)) continue; // nothing marks it as sortable
      out.push({
        criteriaId: "1.3.1",
        el,
        msgId: "sortable-header-no-aria-sort",
      });
    }
    return out;
  },
};

// ADVISORY (auditor recommendation, never an NC): an empty data cell — or one reduced to
// a lone "-" — is announced as "blank" by screen readers. The recommendation is to add
// sr-only text stating the absence of a value. Conservative: only bare <td>s in a data
// table with no name, no element children, and no injected content.
const tableEmptyDataCell: Rule = {
  id: "table-empty-data-cell",
  criteria: ["1.3.1"],
  severity: "mineur",
  advisory: true,
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const t of doc.elements) {
      if (t.tag !== "table" || isLayoutTable(t)) continue;
      for (const cell of descendants(t)) {
        if (cell.tag !== "td") continue;
        if (mayInjectContent(cell)) continue; // value supplied via slot/component/{expr}
        if (cell.children.some((c) => c.type === "element")) continue; // holds an icon/img/control — not blank
        if ((attr(cell, "aria-label") ?? "").trim() || hasAttr(cell, "aria-labelledby")) continue; // named another way
        const txt = visibleText(cell);
        if (txt !== "" && txt !== "-") continue;
        out.push({ criteriaId: "1.3.1", el: cell, msgId: "table-empty-data-cell", advisory: true });
      }
    }
    return out;
  },
};

/** The <table> a cell belongs to (nearest table ancestor), or undefined. */
function ownerTable(el: El): El | undefined {
  return ancestors(el).find((a) => a.tag === "table");
}

// A `headers` attribute pointing at ids that are not header cells OF THE SAME TABLE builds
// no association at all: the screen reader announces the cell with no header context, which
// is exactly the situation `headers` was added to prevent.
const headersAttrDangling: Rule = {
  id: "headers-attr-dangling",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "td" && el.tag !== "th") continue;
      const raw = (attr(el, "headers") ?? "").trim();
      if (!raw || raw.includes("{")) continue;
      const table = ownerTable(el);
      if (!table) continue;
      const inTable = new Map(
        descendants(table)
          .filter((d) => d.tag === "th" || d.tag === "td")
          .map((d) => [attr(d, "id") ?? "", d]),
      );
      const bad = raw
        .split(/\s+/)
        .filter(Boolean)
        .filter((id) => {
          const target = inTable.get(id);
          return !target || target === el; // absent from this table, or the cell itself
        });
      if (!bad.length) continue;
      out.push({ criteriaId: "1.3.1", el, msgId: "headers-attr-dangling", params: { ids: bad.join(" ") } });
    }
    return out;
  },
};

/** A literal invalid `scope` can never establish the association RGAA 5.7 requires. Dynamic
 * bindings stay undecided. */
const tableScopeInvalid: Rule = {
  id: "table-scope-invalid",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "th") continue;
      const scope = attr(el, "scope");
      if (scope === undefined || scope.includes("{") || ["row", "col", "rowgroup", "colgroup"].includes(scope.trim().toLowerCase())) continue;
      out.push({ criteriaId: "1.3.1", el, msgId: "table-scope-invalid", params: { scope } });
    }
    return out;
  },
};

// ---- a simple-grid table model -----------------------------------------------------------
//
// Decides the header-assignment question only for the tables where the HTML algorithm has a
// single, obvious answer: every cell spans one row and one column, the leading rows are made
// of header cells only, and nothing in the table is injected or templated. A column header
// in such a row heads every later cell in its column, unless that cell carries an explicit
// `headers` list (which REPLACES the implicit assignment). Anything outside that shape
// returns no grid, and the rule stays silent.
interface GridCell {
  el: El;
  header: boolean;
  headers?: string[]; // explicit `headers` id list, when present
}
type Grid = GridCell[][] | undefined;

const TEMPLATE_MARKER = /\{\{|\{%|<%|\$\{/;

function elementChildren(el: El): El[] {
  return el.children.filter((c): c is El => c.type === "element");
}

/** The rows of a `<table>` in source order, as cells — or undefined when the table is not a
 *  simple grid this model can read. */
function htmlTableGrid(table: El): Grid {
  if (mayInjectContent(table) || TEMPLATE_MARKER.test(textContent(table))) return undefined;
  const rows: El[] = [];
  for (const child of elementChildren(table)) {
    if (child.tag === "tr") rows.push(child);
    else if (["thead", "tbody", "tfoot"].includes(child.tag)) {
      for (const r of elementChildren(child)) {
        if (r.tag !== "tr") return undefined;
        rows.push(r);
      }
    } else if (!["caption", "colgroup"].includes(child.tag)) return undefined;
  }
  // A <tfoot> written before the body still renders last; keep the model honest by refusing.
  if (elementChildren(table).some((c, i, all) => c.tag === "tfoot" && i < all.length - 1)) return undefined;
  const grid: GridCell[][] = [];
  // An explicit role that re-maps a row or cell (`<th role="cell">`) changes the table the
  // accessibility tree exposes — not this model's shape.
  const NATIVE_ROLE_OK: Record<string, string[]> = { tr: ["row"], th: ["columnheader"], td: ["cell", "gridcell"] };
  const remapped = (el: El): boolean => {
    const role = (attr(el, "role") ?? "").trim().toLowerCase();
    return role !== "" && !(NATIVE_ROLE_OK[el.tag] ?? []).includes(role);
  };
  for (const r of rows) {
    if (remapped(r)) return undefined;
    const cells: GridCell[] = [];
    for (const c of elementChildren(r)) {
      if ((c.tag !== "td" && c.tag !== "th") || remapped(c)) return undefined;
      for (const span of ["colspan", "rowspan"]) {
        const v = attr(c, span);
        if (v !== undefined && v.trim() !== "1") return undefined;
      }
      const headers = attr(c, "headers");
      if (headers?.includes("{")) return undefined;
      const scope = (attr(c, "scope") ?? "").trim().toLowerCase();
      if (c.tag === "th" && scope !== "" && scope !== "col") return undefined; // row/group scopes: not this model
      cells.push({ el: c, header: c.tag === "th", ...(headers !== undefined ? { headers: headers.split(/\s+/).filter(Boolean) } : {}) });
    }
    grid.push(cells);
  }
  return grid;
}

/** The same grid read from ARIA roles: role=row children with cell roles. */
function ariaGrid(grid: El): Grid {
  if (mayInjectContent(grid) || TEMPLATE_MARKER.test(textContent(grid)) || hasAttr(grid, "aria-owns")) return undefined;
  const rows: El[] = [];
  for (const child of elementChildren(grid)) {
    const role = (attr(child, "role") ?? "").trim().toLowerCase();
    if (role === "row") rows.push(child);
    else if (role === "rowgroup") {
      for (const r of elementChildren(child)) {
        if ((attr(r, "role") ?? "").trim().toLowerCase() !== "row") return undefined;
        rows.push(r);
      }
    } else return undefined;
  }
  const out: GridCell[][] = [];
  for (const r of rows) {
    const cells: GridCell[] = [];
    for (const c of elementChildren(r)) {
      const role = (attr(c, "role") ?? "").trim().toLowerCase();
      if (!["columnheader", "gridcell", "cell", "rowheader"].includes(role)) return undefined;
      if (hasAttr(c, "aria-colspan") || hasAttr(c, "aria-rowspan") || hasAttr(c, "aria-colindex")) return undefined;
      if (role === "rowheader") return undefined;
      cells.push({ el: c, header: role === "columnheader" });
    }
    out.push(cells);
  }
  return out;
}

/** Column headers (in the leading all-header rows) that no later cell of their column is
 *  assigned to. */
function unassignedColumnHeaders(grid: Grid): El[] {
  if (!grid || grid.length < 2) return [];
  let headRows = 0;
  while (headRows < grid.length && grid[headRows]!.length > 0 && grid[headRows]!.every((c) => c.header)) headRows++;
  if (headRows === 0 || headRows === grid.length) return [];
  const out: El[] = [];
  // Explicit `headers` lists assign a header to a cell wherever that cell sits.
  const referenced = new Set(grid.flat().flatMap((c) => c.headers ?? []));
  for (let h = 0; h < headRows; h++) {
    grid[h]!.forEach((header, col) => {
      if (isHiddenFromAT(header.el) || !visibleText(header.el).trim()) return; // empty/hidden: other rules own it
      const id = (attr(header.el, "id") ?? "").trim();
      if (id && referenced.has(id)) return;
      // implicitly: a later cell in the same column that carries no `headers` list of its own
      const assigned = grid.slice(headRows).some((row) => row[col] !== undefined && row[col]!.headers === undefined);
      if (!assigned) out.push(header.el);
    });
  }
  return out;
}

// A header cell that heads NOTHING — no data cell resolves to it, by scope or by `headers`.
// It is announced as a header for an empty set, and the columns it looks like it covers are
// in fact unheaded.
const thNoDataCells: Rule = {
  id: "th-no-data-cells",
  criteria: ["1.3.1"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const table of doc.elements) {
      if (table.tag !== "table" || isLayoutTable(table)) continue;
      const cells = descendants(table).filter((d) => d.tag === "td" || d.tag === "th");
      const headers = cells.filter((c) => c.tag === "th");
      if (!headers.length) continue;
      const dataCells = cells.filter((c) => c.tag === "td");
      // A table with no data cells at all is a heading-only skeleton — nothing to assign,
      // and data-table-no-headers already owns that shape.
      if (!dataCells.length) continue;
      // Only a FULLY headers-wired table can be judged by references alone: as soon as one
      // data cell relies on implicit row/column position, an unreferenced header may still
      // head it — which the simple-grid model below decides when the table allows it.
      if (!dataCells.every((c) => (attr(c, "headers") ?? "").trim() !== "")) {
        if (doc.kind === "html")
          for (const th of unassignedColumnHeaders(htmlTableGrid(table))) out.push({ criteriaId: "1.3.1", el: th, msgId: "th-no-data-cells" });
        continue;
      }
      const referenced = new Set(dataCells.flatMap((c) => (attr(c, "headers") ?? "").split(/\s+/).filter(Boolean)));
      for (const th of headers) {
        if (mayInjectContent(th) || !visibleText(th).trim()) continue; // empty/injected: other rules own it
        const id = attr(th, "id") ?? "";
        if (id && referenced.has(id)) continue; // explicitly referenced by a data cell
        out.push({ criteriaId: "1.3.1", el: th, msgId: "th-no-data-cells" });
      }
    }
    // The same question for an ARIA grid/table built from role=row / columnheader / gridcell.
    if (doc.kind === "html") {
      for (const grid of doc.elements) {
        const role = (attr(grid, "role") ?? "").trim().toLowerCase();
        if (!["grid", "table", "treegrid"].includes(role) || grid.tag === "table" || isHiddenFromAT(grid)) continue;
        for (const th of unassignedColumnHeaders(ariaGrid(grid))) out.push({ criteriaId: "1.3.1", el: th, msgId: "th-no-data-cells" });
      }
    }
    return out;
  },
};

export const tablesRules: Rule[] = [
  dataTableNoHeaders,
  tableCaptionMissing,
  layoutTableDataMarkup,
  sortableHeaderNoAriaSort,
  tableEmptyDataCell,
  headersAttrDangling,
  tableScopeInvalid,
  thNoDataCells,
];
