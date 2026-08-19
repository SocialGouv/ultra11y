# Fix CI rouge (job `action`) + améliorations Action/moteur — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la CI verte (job `action`) en réparant l'installation du browser tier, puis fiabiliser l'action GitHub et le moteur `scan` autour des défaillances constatées.

**Architecture:** Le job `action` prouve l'action GitHub de bout en bout sur un site servi en loopback (`127.0.0.1:8931`). Le tier navigateur doit être le **Playwright du repo** (pin pnpm-lock) pour que `scan --runtime auto/local` le résolve. Les améliorations rendent ensuite la dégradation `auto → docker` *explicite* (raison affichée) et le tier Docker capable de joindre le loopback du host.

**Tech Stack:** GitHub Actions (composite action `action.yml`), pnpm, Playwright 1.62.1, Node 22/24, TypeScript (tsup → bundle `scripts/ultra11y.mjs`).

**Spec:** Diagnostic du 2026-08-19 (cette session) — chaîne causale prouvée par repro locale (voir « Preuve » dans Tâche 1).

## Global Constraints

- Repo 100 % English dans le code/commits : commits Conventional Commits (`fix:`, `feat:`, `chore:`) — sans co-auteur, sans mention d'agent.
- Toute modification du moteur (`src/`) impose de reconstruire et committer les bundles (`pnpm run check:build` valide `scripts/ultra11y.mjs` + `skills/*/scripts/ultra11y.mjs`).
- Tests : `pnpm test` (vitest). Le plancher Node est `>=22.18` ; CI matrice 22/24.
- Un commit sans préfixe `feat:`/`fix:` = pas de release semantic-release ; le correctif CI DOIT donc utiliser `fix:`.
- Worktree isolé pour Tâches 2–4 (préférence repo) ; Tâche 1 (correctif) reste dans le dépôt principal — diff d'un seul fichier.

## Contexte : la chaîne causale (prouvée)

1. Commit `0345a9b` (« test(browser)… ») : `@playwright/test@^1.62.1` et `@axe-core/playwright@^4.13.0` deviennent **devDependencies** du repo.
2. Le job `action` installait son tier navigateur via `npm i --no-save --omit=dev @playwright/test @axe-core/playwright`. **npm applique `--omit=dev` aux specs nommées qui sont déjà déclarées en devDependencies : il n'installe rien** (« up to date », puis `npx` warn « package was not found and will be installed: playwright@1.62.1 »). Repro locale : `npm i --no-save --omit=dev @playwright/test@^1.62.1 …` → `node_modules/@playwright/test` ABSENT, y compris avec specs de version explicites.
3. `scan --runtime auto` → `localAvailable(cwd)` false (`MODULE_NOT_FOUND`) → fallback Docker silencieux.
4. Le conteneur Docker (`docker run` **sans** `--network host` ni `--add-host`, `src/scan.ts:254`) ne peut pas joindre `127.0.0.1:8931` du host → `page.goto: net::ERR_CONNECTION_REFUSED` → job rouge. Signature identique sur les runs 32242793880, 32242926267, 32244537726, 32261088392.
5. Indépendamment : le run 32243300283 est resté bloqué 3 h 27+ **sur le step d'install** (flake npm/apt sans `timeout-minutes` ; GitHub tue à 6 h).

---

### Task 1: LE CORRECTIF — le browser tier du job `action` vient du lockfile pnpm

**Files:**
- Modify: `.github/workflows/ci.yml` (job `action`, lignes ~235-346)

**Interfaces:**
- Consumes: entrées de l'action (`runtime`, `crawl`, `crawl-max`) — inchangées.
- Produces: un job `action` dont le scan utilise le tier LOCAL du repo ; plus de fallback Docker possible sur ce step.

- [x] **Step 1: Ajouter setup pnpm + node + install au job `action`** (avant le premier `uses: ./`), et `timeout-minutes` :

```yaml
  action:
    runs-on: ubuntu-latest
    # A step once hung 3h27 (flake npm/apt, GitHub's default job timeout is 6h);
    # nothing here legitimately needs more than ~10 minutes.
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      # The browser tier is the repository's own, pinned by pnpm-lock.yaml, so the scan
      # below resolves @playwright/test + @axe-core/playwright at the SAME versions whose
      # browsers `playwright install` downloads. The previous
      # `npm i --no-save --omit=dev @playwright/test @axe-core/playwright` installed
      # NOTHING once those packages became devDependencies of this repo: npm applies
      # --omit=dev to named specs already declared there ("up to date"), so `runtime:
      # auto` degraded to Docker — whose container cannot reach 127.0.0.1 on the host.
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
```

- [x] **Step 2: Réduire le step « Install the browser tier » au téléchargement du navigateur** (les packages viennent du step précédent) :

```yaml
      - name: Install the browser tier
        run: pnpm exec playwright install --with-deps chromium
```

(remplace le bloc `npm i … && npx playwright install …` et son commentaire « --omit=dev keeps npm… », devenu faux).

- [x] **Step 3: Forcer `runtime: local` sur le step de crawl** — le scan cible un loopback host ; Docker ne PEUT pas l'atteindre. `auto` ne doit pas pouvoir « dégrader » ce test vers un crash obscur ; si le tier local casse à nouveau, l'erreur doit être explicite (cf. doc `action.yml` entrée `runtime` : « Worth setting explicitly when the scan MUST have the local tier ») :

```yaml
      - name: Crawl, scan, snapshot and report page by page
        uses: ./
        with:
          paths: tests/fixtures/conforming
          standard: rgaa
          since: ""
          fail-on: ""
          sarif: "false"
          comment: "false"
          runtime: local
          crawl: http://127.0.0.1:8931/
          crawl-max: "5"
          artifact-name: action-e2e-pages
```

- [ ] **Step 4: Vérifier le YAML**

Run: `node -e 'require("js-yaml")' 2>/dev/null || npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo OK` — ou `python3 -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/ci.yml")); print("OK")'`
Expected: `OK`

- [ ] **Step 5: Preuve locale end-to-end du scan modifié** (le tree pnpm du repo = ce que la CI installera) :

```bash
mkdir -p /tmp/u11y-site && printf '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Accueil</title></head><body><main><h1>Accueil</h1><a href="/contact.html">Contact</a></main></body></html>' > /tmp/u11y-site/index.html
printf '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Contact</title></head><body><main><h1>Contact</h1><img src="a.png"></main></body></html>' > /tmp/u11y-site/contact.html
(cd /tmp/u11y-site && nohup python3 -m http.server 8931 > /dev/null 2>&1 &)
node scripts/ultra11y.mjs scan --crawl http://127.0.0.1:8931/ --runtime local --cwd "$PWD" --max 5
ls .ultra11y/pages   # attendu : accueil/ contact-html/
```

Expected: 2 pages crawlées, snapshots écrits, exit 0 — sans Docker.

- [ ] **Step 6: Commit (après validation utilisateur)**

```bash
git add .github/workflows/ci.yml
git commit -m "fix(ci): install the action job's browser tier from the lockfile, not npm --omit=dev"
```

Message long : expliquer que `npm i --omit=dev <pkg>` n'installe rien pour un pkg déjà en devDependencies, que `runtime: auto` dégradait silencieusement vers Docker (loopback injoignable), et que `runtime: local` rend toute régression explicite.

---

### Task 2: Moteur — dire POURQUOI `auto` dégrade vers Docker

**Files:**
- Modify: `src/scan-local.ts` (export `localAvailable` → scinder en `localTierStatus` + wrapper), `src/cli.ts:3243-3255`
- Test: `tests/local-runtime-availability.test.ts`

**Interfaces:**
- Produces: `export type LocalTierStatus = { ok: true } | { ok: false; reason: string }` et `export function localTierStatus(cwd: string): LocalTierStatus` ; `localAvailable(cwd)` conservé comme wrapper booléen (utilisateurs internes + tests existants).

- [ ] **Step 1: Test échouant** — raisons distinctes pour les 3 cas :

```ts
import { localAvailable, localTierStatus } from "../src/scan-local.js";

describe("localTierStatus", () => {
  it("says WHICH package failed to resolve", () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-status-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
    const s = localTierStatus(root);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toContain("@playwright/test");
  });

  it("says the browser binary is missing when packages resolve", () => {
    const s = localTierStatus(project(false)); // fixture existante
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toMatch(/playwright install|browser/i);
  });

  it("stays consistent with localAvailable", () => {
    expect(localTierStatus(project(true)).ok).toBe(localAvailable(project(true)));
    expect(localTierStatus(project(false)).ok).toBe(localAvailable(project(false)));
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/local-runtime-availability.test.ts` — Expected: FAIL (import manquant).

- [ ] **Step 3: Implémentation** dans `src/scan-local.ts` :

```ts
export type LocalTierStatus = { ok: true } | { ok: false; reason: string };

export function localTierStatus(cwd: string): LocalTierStatus {
  const req = createRequire(resolve(cwd, "package.json"));
  for (const spec of [PW_SPEC, AXE_SPEC]) {
    try { req.resolve(spec); }
    catch { return { ok: false, reason: `${spec} does not resolve from ${cwd}` }; }
  }
  try {
    const pw = req(PW_SPEC) as { chromium?: { executablePath?: () => string } };
    const bin = pw.chromium?.executablePath?.();
    if (typeof bin === "string" && bin.length > 0 && !existsSync(bin))
      return { ok: false, reason: `no browser at ${bin} — run \`npx playwright install chromium\`` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `@playwright/test failed to load: ${(e as Error).message.split("\n")[0]}` };
  }
}

export function localAvailable(cwd: string): boolean {
  return localTierStatus(cwd).ok;
}
```

Et dans `src/cli.ts` (branche `auto`), avant de basculer sur Docker :

```ts
else if (localAvailable(cwd)) useLocal = true;
else if (dockerAvailable()) {
  useLocal = false;
  const s = localTierStatus(cwd);
  console.error(
    lang === "fr"
      ? `ultra11y scan : tier local indisponible (${s.ok ? "" : s.reason}) — bascule sur Docker.`
      : `ultra11y scan: local tier unavailable${s.ok ? "" : ` (${s.reason})`} — falling back to Docker. Pass --runtime local to make this an error instead.`,
  );
}
```

- [ ] **Step 4: Run tests** — Expected: PASS (`pnpm vitest run tests/local-runtime-availability.test.ts` + suite complète).
- [ ] **Step 5: Rebuild bundles** : `pnpm run build && pnpm run check:build` (les 3 bundles committés doivent être identiques).
- [ ] **Step 6: Commit** — `fix(scan): say why the local tier was refused before degrading to Docker`

---

### Task 3: Moteur — le tier Docker doit pouvoir joindre le loopback du host

**Justification produit :** un consommateur de l'action qui scanne `http://localhost:3000` avec `runtime: docker` (ou `auto` dégradé) sur un runner Linux obtient EXACTEMENT l'erreur d'aujourd'hui : `ERR_CONNECTION_REFUSED`. Le fallback Docker n'est un fallback que s'il peut atteindre la cible.

**Files:**
- Modify: `src/scan.ts` (`runRunner`, ~l. 254) — réécriture d'URL + flags docker
- Test: `tests/scan-docker-loopback.test.ts` (nouveau)

**Interfaces:**
- Produces: `export function loopbackToHostGateway(target: string): { url: string; addHost: boolean }` — pur, testé unitairement ; utilisé par `runRunner` pour les cibles http(s).

- [ ] **Step 1: Test échouant** (fonction pure) :

```ts
import { describe, expect, it } from "vitest";
import { loopbackToHostGateway } from "../src/scan.js";

describe("loopbackToHostGateway", () => {
  it("rewrites 127.0.0.1 and localhost URLs and asks for host-gateway", () => {
    expect(loopbackToHostGateway("http://127.0.0.1:8931/")).toEqual({
      url: "http://host.docker.internal:8931/", addHost: true });
    expect(loopbackToHostGateway("http://localhost:3000/x")).toEqual({
      url: "http://host.docker.internal:3000/x", addHost: true });
  });
  it("leaves remote URLs and files untouched", () => {
    expect(loopbackToHostGateway("https://example.com/")).toEqual({ url: "https://example.com/", addHost: false });
    expect(loopbackToHostGateway("/work/input.html")).toEqual({ url: "/work/input.html", addHost: false });
  });
});
```

- [ ] **Step 2: Run** — Expected FAIL (fonction non exportée).
- [ ] **Step 3: Implémentation** dans `runRunner` :

```ts
export function loopbackToHostGateway(target: string): { url: string; addHost: boolean } {
  const m = /^http:\/\/(localhost|127(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.exec(target);
  if (!m) return { url: target, addHost: false };
  return { url: `http://host.docker.internal${m[2] ?? ""}${m[3] ?? ""}`, addHost: true };
}
```

et dans `runRunner` : pour une cible URL, `const { url, addHost } = loopbackToHostGateway(target);` ; si `addHost` ET `process.platform === "linux"`, pousser `"--add-host", "host.docker.internal:host-gateway"` (Docker Desktop macOS/Windows résout `host.docker.internal` nativement). Passer `url` au conteneur. Vérifier `docker/runner.mjs` : le crawl interne doit dériver les liens absolus depuis l'origine réécrite (pas depuis `window.location` brute) — ajuster si nécessaire côté runner (le miroir `docker-sync.test` impose de garder `docker/runner.mjs` et le source embarqué identiques).

- [ ] **Step 4: Tests** — unitaires PASS ; si Docker est dispo localement : intégration manuelle `node scripts/ultra11y.mjs scan --runtime docker http://127.0.0.1:8931/` contre le site de la Tâche 1 → attendu exit 0.
- [ ] **Step 5: Rebuild bundles** (`pnpm run build && pnpm run check:build`).
- [ ] **Step 6: Commit** — `fix(scan): the docker tier can reach host loopback URLs via host-gateway`

---

### Task 4: Hygiène workflows — timeouts, concurrence, versions d'actions

**Files:**
- Modify: les 6 fichiers `.github/workflows/*.yml`

- [ ] **Step 1: Annuler le run bloqué** (one-off, avec accord) : `gh run cancel 32243300283`
- [ ] **Step 2: `ci.yml`** — en tête du workflow :

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

et `timeout-minutes` par job : `build-test: 15`, `install-bundle: 10`, `runtime-node-floor: 5`, `browser-tier: 15`, `action: 20` (couvert en Tâche 1).

- [ ] **Step 3: Bump des actions vers leurs majeurs courants** (supprime les annotations « Node.js 20 is deprecated ») : `actions/checkout@v4→v7`, `actions/setup-node@v4→v7`, `actions/upload-artifact@v4→v7`, `actions/download-artifact@v4→v8`, `pnpm/action-setup@v4→v6` — dans les 6 workflows. Avant de pousser, lire les release notes des sauts de majeur (upload-artifact v5+: noms d'artifacts immutables ; download-artifact v8). Le step « index.html is at the root of the unzipped artifact » du job `action` fait office de test de non-régression.
- [ ] **Step 4: Vérification** — `gh run watch` sur le run déclenché : CI verte, zéro annotation « Node.js 20 deprecated ».
- [ ] **Step 5: Commit** — `chore(ci): timeouts, concurrency and current action majors` (pas de `fix:`/`feat:` → pas de release).

---

## Self-review

- Couverture : les 4 tâches couvrent le correctif (T1) et les trois familles d'amélioration identifiées (diagnostic moteur T2, produit T3, hygiène T4). Le flake d'install (run bloqué) est couvert par timeout + concurrence + annulation (T4) — pas de code à changer (flake npm/apt, non reproductible).
- Placeholder scan : aucun « TBD » ; chaque step de code contient le code réel.
- Cohérence : `localTierStatus`/`localAvailable` (T2) et `loopbackToHostGateway` (T3) sont définis avant usage ; bundles reconstruits dans T2/T3 (`check:build` est un gate CI existant).
- Ordre : T1 seul rend la CI verte ; T2–T4 sont indépendants entre eux et peuvent être des PR séparées.
