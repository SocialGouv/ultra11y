// LE CONTRAT « OBÉI VERBATIM » DÉCRIVAIT UN AUTRE HARNAIS.
//
// `agentContracts` émettait un seul texte : celui d'un sous-agent lancé par un outil Workflow.
// Il reçoit `ITEMS=<id,…>`, lit tout `ADJUDICATE.todo.json`, et RENVOIE un objet structuré que
// l'orchestrateur replie. Rien de tout cela n'existe sur le chemin `--eco`, qui est celui de la
// CI : l'adjudicateur y a Read/Grep/Glob/Edit/Write et pas de shell, on lui interdit d'ouvrir
// `ADJUDICATE.todo.json`, il lit un `adjudicate/<id>.md` par critère, et sa seule sortie est une
// ÉDITION de `ADJUDICATE.verdicts.json`.
//
// Émettre le contrat fan-out là et dire « obéis-y VERBATIM » — ce que faisait le prompt de
// `action.yml` — c'est donner à un petit modèle deux jeux d'instructions qui se contredisent sur
// le fichier à lire, le fichier à écrire, la sélection des items et le canal de sortie.
import { describe, expect, it } from "vitest";

import { agentContracts } from "../src/orchestrate-templates.js";

const RUN = "/w/audits";
const fanout = agentContracts(RUN, "/w/engine.mjs");
const eco = agentContracts(RUN, "/w/engine.mjs", { eco: true });

describe("the eco adjudicator contract describes the harness it actually runs in", () => {
  it("drops the fan-out apparatus: no ITEMS selection, no structured output, no orchestrator", () => {
    expect(fanout.adjudicator).toMatch(/ITEMS=/);
    expect(eco.adjudicator).not.toMatch(/ITEMS=/);
    expect(eco.adjudicator).not.toMatch(/structured output/i);
    expect(eco.adjudicator).not.toMatch(/Return ONLY/i);
  });

  it("names the split surface a shell-less adjudicator is actually given", () => {
    expect(eco.adjudicator).toContain("ADJUDICATE.verdicts.json");
    expect(eco.adjudicator).toContain("adjudicate/<criteriaId>.md");
    // …and tells it not to open the half-megabyte documents.
    expect(eco.adjudicator).toMatch(/Do NOT open `ADJUDICATE\.todo\.json`/);
  });

  it("still serves the local eco path, which DOES have a shell", () => {
    // Two shapes, one contract — dropping the shell path would break the sequential RUNBOOK.
    expect(eco.adjudicator).toMatch(/With a shell/);
    expect(eco.adjudicator).toContain("verify --apply");
  });

  it("says the caller's prompt decides between them, so it can never contradict one", () => {
    expect(eco.adjudicator).toMatch(/your prompt decides|it wins over this document/i);
  });

  it("keeps the ruling rules identical to the fan-out contract's", () => {
    for (const rule of ["citations", "normativeRef", "needs-rendered-dom", "undecidable"]) {
      expect(eco.adjudicator, rule).toContain(rule);
      expect(fanout.adjudicator, rule).toContain(rule);
    }
  });

  it("carries the absence rule and the capture rule — the two the gate refused on", () => {
    expect(eco.adjudicator).toMatch(/ABSENCE/);
    expect(eco.adjudicator).toMatch(/\.ultra11y\/pages/);
  });

  it("gives the refuter the same treatment", () => {
    expect(fanout.refuter).toMatch(/ITEMS=/);
    expect(eco.refuter).not.toMatch(/ITEMS=/);
    expect(eco.refuter).not.toMatch(/structured output/i);
    expect(eco.refuter).toContain("VERIFY.todo.json");
  });
});
