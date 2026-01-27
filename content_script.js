// content_script.js

const TP = {
  host: null,
  shadow: null,
  iframe: null,
  open: false,
  ready: false
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "TP_TOGGLE") {
    togglePalette();
  }
});

function ensureUI() {
  if (TP.host) return;

  TP.host = document.createElement("div");
  TP.host.id = "tp-root-host";
  TP.host.style.all = "initial";
  TP.host.style.position = "fixed";
  TP.host.style.inset = "0";
  TP.host.style.zIndex = "2147483647"; // top
  TP.host.style.pointerEvents = "none"; // only iframe will capture
  document.documentElement.appendChild(TP.host);

  TP.shadow = TP.host.attachShadow({ mode: "open" });

  TP.iframe = document.createElement("iframe");
  TP.iframe.src = chrome.runtime.getURL("overlay.html");
  TP.iframe.style.width = "100%";
  TP.iframe.style.height = "100%";
  TP.iframe.style.border = "0";
  TP.iframe.style.pointerEvents = "auto";
  TP.iframe.addEventListener("load", () => {
    TP.ready = true;
    // If the palette was opened before the iframe finished loading, open it now.
    if (TP.open) {
      TP.iframe.contentWindow.postMessage({ __tp: true, type: "TP_OPEN" }, "*");
    }
  });

  TP.shadow.appendChild(TP.iframe);

  // Relay messages between iframe and background
  window.addEventListener("message", async (ev) => {
    if (ev.source !== TP.iframe.contentWindow) return;
    const data = ev.data;

    if (!data || data.__tp !== true) return;

    if (data.type === "TP_CLOSE") {
      hidePalette();
      return;
    }

    if (data.type === "TP_REQUEST_TABS") {
      const resp = await chrome.runtime.sendMessage({
        type: "TP_GET_TABS",
        currentWindow: true
      });
      TP.iframe.contentWindow.postMessage({ __tp: true, type: "TP_TABS", payload: resp }, "*");
      return;
    }

    if (data.type === "TP_ACTIVATE") {
      await chrome.runtime.sendMessage({
        type: "TP_ACTIVATE_TAB",
        tabId: data.tabId,
        windowId: data.windowId
      });
      hidePalette();
      return;
    }
  });
}

function showPalette() {
  ensureUI();
  TP.open = true;
  TP.host.style.display = "block";
  TP.host.style.pointerEvents = "auto";

  // Tell iframe to open + focus input
  if (TP.ready) {
    TP.iframe.contentWindow.postMessage({ __tp: true, type: "TP_OPEN" }, "*");
  }
}

function hidePalette() {
  if (!TP.host) return;
  TP.open = false;
  TP.host.style.pointerEvents = "none";
  TP.host.style.display = "none";
}

function togglePalette() {
  if (!TP.open) showPalette();
  else hidePalette();
}
