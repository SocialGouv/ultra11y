// The popup. It renders what the engine returned and nothing it decided itself — no
// severity logic, no criterion mapping, no verdict. Every judgement shown here was made by
// the engine or refused by its gate.

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const SEV = { bloquant: ["b", "BLOCKING"], majeur: ["m", "MAJOR"], mineur: ["n", "minor"] };

function text(el, s, cls) {
  el.textContent = s;
  el.className = cls ?? "";
}

function renderFindings(result) {
  const out = $("out");
  out.replaceChildren();
  const findings = result.findings ?? [];
  const nc = findings.filter((f) => !f.advisory);

  const h = document.createElement("p");
  h.textContent = nc.length
    ? `${nc.length} non-conformity(ies) on “${result.name}”`
    : `No non-conformity detected on “${result.name}” by the static engine.`;
  out.append(h);

  // The sentence that stops a green popup from being read as a conformant page. The engine
  // decides a handful of criteria; the rest are judgment or need a rendered check.
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "The judgment criteria are not decided here. Use “Adjudicate with AI”, or rule on them in your coding agent.";
  out.append(note);

  if (!findings.length) return;
  const ul = document.createElement("ul");
  for (const f of findings.slice(0, 80)) {
    const li = document.createElement("li");
    const [cls, label] = SEV[f.severity] ?? ["n", f.severity];
    const sev = document.createElement("span");
    sev.className = `sev ${cls}`;
    sev.textContent = f.advisory ? "reco" : label;
    li.append(sev, document.createTextNode(f.message));
    const where = f.origin?.sourceFile ?? f.file;
    if (where) {
      const code = document.createElement("code");
      code.textContent = `${where}:${f.origin?.sourceLine ?? f.line ?? 1}`;
      li.append(document.createElement("br"), code);
    }
    ul.append(li);
  }
  out.append(ul);
}

async function refresh() {
  const h = await send({ type: "health" });
  const ready = h?.ok === true;
  for (const id of ["audit", "judge", "grid"]) $(id).disabled = !ready;
  if (ready) {
    text($("status"), `Connected — ultra11y v${h.version}, standard ${h.standard}, ${h.pages} page(s) captured.`);
    $("grid").onclick = () => chrome.tabs.create({ url: `http://127.0.0.1:${h.port ?? 4111}/` });
  } else {
    // Say what to do, not merely that something failed.
    text($("status"), "No local server. Run `ultra11y dev` in your project, then reopen this popup.", "err");
  }
  return h;
}

$("audit").onclick = async () => {
  const btn = $("audit");
  btn.disabled = true;
  text($("status"), "Auditing…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await send({ type: "audit", tab: { id: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId } });
  btn.disabled = false;
  if (r?.error === "server-down") return void text($("status"), "The local server stopped. Run `ultra11y dev`.", "err");
  if (r?.error === "collect-failed") return void text($("status"), "This page could not be collected (an internal browser page cannot be scripted).", "err");
  if (r?.error) return void text($("status"), `Engine error: ${r.detail ?? r.error}`, "err");
  await refresh();
  renderFindings(r);
};

$("judge").onclick = async () => {
  const btn = $("judge");
  btn.disabled = true;
  text($("status"), "Adjudicating the judgment criteria…");
  const r = await send({ type: "judge" });
  btn.disabled = false;
  if (r?.error) return void text($("status"), r.error, "err");
  if (r.applied === false && r.issues?.length) {
    // The gate refused. Show that, rather than a number that implies the audit moved.
    text($("status"), `Adjudication refused by the gate (${r.issues.length} issue(s)) — the audit was left untouched.`, "err");
    const ul = document.createElement("ul");
    for (const i of r.issues) {
      const li = document.createElement("li");
      li.textContent = i;
      ul.append(li);
    }
    $("out").replaceChildren(ul);
    return;
  }
  text($("status"), `${r.adjudicated}/${r.total} criterion(ia) adjudicated and applied.`);
  if (r.pages?.length) {
    const ul = document.createElement("ul");
    for (const p of r.pages) {
      const li = document.createElement("li");
      li.textContent = `${p.name} — ${p.rate}%`;
      ul.append(li);
    }
    $("out").replaceChildren(ul);
  }
};

refresh();
