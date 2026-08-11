// Options are read by the service worker through chrome.storage.local. The API key lives
// there and nowhere else: it is forwarded per request to the LOCAL server, which uses it for
// the call and never persists it.

const FIELDS = ["port", "standard", "apiKey"];
const DEFAULTS = { port: 4111, standard: "wcag", apiKey: "" };

const cfg = { ...DEFAULTS, ...(await chrome.storage.local.get(FIELDS)) };
for (const f of FIELDS) document.getElementById(f).value = cfg[f] ?? "";

document.getElementById("save").addEventListener("click", async () => {
  const port = Number(document.getElementById("port").value);
  await chrome.storage.local.set({
    // A bad port would fail every request with an opaque network error, so fall back rather
    // than store nonsense.
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULTS.port,
    standard: document.getElementById("standard").value,
    apiKey: document.getElementById("apiKey").value.trim(),
  });
  const saved = document.getElementById("saved");
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 1500);
});
