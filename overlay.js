// overlay.js runs inside an extension iframe.
// It talks to the content script via window.postMessage.

const queryEl = document.getElementById("query");
const listEl = document.getElementById("list");
const backdropEl = document.getElementById("backdrop");

let allTabs = [];
let filtered = [];
let selectedIndex = 0;
let open = false;

const GROUP_COLORS = {
  grey: "#9aa0a6",
  blue: "#8ab4f8",
  red: "#f28b82",
  yellow: "#fdd663",
  green: "#81c995",
  pink: "#ff8ab7",
  purple: "#d7aefb",
  cyan: "#78d9ec",
  orange: "#fcad70"
};

const GROUP_COLORS = {
  grey: "#9aa0a6",
  blue: "#8ab4f8",
  red: "#f28b82",
  yellow: "#fdd663",
  green: "#81c995",
  pink: "#ff8ab7",
  purple: "#d7aefb",
  cyan: "#78d9ec",
  orange: "#fcad70"
};

function post(msg) {
  window.parent.postMessage({ __tp: true, ...msg }, "*");
}

function scoreTab(tab, q) {
  // Simple fuzzy-ish scoring: title contains > url contains > fallback.
  // You can replace with a proper fuzzy matcher later.
  const t = (tab.title || "").toLowerCase();
  const u = (tab.url || "").toLowerCase();
  if (!q) return 0;

  let score = 0;
  if (t.includes(q)) score += 100;
  if (u.includes(q)) score += 40;

  // bonus for earlier match
  const ti = t.indexOf(q);
  const ui = u.indexOf(q);
  if (ti >= 0) score += Math.max(0, 30 - ti);
  if (ui >= 0) score += Math.max(0, 10 - ui);

  return score;
}

function applyFilter() {
  const q = queryEl.value.trim().toLowerCase();

  let items = allTabs.slice();
  if (q) {
    items = items
      .map(tab => ({ tab, s: scoreTab(tab, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.tab);
  }

  filtered = items;
  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
  render();
}

function render() {
  listEl.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.textContent = "No matching tabs";
    empty.style.color = "rgba(255,255,255,0.7)";
    listEl.appendChild(empty);
    return;
  }

  filtered.forEach((tab, idx) => {
    const row = document.createElement("div");
    row.className = "item";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false");

    const icon = document.createElement("img");
    icon.className = "favicon";
    icon.alt = "";
    // favIconUrl can be empty or blocked; keep it robust
    if (tab.favIconUrl) icon.src = tab.favIconUrl;

    const meta = document.createElement("div");
    meta.className = "meta";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = tab.title || "(untitled)";

    const url = document.createElement("div");
    url.className = "url";
    url.textContent = tab.url || "";

    meta.appendChild(title);
    meta.appendChild(url);
    if (typeof tab.groupId === "number" && tab.groupId >= 0) {
      const group = document.createElement("div");
      group.className = "group";

      const dot = document.createElement("span");
      dot.className = "dot";
      if (tab.groupColor && GROUP_COLORS[tab.groupColor]) {
        dot.style.background = GROUP_COLORS[tab.groupColor];
      }

      const label = document.createElement("span");
      label.textContent = tab.groupTitle || "(untitled group)";

      group.appendChild(dot);
      group.appendChild(label);
      meta.appendChild(group);
    }
    if (typeof tab.groupId === "number" && tab.groupId >= 0) {
      const group = document.createElement("div");
      group.className = "group";

      const dot = document.createElement("span");
      dot.className = "dot";
      if (tab.groupColor && GROUP_COLORS[tab.groupColor]) {
        dot.style.background = GROUP_COLORS[tab.groupColor];
      }

      const label = document.createElement("span");
      label.textContent = tab.groupTitle || "(untitled group)";

      group.appendChild(dot);
      group.appendChild(label);
      meta.appendChild(group);
    }

    row.appendChild(icon);
    row.appendChild(meta);

    row.addEventListener("mousemove", () => {
      selectedIndex = idx;
      highlightOnly();
    });

    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      activateSelected();
    });

    listEl.appendChild(row);
  });

  scrollSelectedIntoView();
}

function highlightOnly() {
  const children = Array.from(listEl.children);
  children.forEach((el, idx) => {
    if (el.classList.contains("item")) {
      el.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false");
    }
  });
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  const el = listEl.children[selectedIndex];
  if (!el) return;
  const r = el.getBoundingClientRect();
  const lr = listEl.getBoundingClientRect();
  if (r.top < lr.top) el.scrollIntoView({ block: "nearest" });
  else if (r.bottom > lr.bottom) el.scrollIntoView({ block: "nearest" });
}

function moveSelection(delta) {
  if (filtered.length === 0) return;
  selectedIndex = (selectedIndex + delta + filtered.length) % filtered.length;
  highlightOnly();
}

function activateSelected() {
  const tab = filtered[selectedIndex];
  if (!tab) return;
  post({ type: "TP_ACTIVATE", tabId: tab.id, windowId: tab.windowId });
}

function close() {
  open = false;
  post({ type: "TP_CLOSE" });
}

function openPalette() {
  open = true;
  queryEl.value = "";
  selectedIndex = 0;
  listEl.innerHTML = "";
  allTabs = [];
  filtered = [];

  // Request tabs
  post({ type: "TP_REQUEST_TABS" });

  // Focus after a tick to ensure iframe is ready
  setTimeout(() => queryEl.focus(), 0);
}

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (!data || data.__tp !== true) return;

  if (data.type === "TP_OPEN") {
    openPalette();
    return;
  }

  if (data.type === "TP_TABS") {
    const resp = data.payload;
    if (!resp?.ok) return;

    allTabs = resp.tabs || [];

    // Put active tab near top? (optional)
    allTabs.sort((a, b) => (b.active === true) - (a.active === true));

    filtered = allTabs.slice();
    selectedIndex = 0;
    render();
    return;
  }
});

window.addEventListener("keydown", (e) => {
  if (!open) return;

  if (e.key === "Escape") {
    e.preventDefault();
    close();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveSelection(+1);
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    moveSelection(-1);
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    activateSelected();
    return;
  }
});

queryEl.addEventListener("input", () => applyFilter());
backdropEl.addEventListener("mousedown", (e) => {
  e.preventDefault();
  close();
});
