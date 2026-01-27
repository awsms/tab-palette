const TP = {
  host: null,
  shadow: null,
  iframe: null,
  backdrop: null,
  open: false,
  ready: false,
  lastFocused: null,
  viewportBound: false,
  baseDpr: null,
  uiScale: 1,
  settingsBound: false,
  currentScale: 1
};

const STORAGE_KEYS = {
  settings: "tp_settings"
};

const DEFAULT_SETTINGS = {
  uiScale: 1
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
  TP.host.style.background = "transparent";
  document.documentElement.appendChild(TP.host);

  TP.shadow = TP.host.attachShadow({ mode: "open" });

  TP.backdrop = document.createElement("div");
  TP.backdrop.style.position = "fixed";
  TP.backdrop.style.inset = "0";
  TP.backdrop.style.background = "transparent";
  TP.backdrop.style.pointerEvents = "auto";
  TP.backdrop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    hidePalette();
  });

  TP.shadow.appendChild(TP.backdrop);
  createIframe();

  // Relay messages between iframe and background
  window.addEventListener("message", async (ev) => {
    if (!TP.iframe || !TP.iframe.contentWindow) return;
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

    if (data.type === "TP_SIZE") {
      if (!TP.iframe || typeof data.height !== "number") return;
      const scale = TP.currentScale || 1;
      const height = Math.ceil(data.height / scale);
      TP.iframe.style.height = `${height}px`;
      return;
    }
  });

  if (!TP.settingsBound) {
    TP.settingsBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes[STORAGE_KEYS.settings]) return;
      const next = changes[STORAGE_KEYS.settings].newValue || {};
      TP.uiScale = typeof next.uiScale === "number" ? next.uiScale : 1;
      updateScale();
    });
  }
}

function updateScale() {
  if (!TP.iframe) return;
  const currentDpr = window.devicePixelRatio || 1;
  if (!TP.baseDpr) TP.baseDpr = currentDpr;
  const inv = TP.baseDpr / currentDpr;
  const scale = inv * (TP.uiScale || 1);
  TP.currentScale = scale || 1;
  TP.iframe.style.transform = `translateX(-50%) scale(${scale})`;
  TP.iframe.style.transformOrigin = "top center";
}

async function loadSettings() {
  const resp = await chrome.storage.sync.get([STORAGE_KEYS.settings]);
  const settings = { ...DEFAULT_SETTINGS, ...(resp[STORAGE_KEYS.settings] || {}) };
  TP.uiScale = typeof settings.uiScale === "number" ? settings.uiScale : 1;
}

function createIframe() {
  if (!TP.shadow) return;
  if (TP.iframe && TP.iframe.isConnected) return;

  TP.ready = false;
  TP.iframe = document.createElement("iframe");
  TP.iframe.src = chrome.runtime.getURL("overlay.html");
  TP.iframe.style.position = "fixed";
  TP.iframe.style.left = "50%";
  TP.iframe.style.top = "14%";
  TP.iframe.style.transform = "translateX(-50%)";
  TP.iframe.style.width = "min(900px, calc(100% - 24px))";
  TP.iframe.style.height = "560px";
  TP.iframe.style.borderRadius = "12px";
  TP.iframe.style.overflow = "hidden";
  TP.iframe.style.border = "0";
  TP.iframe.style.pointerEvents = "auto";
  TP.iframe.style.background = "#111";
  TP.iframe.style.display = "block";
  TP.iframe.setAttribute("allowtransparency", "true");
  loadSettings().finally(() => {
    updateScale();
  });
  TP.iframe.addEventListener("load", () => {
    TP.ready = true;
    // If the palette was opened before the iframe finished loading, open it now.
    if (TP.open && TP.iframe?.contentWindow) {
      TP.iframe.contentWindow.postMessage({ __tp: true, type: "TP_OPEN" }, "*");
    }
  });

  TP.shadow.appendChild(TP.iframe);
}

function showPalette() {
  ensureUI();
  createIframe();
  TP.open = true;
  TP.lastFocused = document.activeElement;
  TP.host.style.display = "block";
  TP.host.style.pointerEvents = "auto";
  if (TP.backdrop) {
    TP.backdrop.style.display = "block";
  }
  TP.iframe.style.display = "block";
  updateScale();
  if (!TP.viewportBound && window.visualViewport) {
    TP.viewportBound = true;
    window.visualViewport.addEventListener("resize", updateScale);
  }

  // Tell iframe to open + focus input
  if (TP.ready) {
    TP.iframe.contentWindow.postMessage({ __tp: true, type: "TP_OPEN" }, "*");
  }
}

function hidePalette() {
  if (!TP.host) return;
  TP.open = false;
  if (TP.iframe?.contentWindow) {
    TP.iframe.contentWindow.postMessage({ __tp: true, type: "TP_BLUR" }, "*");
  }
  if (TP.backdrop) {
    TP.backdrop.style.display = "none";
  }
  TP.host.style.pointerEvents = "none";
  TP.host.style.display = "none";
  if (TP.iframe) {
    TP.iframe.remove();
    TP.iframe = null;
    TP.ready = false;
  }
  if (TP.lastFocused && typeof TP.lastFocused.focus === "function") {
    TP.lastFocused.focus();
  } else {
    const body = document.body;
    if (body) {
      const focusEl = document.createElement("input");
      focusEl.type = "text";
      focusEl.tabIndex = -1;
      focusEl.style.position = "fixed";
      focusEl.style.opacity = "0";
      focusEl.style.pointerEvents = "none";
      focusEl.style.width = "1px";
      focusEl.style.height = "1px";
      body.appendChild(focusEl);
      focusEl.focus();
      focusEl.remove();
    } else {
      window.focus();
    }
  }
}

function togglePalette() {
  if (!TP.open) showPalette();
  else hidePalette();
}
