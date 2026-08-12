# Changelog

All notable changes to this project are documented here, generated automatically from the Conventional Commits by semantic-release.

# [3.0.0](https://github.com/maxgfr/ultra11y/compare/v2.32.1...v3.0.0) (2026-08-12)


* feat(tickets)!: the tickets command, and prd stops pushing ([4a6f6bd](https://github.com/maxgfr/ultra11y/commit/4a6f6bdac64fa720efaef9dc79521c2159c3dc61))


### Features

* **action:** adjudicate the judgment criteria in CI, by API or by agent ([2c3eaf9](https://github.com/maxgfr/ultra11y/commit/2c3eaf90c03e9fe47762ffd320ed0424f8e7771c))
* **audit:** --in re-gates an audit that already exists ([955dd93](https://github.com/maxgfr/ultra11y/commit/955dd938e81c1726918a368c6a51166f85bcfa04))
* **tickets:** config block, MCP preview tool, GitHub Action input, and the docs ([4400dd2](https://github.com/maxgfr/ultra11y/commit/4400dd2eae7cb93f02a6690b60e0aa792b89d841)), closes [--#issues](https://github.com/--/issues/issues)
* **tickets:** GitHub, GitLab and Jira behind one provider interface ([30a4a33](https://github.com/maxgfr/ultra11y/commit/30a4a33a5a56ef67e05ba72fb204a8fd827f307b))
* **tickets:** the grain — one pure function from an audit to a list of tickets ([ff9ee66](https://github.com/maxgfr/ultra11y/commit/ff9ee66cb899bc9d436823910ad90528f67663aa))


### BREAKING CHANGES

* prd --gh-issues and prd --gh-single are removed. Use
`ultra11y tickets --provider github --grain criterion` (or --grain single).
Both flags are listed in a REMOVED_FLAGS table that exits 2 and names the
replacement, rather than falling through to the generic unknown-flag warning —
a scripted CI must not keep reporting green while filing nothing.

Two guards the old flags lacked: --max-tickets (default 200) refuses to file a
flood rather than truncating it silently, and an unusable provider now exits 1
instead of 0, because a push command that pushes nothing is a failure.

## [2.32.1](https://github.com/maxgfr/ultra11y/compare/v2.32.0...v2.32.1) (2026-08-12)


### Bug Fixes

* **tickets:** decide usage from argv before touching the network ([#18](https://github.com/maxgfr/ultra11y/issues/18)) ([d7c81d7](https://github.com/maxgfr/ultra11y/commit/d7c81d70307a93f330865bf2d54e7563d220783f))

# [2.32.0](https://github.com/maxgfr/ultra11y/compare/v2.31.3...v2.32.0) (2026-08-12)


### Features

* **orchestrators:** the engine, drivable by a workflow engine that is not a person ([ab6b87b](https://github.com/maxgfr/ultra11y/commit/ab6b87bc6b0c597ea89407f41fb6a9af22cd318f))

## [2.31.3](https://github.com/maxgfr/ultra11y/compare/v2.31.2...v2.31.3) (2026-08-12)


### Bug Fixes

* stop publishing a conformity nobody verified ([09c435a](https://github.com/maxgfr/ultra11y/commit/09c435a748df9788f004aaf1e393a324656c6bf2))

## [2.31.2](https://github.com/maxgfr/ultra11y/compare/v2.31.1...v2.31.2) (2026-08-11)


### Bug Fixes

* **action:** let each invocation name its artifact, or the second one 409s ([65b7f58](https://github.com/maxgfr/ultra11y/commit/65b7f581c5723a1bc05a08d620d5136124034274))

## [2.31.1](https://github.com/maxgfr/ultra11y/compare/v2.31.0...v2.31.1) (2026-08-11)


### Bug Fixes

* close the gaps between what was asked for and what actually shipped ([98b4106](https://github.com/maxgfr/ultra11y/commit/98b41065816bdf52a6f4185f9ad4765d334c0514))

# [2.31.0](https://github.com/maxgfr/ultra11y/compare/v2.30.0...v2.31.0) (2026-08-11)


### Features

* page-by-page auditing — snapshots, per-page report, e2e plugins, Action, judge, extension ([88da5ec](https://github.com/maxgfr/ultra11y/commit/88da5ec78bea1adbeafd9edaaf499988e3077bcb))

# [2.30.0](https://github.com/maxgfr/ultra11y/compare/v2.29.0...v2.30.0) (2026-08-06)


### Features

* **engine:** re-pin codeindex v2.27.1 ([fafd9a8](https://github.com/maxgfr/ultra11y/commit/fafd9a8ce296aa310e062d21311c31c29fb7c097))

# [2.29.0](https://github.com/maxgfr/ultra11y/compare/v2.28.0...v2.29.0) (2026-08-02)


### Features

* **engine:** re-pin codeindex v2.26.0 ([bbe0f4a](https://github.com/maxgfr/ultra11y/commit/bbe0f4a6249a58c661cd3471899bb41a9de8e783))

# [2.28.0](https://github.com/maxgfr/ultra11y/compare/v2.27.0...v2.28.0) (2026-08-01)


### Features

* **harness:** run the automatic a11y review on Codex CLI and OpenCode ([d9775e0](https://github.com/maxgfr/ultra11y/commit/d9775e0c04deac552b689fe34f13ad025a2d7172))

# [2.27.0](https://github.com/maxgfr/ultra11y/compare/v2.26.0...v2.27.0) (2026-08-01)


### Features

* **engine:** re-pin codeindex v2.24.2 ([bb6c5b5](https://github.com/maxgfr/ultra11y/commit/bb6c5b5a676707faf5310b02bf81d3a98989c0e1))

# [2.26.0](https://github.com/maxgfr/ultra11y/compare/v2.25.0...v2.26.0) (2026-07-31)


### Features

* **plugin:** make the a11y review fire on its own before a commit, push or PR ([b7b2bce](https://github.com/maxgfr/ultra11y/commit/b7b2bce47565a8aafb8bb948a333bab0a326272d))

# [2.25.0](https://github.com/maxgfr/ultra11y/compare/v2.24.0...v2.25.0) (2026-07-31)


### Features

* **engine:** re-pin codeindex v2.22.0 ([5b705e7](https://github.com/maxgfr/ultra11y/commit/5b705e773658467ebf77e1ce5156da7bd833b07e))

# [2.24.0](https://github.com/maxgfr/ultra11y/compare/v2.23.0...v2.24.0) (2026-07-29)


### Features

* **mcp:** serve ultra11y over the Model Context Protocol ([9fc50b9](https://github.com/maxgfr/ultra11y/commit/9fc50b9d80e8426bf10555b14579c99ad8a77c05))

# [2.23.0](https://github.com/maxgfr/ultra11y/compare/v2.22.0...v2.23.0) (2026-07-29)


### Bug Fixes

* **adjudicate:** the citation gate was unsound under a country standard ([1b9210e](https://github.com/maxgfr/ultra11y/commit/1b9210e6479746d95e4025797c76b407f61db574))


### Features

* **action:** a shipped GitHub Action covering the code AND the pages ([d0c8dcd](https://github.com/maxgfr/ultra11y/commit/d0c8dcd764befc045ef05dc8fc5a025f9f712cf6))
* **ci:** SARIF and GitHub annotations, so findings land on the line of code ([57b707a](https://github.com/maxgfr/ultra11y/commit/57b707acaec101c9d96dc9e980aecdb7f1904dc8))
* **dev:** see the defects on the page you are building, while you build it ([ddf37a9](https://github.com/maxgfr/ultra11y/commit/ddf37a9ca64e5036d0e20b9b48978fbe1bc59a67))
* **e2e:** audit a page inside the Playwright/Cypress run you already have ([60584a7](https://github.com/maxgfr/ultra11y/commit/60584a7c83152b575b6d248a1a05ab938316e479))
* **pack:** use what the standard actually ships, on every surface ([7ea3f19](https://github.com/maxgfr/ultra11y/commit/7ea3f19fbe7734d5c4b0fb78ec4df678081fdc28))
* **pages:** the per-page criterion grid RGAA actually needs ([c1641b8](https://github.com/maxgfr/ultra11y/commit/c1641b85d6288bc529adba90a5ebc83c67eee9d7))
* **rendered:** decide contrast and colour-only links offline, from a snapshot ([53b2a3e](https://github.com/maxgfr/ultra11y/commit/53b2a3e52b67e7893651d194d5e30907db144038))
* **rendered:** three more criteria decided offline, and the CI loose ends closed ([cddb309](https://github.com/maxgfr/ultra11y/commit/cddb309201d59f35afbd2f07345290bbe0f29005))
* **snapshot:** a rendered PAGE on disk, so page-scoped criteria become decidable ([550cbf5](https://github.com/maxgfr/ultra11y/commit/550cbf5e1d306b77fd262e3960633885261339c2))

# [2.22.0](https://github.com/maxgfr/ultra11y/compare/v2.21.0...v2.22.0) (2026-07-26)


### Features

* **engine:** re-pin codeindex v2.20.1 ([1240ef0](https://github.com/maxgfr/ultra11y/commit/1240ef0a4b445a6ca1db4a1b16dbd2ea249345bb))

# [2.21.0](https://github.com/maxgfr/ultra11y/compare/v2.20.0...v2.21.0) (2026-07-25)


### Bug Fixes

* **cli:** two error paths that reported the wrong thing ([01bdfde](https://github.com/maxgfr/ultra11y/commit/01bdfde50acc53d1823766dfc51beb81e625022f))
* **rules:** stop reporting defects a user cannot experience ([2b642f9](https://github.com/maxgfr/ultra11y/commit/2b642f9fdc6f53e25a568826da6cb9680a9f5b6b))


### Features

* **act:** score the engine against the official W3C ACT test corpus ([cb6751b](https://github.com/maxgfr/ultra11y/commit/cb6751b12d1aa09fef1e159708de3bd52bf72ecd))
* **judgment:** a decision protocol for all 52 criteria the engine hands over ([c5b08fa](https://github.com/maxgfr/ultra11y/commit/c5b08fa9407517e8fe9458184c510323c1fe5fdb))
* **rules:** 12 new static checks — ARIA vocabulary, 2.5.3, autocomplete, tables, dl, 3.2.2, 3.3.8 ([5b24b9a](https://github.com/maxgfr/ultra11y/commit/5b24b9a172418c2fc07b65dd3b8863c48e5ab181))


### Performance Improvements

* **engine:** drop the quadratic label scan, the --graph double parse and the per-file staged spawns ([ffccd28](https://github.com/maxgfr/ultra11y/commit/ffccd28688aa37cbd20b11f5e48e2122b2e8da94))

# [2.20.0](https://github.com/maxgfr/ultra11y/compare/v2.19.0...v2.20.0) (2026-07-24)


### Features

* **engine:** re-pin codeindex v2.16.0 ([a7a6f4d](https://github.com/maxgfr/ultra11y/commit/a7a6f4dc173191f8795e682417bcd961600f55cc))

# [2.19.0](https://github.com/maxgfr/ultra11y/compare/v2.18.0...v2.19.0) (2026-07-24)


### Features

* **engine:** re-pin codeindex v2.15.0 ([5a16c95](https://github.com/maxgfr/ultra11y/commit/5a16c95d28396d4437c173574ce7dbcb71da31c8))

# [2.18.0](https://github.com/maxgfr/ultra11y/compare/v2.17.0...v2.18.0) (2026-07-24)


### Features

* **engine:** re-pin codeindex v2.14.0 ([8f1ef72](https://github.com/maxgfr/ultra11y/commit/8f1ef72f9209989f0e2098b7568d819657e8bba2))

# [2.17.0](https://github.com/maxgfr/ultra11y/compare/v2.16.1...v2.17.0) (2026-07-24)


### Features

* **engine:** re-pin codeindex v2.13.0 ([b9eacae](https://github.com/maxgfr/ultra11y/commit/b9eacae404cc1b54f0649c4ebb202cd34f87553d))

## [2.16.1](https://github.com/maxgfr/ultra11y/compare/v2.16.0...v2.16.1) (2026-07-23)


### Bug Fixes

* **engine:** ship the codeindex v2.12.0 re-pin in a release ([a05e025](https://github.com/maxgfr/ultra11y/commit/a05e0257eb17b2317a7dd599211b4a303877d9d7)), closes [#9](https://github.com/maxgfr/ultra11y/issues/9)

# [2.16.0](https://github.com/maxgfr/ultra11y/compare/v2.15.0...v2.16.0) (2026-07-23)


### Features

* **engine:** re-pin the codeindex engine at v2.10.0 ([b86d7ac](https://github.com/maxgfr/ultra11y/commit/b86d7aca84d89f3e1501eb7fb397b13fcfc5b8ba)), closes [#1](https://github.com/maxgfr/ultra11y/issues/1)

# [2.15.0](https://github.com/maxgfr/ultra11y/compare/v2.14.0...v2.15.0) (2026-07-22)


### Features

* **scan:** adopt the vendored codeindex engine for walking and import resolution ([caf39e0](https://github.com/maxgfr/ultra11y/commit/caf39e0c54ab46b45fbe42ed8dd256ed379f7ea6))

# [2.14.0](https://github.com/maxgfr/ultra11y/compare/v2.13.0...v2.14.0) (2026-07-13)


### Bug Fixes

* **pack:** drop inert suppressor-only cross-rule appliesTo entries + guard ([8ed6d62](https://github.com/maxgfr/ultra11y/commit/8ed6d62a72c7a149d4fd660a0d7c8f94eddbc7e0))
* **report:** pack-report header rate uses the projection basis ([1eabde4](https://github.com/maxgfr/ultra11y/commit/1eabde45a6a5f04e8abe8f797f7ac8beafc069a1))
* **report:** per-page section shows RGAA criteria in pack reports ([e36bd59](https://github.com/maxgfr/ultra11y/commit/e36bd59899e2e107c52536699810ca1b626a4c40))


### Features

* **pack:** RGAA 7.4 secondary mapping for live regions (disabled by default) ([5b6a401](https://github.com/maxgfr/ultra11y/commit/5b6a4010881be868c1a740f9a17fae0284deef4c))
* **packs:** configurable secondary crosswalk mappings ([36e3e1d](https://github.com/maxgfr/ultra11y/commit/36e3e1d451e1ac1d4a1fd7fa623e30e119bed0cd))

# [2.13.0](https://github.com/maxgfr/ultra11y/compare/v2.12.2...v2.13.0) (2026-07-13)


### Bug Fixes

* **adjudicate:** add caption-concision manual question (RGAA 5.5) ([6f8da13](https://github.com/maxgfr/ultra11y/commit/6f8da1319ab50316b64c88c65959f19a10d55393))
* **i18n:** localize declarative pack-rule findings via Finding.i18n ([44bdd39](https://github.com/maxgfr/ultra11y/commit/44bdd398d1da126f9e81b255777bdfbc89fcc477))
* **sample:** needs-rendering-aware partial-audit banner + lint precision ([4519543](https://github.com/maxgfr/ultra11y/commit/4519543de750b1b3cf5695e8461af971cb2069d7))
* **scan:** CI probe-string smoke, authenticated-click safety, probe docs ([dfe7df5](https://github.com/maxgfr/ultra11y/commit/dfe7df58918dab3354c8505e639a92af6b584a89))
* **scan:** close accessible-name bypasses in destructive-click skip ([ba17d62](https://github.com/maxgfr/ultra11y/commit/ba17d62a8013dcb9f0bb5eb80010386396c147e5))
* **scan:** pin cross-channel normative axe rules + adjudication/guidance polish ([c0d940a](https://github.com/maxgfr/ultra11y/commit/c0d940a46492c6268eaa74a0cb0a632f98b99965))
* **scan:** pin empty-heading, two-way cross-channel consistency guard ([29cd8f9](https://github.com/maxgfr/ultra11y/commit/29cd8f9b4dac1107a7f4620f5189155ea2298388))
* **scan:** promote exact-twin axe rules to pins, drift-proof cross-channel rule ([12ab213](https://github.com/maxgfr/ultra11y/commit/12ab213191f10eb204b503ad3884fe671d1b7ecc))
* **validate:** harden ReDoS guard against alternation + nested-group shapes ([ae34d10](https://github.com/maxgfr/ultra11y/commit/ae34d10826e69daf1322efefe52834c367e1f80d))
* **validate:** reject empty and unknown-key declarative match nodes ([254dbed](https://github.com/maxgfr/ultra11y/commit/254dbed480f688019b08254f26c1082322785128))


### Features

* **adjudicate:** manual question bank + evidence harvesters for the judgment tier ([dc7b676](https://github.com/maxgfr/ultra11y/commit/dc7b67618ba92585e5897d284ccf4e355feaafcb))
* **adjudicate:** require normativeRef for NC verdicts, add recommendations channel ([57ea761](https://github.com/maxgfr/ultra11y/commit/57ea761c5cccf771bf7f444720d1a6c9c8e54592))
* **engine:** advisory finding class — NC requires a normative test ([6f4b511](https://github.com/maxgfr/ultra11y/commit/6f4b51104d21c71d0e611750dbbcaf2bad02bdea))
* **output:** native full PRD ticket structure + reproduction context ([6a039a3](https://github.com/maxgfr/ultra11y/commit/6a039a3d54585dd213f95546fd5140cea682bbc2))
* **packs:** declarative rule interpreter + normativity overrides ([133844a](https://github.com/maxgfr/ultra11y/commit/133844a087c33e849a548353963b7fc03d865cf2))
* **packs:** RGAA download-link-format advisory rule (usage proof) ([95259db](https://github.com/maxgfr/ultra11y/commit/95259dba98b0a351035dbb6fe9d07d0e0c3f6329))
* **rules:** nav landmark, disabled-context, grouping detectors from Ara audit gaps ([ba475f7](https://github.com/maxgfr/ultra11y/commit/ba475f73fc164e0b8cfa1628e76681a0f9123bc7))
* **sample:** normative page-sample config, validation + RGAA methodology ([8af7320](https://github.com/maxgfr/ultra11y/commit/8af7320186d51f5ff2d41c80257e3f850eaad0a5))
* **scan:** best-practice axe violations merge as advisory, not NC ([5e049b9](https://github.com/maxgfr/ultra11y/commit/5e049b98886c335ab183fe7fa7e80b24258a1fd5))
* **scan:** scan --sample, per-page findings, partial-audit advisory ([8655fba](https://github.com/maxgfr/ultra11y/commit/8655fba06937396dde93f9904f3f7e2a88e35bdd))
* **scan:** stateful probes — filled inputs, dialogs, custom-control focus, live regions ([b072597](https://github.com/maxgfr/ultra11y/commit/b072597d6e6604cd19a5ddfed239af87ae1046e3))

## [2.12.2](https://github.com/maxgfr/ultra11y/compare/v2.12.1...v2.12.2) (2026-07-10)


### Bug Fixes

* **check:** fail when the header pass rate contradicts the synthesis totals ([2199f25](https://github.com/maxgfr/ultra11y/commit/2199f256d83b4719f9cbb601535dabc155543380))
* **gh:** exit non-zero and surface gh stderr when issue creation fails ([7492d08](https://github.com/maxgfr/ultra11y/commit/7492d08e7fcba1e62676abc173100b5423ebfadb))
* **grounding:** match HTML tag/attr names case-insensitively in the grounding gate ([0fcdd5e](https://github.com/maxgfr/ultra11y/commit/0fcdd5e70f9e2e05dbec6aba479b57577d7c0a86))

## [2.12.1](https://github.com/maxgfr/ultra11y/compare/v2.12.0...v2.12.1) (2026-07-09)


### Bug Fixes

* **orchestrate:** reconcile stale workflows on re-emit + review polish ([#7](https://github.com/maxgfr/ultra11y/issues/7)) ([8a18a70](https://github.com/maxgfr/ultra11y/commit/8a18a705fa0665ddc539892a9566fe8eeb03d969))

# [2.12.0](https://github.com/maxgfr/ultra11y/compare/v2.11.0...v2.12.0) (2026-07-09)


### Features

* **orchestrate:** engine-managed multi-agent orchestration (family round) ([#6](https://github.com/maxgfr/ultra11y/issues/6)) ([495465f](https://github.com/maxgfr/ultra11y/commit/495465ff45377c590f90009b95a8b4cf0fa9a0c3))

# [2.11.0](https://github.com/maxgfr/ultra11y/compare/v2.10.1...v2.11.0) (2026-07-08)


### Features

* AI-adjudicated judgment criteria + eval-round backlog (R1–R8 + family P0) ([#5](https://github.com/maxgfr/ultra11y/issues/5)) ([1f808d6](https://github.com/maxgfr/ultra11y/commit/1f808d6d95aaf694cfca3e96540fcfe6277a4171)), closes [hi#traffic](https://github.com/hi/issues/traffic)

## [2.10.1](https://github.com/maxgfr/ultra11y/compare/v2.10.0...v2.10.1) (2026-07-07)


### Bug Fixes

* eliminate three static-audit false positives ([acd2174](https://github.com/maxgfr/ultra11y/commit/acd2174e8ff7c3f4b3c10e9c840ff12fd2da1285))

# [2.10.0](https://github.com/maxgfr/ultra11y/compare/v2.9.0...v2.10.0) (2026-07-07)


### Bug Fixes

* **cli,verify:** harden gates & input validation (D6-002, D8-001..006, D5-002) ([ceffe41](https://github.com/maxgfr/ultra11y/commit/ceffe410183fde892ae32148ec19aabf1f3aaa31))
* **graph:** 3 cross-file resolution gaps (D3-001..003, D4-003) ([5c0d280](https://github.com/maxgfr/ultra11y/commit/5c0d28074c6694c32e53b7d4353c22c3cd41c8fe))
* **pack,scan:** ReDoS idPattern gate + honest storage-state fallback (D6-003, D8-004) ([6e44145](https://github.com/maxgfr/ultra11y/commit/6e441454594a3de6b259c840bb5c1b6a11bfec75))
* **rules,check:** close the P0 check gate + 6 content-rule FP/FN (D6-001, D1-001..007) ([ed1b2e1](https://github.com/maxgfr/ultra11y/commit/ed1b2e15019520a8dd99ac06bede080a98aebcd5))
* **rules,name:** honest preliminary marking + dead labelledby check (D4-001, D4-002, D1-005) ([269c793](https://github.com/maxgfr/ultra11y/commit/269c793f1ca62e7538546c7d372e775c7bf7a06e))
* **rules,parse:** 6 ARIA/timing FP-FN + JSX numeric attr unwrap (D2-001..006, D7-001, D1-008) ([c754d68](https://github.com/maxgfr/ultra11y/commit/c754d6817d3d155d0e90e974d4399428ec03f982))


### Features

* **skill:** add review-a11y — change-scoped accessibility review skill ([013eeba](https://github.com/maxgfr/ultra11y/commit/013eeba7c319bd74ef5eba59fd2fb10f2040aee9))
* **skill:** keep technical tokens in English in French prose ([a4fa0f4](https://github.com/maxgfr/ultra11y/commit/a4fa0f4b7515985ab6173e8c1ac8503d52d3d081))

# [2.9.0](https://github.com/maxgfr/ultra11y/compare/v2.8.0...v2.9.0) (2026-07-06)


### Bug Fixes

* **build:** biome-format generated standards datasets for byte-stable rebuilds ([4136517](https://github.com/maxgfr/ultra11y/commit/4136517bdd31fe2a61956657a7f1a0c73a833f73))
* **cli:** honest storybook/scaffold UX, docker+storage-state is an error not a degrade ([a373900](https://github.com/maxgfr/ultra11y/commit/a373900f31a882ac3123e1ded21769f172b0a9a7))
* final review sweep — merge-lang ordering, origin-line tests, stale docs, data guards ([9bfc1a3](https://github.com/maxgfr/ultra11y/commit/9bfc1a3282b5ef58d0a52cfec2352a19844c6ac8))
* **messages:** localize cross-file related-site notes (last French leak in EN output) ([9d0d09b](https://github.com/maxgfr/ultra11y/commit/9d0d09b032ef20dbdaee6c982e36f7eab3e46e7c))
* **verify:** neutralize pack idPattern capture groups in gate regexes ([924499d](https://github.com/maxgfr/ultra11y/commit/924499d77f4e6f12559288d739c6e7e54865ab74))


### Features

* **capture:** tested escaping source-of-truth, real E2E harvester test, captures in diff mode ([dcdd3c0](https://github.com/maxgfr/ultra11y/commit/dcdd3c01248ee983fffc94c96d9e0e4be1cb5966))
* **check,verify:** derive the pack citation-id regex from idPattern ([07703a7](https://github.com/maxgfr/ultra11y/commit/07703a79414f42c882c28be88413fab1f1975521))
* **cli:** --lang auto default — conversation-first language, repo/standard fallback ([eaa4211](https://github.com/maxgfr/ultra11y/commit/eaa421112b08ac1aff64296a48bb96bc6307ea3e))
* **graph:** close cross-file blind spots — .ts/.js barrels, SFC self-defs, Astro frontmatter ([6cd873b](https://github.com/maxgfr/ultra11y/commit/6cd873b56093e45489f20202c05db5acefa55bbc))
* **messages:** add the language-neutral message catalog + rule.ts plumbing ([a022adf](https://github.com/maxgfr/ultra11y/commit/a022adf02679e3256fd36d245914b4341f8ea45c))
* **renderers:** resolve finding message/remediation through the catalog ([6e6a7b8](https://github.com/maxgfr/ultra11y/commit/6e6a7b83ba6f27be42da53da89e841f22641c91d))
* **report:** render NC criteria with the auditor conformance block ([15c86ab](https://github.com/maxgfr/ultra11y/commit/15c86abb38f9eeccf630c0ca91e7c2e15557e9eb))
* **standards:** decouple a pack's own locales from the UI frame's Lang ([b5e3084](https://github.com/maxgfr/ultra11y/commit/b5e30846c8214b4cd536238918cc2cf31fb0a2e5))
* **standards:** derive the real WCAG SC universe; classify out-of-core/removed instead of a single hardcoded exception ([705b548](https://github.com/maxgfr/ultra11y/commit/705b548cdb4511fbac9c08376d2313856f1fc75a))
* **standards:** surface out-of-scope pack criteria as manual, not a silent NA ([4caa32a](https://github.com/maxgfr/ultra11y/commit/4caa32a5137652a273f1b7d70eebcc55ab39c8ed))
* **wcag:** official French titles from the W3C authorized translation, resolved at render time ([8c88f46](https://github.com/maxgfr/ultra11y/commit/8c88f46d704e0e3795953794ce43c26ae5334bb6)), closes [--#issues](https://github.com/--/issues/issues)

# [2.8.0](https://github.com/maxgfr/ultra11y/compare/v2.7.1...v2.8.0) (2026-07-06)


### Features

* **prd:** default to an auditor conformance block, modular per-standard vocabulary ([373f438](https://github.com/maxgfr/ultra11y/commit/373f43850d60710c6f5e1402a111b8a406557d23))

## [2.7.1](https://github.com/maxgfr/ultra11y/compare/v2.7.0...v2.7.1) (2026-07-01)


### Bug Fixes

* **rules,cli:** kill static-audit false positives + CLI silent-flag failures ([749c2e8](https://github.com/maxgfr/ultra11y/commit/749c2e817afa5e5d4a80a94d7b5450ccd19b589d))

# [2.7.0](https://github.com/maxgfr/ultra11y/compare/v2.6.0...v2.7.0) (2026-07-01)


### Features

* **render:** finish capture pipeline — sourceLine, gitattributes, captureAs, Storybook; fix review findings ([b969717](https://github.com/maxgfr/ultra11y/commit/b9697174ffd845cc96b994ff053e67539389f418)), closes [#1](https://github.com/maxgfr/ultra11y/issues/1) [#2](https://github.com/maxgfr/ultra11y/issues/2) [#3](https://github.com/maxgfr/ultra11y/issues/3) [#4](https://github.com/maxgfr/ultra11y/issues/4) [#5](https://github.com/maxgfr/ultra11y/issues/5) [#8](https://github.com/maxgfr/ultra11y/issues/8)

# [2.6.0](https://github.com/maxgfr/ultra11y/compare/v2.5.0...v2.6.0) (2026-07-01)


### Features

* **render:** rendered-DOM capture pipeline for component-library a11y ([7610d44](https://github.com/maxgfr/ultra11y/commit/7610d44d966297b5cfc8bec02d95dd19a65beb74))

# [2.5.0](https://github.com/maxgfr/ultra11y/compare/v2.4.1...v2.5.0) (2026-07-01)


### Features

* **scan:** local no-Docker axe runtime + residual-criteria probes; 5 new static rules ([1d29dc3](https://github.com/maxgfr/ultra11y/commit/1d29dc3bb301cc1e2798115609db872bb3c44eb9))

## [2.4.1](https://github.com/maxgfr/ultra11y/compare/v2.4.0...v2.4.1) (2026-06-30)


### Bug Fixes

* **cli:** audit no longer writes audits/audit-latest.json unless --out is given ([5f0d39c](https://github.com/maxgfr/ultra11y/commit/5f0d39cbd03edfd2331920cf992d7a97d6648cbe))

# [2.4.0](https://github.com/maxgfr/ultra11y/compare/v2.3.0...v2.4.0) (2026-06-30)


### Bug Fixes

* **build:** rebuild bundle from formatted data files (check:build reproducibility) ([7936381](https://github.com/maxgfr/ultra11y/commit/793638109ea9251ae87f07cb2cfce6f60a22b8a6))
* **skill:** trim SKILL.md description under the 1000-char install cap ([08b55d1](https://github.com/maxgfr/ultra11y/commit/08b55d1c0a6891f6cb8ced39a6a0305974a6d9e3))


### Features

* **rules,guidance:** exhaustive RGAA pack — 6 new detectors (42→48) + guidance for 90/106 criteria ([f6f2e33](https://github.com/maxgfr/ultra11y/commit/f6f2e33b24e01dc1c689669d12237364e6d6c21c))

# [2.3.0](https://github.com/maxgfr/ultra11y/compare/v2.2.1...v2.3.0) (2026-06-30)


### Bug Fixes

* **build:** make the committed bundle reproducible across node_modules layouts ([79e1853](https://github.com/maxgfr/ultra11y/commit/79e185392b47cb38c777788b86fa8220c58e8f6b))


### Features

* **prd:** --gh-single files the whole audit as one consolidated GitHub issue ([665f145](https://github.com/maxgfr/ultra11y/commit/665f145fbeb3991e69fc6a1e1e8a9caddbf093f6)), closes [--#single](https://github.com/--/issues/single)

## [2.2.1](https://github.com/maxgfr/ultra11y/compare/v2.2.0...v2.2.1) (2026-06-29)


### Bug Fixes

* **rules:** drive confident-tier precision to 100% — kill component/dynamic/shell false positives ([d9a6e51](https://github.com/maxgfr/ultra11y/commit/d9a6e5166f03310a6c9bd65c24c44d8a349ae2e0)), closes [#app](https://github.com/maxgfr/ultra11y/issues/app)

# [2.2.0](https://github.com/maxgfr/ultra11y/compare/v2.1.0...v2.2.0) (2026-06-29)


### Bug Fixes

* **scan:** surface the container's real error instead of "Command failed" ([3c3f6b8](https://github.com/maxgfr/ultra11y/commit/3c3f6b8e5d2920e72c32ca2008f025696d74fc44))


### Features

* **audit:** preliminary SFC findings, default test-exclude, --json for report/prd/verify ([48a5684](https://github.com/maxgfr/ultra11y/commit/48a5684f84b5255046d160e4e093e8a1ba21d737))
* **rules:** component-aware auditing for JSX & .vue/.svelte/.astro ([551b767](https://github.com/maxgfr/ultra11y/commit/551b767530b5fc750855b91eebc4f05c12615a55))

# [2.1.0](https://github.com/maxgfr/ultra11y/compare/v2.0.0...v2.1.0) (2026-06-29)


### Features

* map rules to WCAG success criteria ([607133f](https://github.com/maxgfr/ultra11y/commit/607133f832d4ae6cda437d4e9213d3eb255259b4))

# [2.0.0](https://github.com/maxgfr/ultra11y/compare/v1.4.4...v2.0.0) (2026-06-29)


* feat!: cross-file graph audit, rendered-audit, PRD + judgment/correction loop; latest deps + Node 22 floor ([353cfa3](https://github.com/maxgfr/ultra11y/commit/353cfa35f5b6b649917e8c42b045dc75fa5108f6)), closes [--#issues](https://github.com/--/issues/issues)


### BREAKING CHANGES

* engines.node is now >=22.18 (was >=18). The bundled
@babel/parser 8 requires Node ^22.18 || >=24.11, so Node 18 and 20 are no longer
supported at runtime.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

## [1.4.4](https://github.com/maxgfr/ultra11y/compare/v1.4.3...v1.4.4) (2026-06-28)


### Bug Fixes

* **scan:** validate AuditResult shape on --merge; add biome lint + coverage parity ([e5e2d84](https://github.com/maxgfr/ultra11y/commit/e5e2d84a8602c2738fc58e7f617ecdc3a50216a1))

## [1.4.3](https://github.com/maxgfr/ultra11y/compare/v1.4.2...v1.4.3) (2026-06-28)


### Bug Fixes

* **skill:** drop redundant .agents mirror, unify ultra11y on skills/ single source ([efcf9d1](https://github.com/maxgfr/ultra11y/commit/efcf9d134f81e799422f67bb5614c7f5f1a5ba9c))

## [1.4.2](https://github.com/maxgfr/ultra11y/compare/v1.4.1...v1.4.2) (2026-06-28)


### Bug Fixes

* **skill:** resync .agents/ ultra11y mirror (1043→1009) and guard it against drift ([fac516f](https://github.com/maxgfr/ultra11y/commit/fac516fa72aebd65bbf0d6175f35e13c7d482dbb))

## [1.4.1](https://github.com/maxgfr/ultra11y/compare/v1.4.0...v1.4.1) (2026-06-18)


### Bug Fixes

* **cli:** harden gates and flag parsing across audit/verify/init/check/scan ([3e7676a](https://github.com/maxgfr/ultra11y/commit/3e7676a120a0406bac7e5abb7afa592a58a3c7d9))

# [1.4.0](https://github.com/maxgfr/ultra11y/compare/v1.3.0...v1.4.0) (2026-06-17)


### Features

* **engine:** scale to huge repos, apply fixes, repo automation, WCAG view ([2faf4f2](https://github.com/maxgfr/ultra11y/commit/2faf4f2dcb09b59c2c83eebde57b23e98b2e41dc))

# [1.3.0](https://github.com/maxgfr/ultra11y/compare/v1.2.0...v1.3.0) (2026-06-17)


### Features

* **engine:** exhaustive coverage — multi-page crawl, static contrast, axe RGAA tags, more file types ([e3b3352](https://github.com/maxgfr/ultra11y/commit/e3b335232da530eff6b52d6fb8621161c61650d8))

# [1.2.0](https://github.com/maxgfr/ultra11y/compare/v1.1.0...v1.2.0) (2026-06-16)


### Features

* **scan:** scan --clean teardown + fully-dockerized dev/CI flow ([d8a5901](https://github.com/maxgfr/ultra11y/commit/d8a5901e56b140cda70f3ceecae81e7a18786af7))

# [1.1.0](https://github.com/maxgfr/ultra11y/compare/v1.0.1...v1.1.0) (2026-06-16)


### Features

* **rules:** +10 static rules, layout-table heuristic, definite-NC on render criteria ([7979599](https://github.com/maxgfr/ultra11y/commit/7979599c19941a15913d7d29544e9e2145c66035)), closes [hi#confidence](https://github.com/hi/issues/confidence)
* **scan:** optional Docker dynamic tier (axe-core in a headless browser) ([4b7a287](https://github.com/maxgfr/ultra11y/commit/4b7a2877475445d422bb26edb6782cd1da9fde5f))

## [1.0.1](https://github.com/maxgfr/ultra11y/compare/v1.0.0...v1.0.1) (2026-06-16)


### Bug Fixes

* **build:** bundle htmlparser2 into the standalone .mjs (noExternal) ([eeeff3e](https://github.com/maxgfr/ultra11y/commit/eeeff3e4a365a09e23e57ad0feb24d916ab37c39))

# 1.0.0 (2026-06-16)


### Bug Fixes

* track references/verify.md shadowed by case-insensitive gitignore ([66e5288](https://github.com/maxgfr/ultra11y/commit/66e52883f77e0b316a77901de0605dc0315e6c7c))


### Features

* **audit:** static engine integration — audit command + AuditResult (M3) ([ef7c509](https://github.com/maxgfr/ultra11y/commit/ef7c509098c506277d833df30d83135d32f0281a))
* **criteria:** offline RGAA reference lookup + criteria command (M5) ([9ae2ae6](https://github.com/maxgfr/ultra11y/commit/9ae2ae6c3a1857ecc8fd54c7f4be04b15a0836df))
* **gates:** check (report integrity) + verify (adversarial claim gate) (M6) ([9f062ef](https://github.com/maxgfr/ultra11y/commit/9f062ef1252a7a43dd74f2353964b942c56ace7b))
* **parse:** HTML/JSX parsers + accessible-name engine (M1) ([5adf3b3](https://github.com/maxgfr/ultra11y/commit/5adf3b3119fdbce0ab8e144894cbf95e481719ab))
* **report:** etalab-style RGAA report renderer + report command (M4) ([59d87b7](https://github.com/maxgfr/ultra11y/commit/59d87b78ed8eb377bb2c421c6c833e823ed77a03))
* **rules:** static rule engine — 25 RGAA rules across 10 themes (M2) ([3729cfc](https://github.com/maxgfr/ultra11y/commit/3729cfccf307175888d0af95504f611d1da17ebb))
* scaffold ultra11y skill — RGAA 4.1.2 dataset + loader + integrity gate (M0) ([479cf2a](https://github.com/maxgfr/ultra11y/commit/479cf2a22cbe3d2a095f373e386a3cbce5167e51))
* **skill:** SKILL.md + 6 reference docs + skill drift guards (M7) ([6c021e8](https://github.com/maxgfr/ultra11y/commit/6c021e8c8c79c90425c2b11fcd5ccf67d7328033))
