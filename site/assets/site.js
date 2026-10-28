// ultra11y documentation site — progressive enhancement only. Every page reads fully
// without this file: the numbers and the criteria grid are written into the HTML at build
// time (scripts/build-site.mjs). This adds the theme toggle and the grid's source filter.
(() => {
  const root = document.documentElement;
  const KEY = "ultra11y-theme";
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // storage blocked: the system preference applies
  }
  if (saved === "dark" || saved === "light") root.dataset.theme = saved;

  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);

  function bindToggle() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const sync = () => btn.setAttribute("aria-pressed", String(isDark()));
    btn.hidden = false;
    sync();
    btn.addEventListener("click", () => {
      const next = isDark() ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // not persisted, still applied
      }
      sync();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", sync);
  }

  function bindFilters() {
    const group = document.getElementById("filters");
    const status = document.getElementById("filter-status");
    if (!group) return;
    const cells = [...document.querySelectorAll("#matrix .cell")];
    const buttons = [...group.querySelectorAll("button")];
    group.hidden = false;
    const match = (f, el) => f === "all" || (f.startsWith("level:") ? el.dataset.level === f.slice(6) : el.dataset.src.split(" ").includes(f));
    for (const btn of buttons) {
      btn.addEventListener("click", () => {
        for (const b of buttons) b.setAttribute("aria-pressed", String(b === btn));
        let n = 0;
        for (const el of cells) {
          const on = match(btn.dataset.f, el);
          el.classList.toggle("hit", on && btn.dataset.f !== "all");
          if (on) n++;
        }
        if (status) status.textContent = btn.dataset.f === "all" ? "" : `${n} critère${n > 1 ? "s" : ""} mis en évidence : ${btn.textContent}.`;
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindToggle();
    bindFilters();
  });
})();
