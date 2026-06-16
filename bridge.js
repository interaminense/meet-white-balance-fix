// Meet White Balance Fix — bridge (ISOLATED world)
// -----------------------------------------------------------------------------
// Bridges chrome.storage (where the popup writes parameters) and engine.js
// (MAIN world, which has no access to chrome.*). Relays params via window.postMessage.
// -----------------------------------------------------------------------------
(() => {
  "use strict";
  const DEFAULTS = {
    enabled: true, temperature: 0, r: 1, g: 1, b: 1,
    brightness: 0, contrast: 0, saturation: 0,
  };

  const post = (params) =>
    window.postMessage({ source: "wbfix", type: "params", params }, "*");

  const load = () =>
    chrome.storage.local.get(["params"], (res) =>
      post(Object.assign({}, DEFAULTS, res.params || {})));

  // The engine asks for params on load (resolves the injection-order race).
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.source === "wbfix" && d.type === "request") load();
  });

  // Changes made in the popup arrive here and are relayed to the engine — live.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.params) {
      post(Object.assign({}, DEFAULTS, changes.params.newValue || {}));
    }
  });

  load();
})();
