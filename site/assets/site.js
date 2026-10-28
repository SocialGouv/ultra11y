// ultra11y documentation site — progressive enhancement only. Every page reads fully
// without this file: the numbers and the criteria grid are written into the HTML at build
// time (scripts/build-site.mjs). This adds the theme toggle, the grid's source filter and the « Copier »
// buttons of the command blocks.
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

  // A « Copier » button on every command block. Without this script the commands stay
  // plain, selectable text: nothing is lost. Output samples (pre.out) get no button.
  function bindCopy() {
    const blocks = [...document.querySelectorAll("main pre:not(.out)")];
    if (!blocks.length) return;
    const fallback = (text) => {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
      return ok;
    };
    for (const pre of blocks) {
      const text = pre.textContent.replace(/\n+$/, "");
      const first = text.split("\n")[0].replace(/\s+#.*$/, "");
      // Once wrapped, a line may break only between words, never inside « --standard ».
      const code = pre.querySelector("code");
      if (code && code.children.length === 0) {
        code.replaceChildren(
          ...text.split(/( +|\n)/).map((part) => {
            if (!part.trim()) return document.createTextNode(part);
            const span = document.createElement("span");
            span.className = "nw";
            span.textContent = part;
            return span;
          }),
        );
      }
      const box = document.createElement("div");
      box.className = "codebox";
      pre.replaceWith(box);
      box.append(pre);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy";
      btn.innerHTML = 'Copier<span class="sr-only"> : </span>';
      btn.querySelector("span").append(first);
      // The result is said in a live region next to the button; the button keeps its name.
      const msg = document.createElement("span");
      msg.className = "copy-msg";
      msg.setAttribute("role", "status");
      box.append(btn, msg);
      let timer = 0;
      btn.addEventListener("click", async () => {
        let ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          ok = fallback(text);
        }
        msg.textContent = ok ? "Copié" : "Copie impossible : sélectionnez le texte";
        clearTimeout(timer);
        timer = setTimeout(() => {
          msg.textContent = "";
        }, 3000);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindToggle();
    bindFilters();
    bindCopy();
  });
})();
