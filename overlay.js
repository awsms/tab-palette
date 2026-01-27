// overlay.js runs inside an extension iframe.
// It talks to the content script via window.postMessage.

const queryEl = document.getElementById("query");
const listEl = document.getElementById("list");
const backdropEl = document.getElementById("backdrop");
const groupFilterEl = document.getElementById("groupFilter");
const sortModeEl = document.getElementById("sortMode");
const groupControlEl = document.getElementById("groupControl");

let allTabs = [];
let filtered = [];
let selectedIndex = 0;
let open = false;

const STORAGE_KEYS = {
  settings: "tp_settings",
  state: "tp_state"
};

const DEFAULT_SETTINGS = {
  sortMode: "lastAccessed",
  groupFilter: "all",
  rememberSort: true,
  rememberFilter: true,
  searchGroups: true,
  enableGroups: true
};

const DEFAULT_STATE = {
  sortMode: "lastAccessed",
  groupFilter: "all"
};

let settings = { ...DEFAULT_SETTINGS };
let state = { ...DEFAULT_STATE };
let currentSort = DEFAULT_SETTINGS.sortMode;
let currentGroup = DEFAULT_SETTINGS.groupFilter;

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
  const g = settings.enableGroups && settings.searchGroups ? (tab.groupTitle || "").toLowerCase() : "";
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  let score = 0;
  for (const token of tokens) {
    const inTitle = t.includes(token);
    const inUrl = u.includes(token);
    const inGroup = g ? g.includes(token) : false;
    if (!inTitle && !inUrl && !inGroup) return 0;

    if (inTitle) score += 100;
    if (inUrl) score += 40;
    if (inGroup) score += 60;

    // bonus for earlier match per token
    const ti = inTitle ? t.indexOf(token) : -1;
    const ui = inUrl ? u.indexOf(token) : -1;
    const gi = inGroup ? g.indexOf(token) : -1;
    if (ti >= 0) score += Math.max(0, 30 - ti);
    if (ui >= 0) score += Math.max(0, 10 - ui);
    if (gi >= 0) score += Math.max(0, 20 - gi);
  }

  return score;
}

function normalizeTitle(tab) {
  return (tab.title || tab.url || "").toLowerCase();
}

function sortTabs(items) {
  const list = items.slice();
  if (currentSort === "alpha") {
    list.sort((a, b) => normalizeTitle(a).localeCompare(normalizeTitle(b)));
    return list;
  }
  if (currentSort === "group") {
    list.sort((a, b) => {
      const ag = a.groupId >= 0 ? (a.groupTitle || "(untitled group)") : "\uffff";
      const bg = b.groupId >= 0 ? (b.groupTitle || "(untitled group)") : "\uffff";
      const gc = ag.localeCompare(bg);
      if (gc !== 0) return gc;
      return normalizeTitle(a).localeCompare(normalizeTitle(b));
    });
    return list;
  }
  // lastAccessed (default)
  list.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return list;
}

function buildSortOptions(hasGroups) {
  sortModeEl.innerHTML = "";
  const options = [
    { value: "lastAccessed", label: "Last opened" },
    { value: "alpha", label: "Alphabetical" }
  ];
  if (settings.enableGroups && hasGroups) {
    options.push({ value: "group", label: "By group" });
  }
  options.forEach(opt => {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    sortModeEl.appendChild(el);
  });
  if ((!settings.enableGroups || !hasGroups) && currentSort === "group") currentSort = "lastAccessed";
  sortModeEl.value = currentSort;
}

function buildGroupOptions(tabs) {
  if (!settings.enableGroups) {
    groupFilterEl.innerHTML = "";
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "All groups";
    groupFilterEl.appendChild(all);
    groupFilterEl.value = "all";
    groupControlEl.style.display = "none";
    return false;
  }
  const groups = new Map();
  tabs.forEach(tab => {
    if (tab.groupId >= 0) {
      groups.set(tab.groupId, {
        id: tab.groupId,
        title: tab.groupTitle || "(untitled group)"
      });
    }
  });
  const sorted = Array.from(groups.values()).sort((a, b) => a.title.localeCompare(b.title));

  groupFilterEl.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All groups";
  groupFilterEl.appendChild(all);

  const ungrouped = document.createElement("option");
  ungrouped.value = "ungrouped";
  ungrouped.textContent = "Ungrouped";
  groupFilterEl.appendChild(ungrouped);

  sorted.forEach(group => {
    const opt = document.createElement("option");
    opt.value = String(group.id);
    opt.textContent = group.title;
    groupFilterEl.appendChild(opt);
  });

  if (currentGroup !== "all" && currentGroup !== "ungrouped") {
    const exists = sorted.some(g => String(g.id) === String(currentGroup));
    if (!exists) currentGroup = "all";
  }
  groupFilterEl.value = currentGroup;
  groupControlEl.style.display = sorted.length > 0 ? "flex" : "none";
  return sorted.length > 0;
}

async function loadSettings() {
  const resp = await chrome.storage.sync.get([STORAGE_KEYS.settings, STORAGE_KEYS.state]);
  settings = { ...DEFAULT_SETTINGS, ...(resp[STORAGE_KEYS.settings] || {}) };
  state = { ...DEFAULT_STATE, ...(resp[STORAGE_KEYS.state] || {}) };

  currentSort = settings.rememberSort ? state.sortMode : settings.sortMode;
  currentGroup = settings.rememberFilter ? state.groupFilter : settings.groupFilter;
}

function saveState() {
  const nextState = {
    sortMode: currentSort,
    groupFilter: currentGroup
  };
  state = nextState;
  chrome.storage.sync.set({ [STORAGE_KEYS.state]: nextState });
}

function applyFilter() {
  const q = queryEl.value.trim().toLowerCase();

  let items = allTabs.slice();
  if (settings.enableGroups) {
    if (currentGroup === "ungrouped") {
      items = items.filter(tab => tab.groupId < 0);
    } else if (currentGroup !== "all") {
      const groupId = Number(currentGroup);
      if (!Number.isNaN(groupId)) {
        items = items.filter(tab => tab.groupId === groupId);
      }
    }
  }
  if (q) {
    items = items
      .map(tab => ({ tab, s: scoreTab(tab, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => {
        const sd = b.s - a.s;
        if (sd !== 0) return sd;
        return normalizeTitle(a.tab).localeCompare(normalizeTitle(b.tab));
      })
      .map(x => x.tab);
  } else {
    items = sortTabs(items);
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
    if (settings.enableGroups && typeof tab.groupId === "number" && tab.groupId >= 0) {
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
  if (open) return;
  open = true;
  queryEl.value = "";
  selectedIndex = 0;
  listEl.innerHTML = "";
  allTabs = [];
  filtered = [];

  loadSettings().finally(() => {
    // Request tabs
    post({ type: "TP_REQUEST_TABS" });
  });

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

  if (data.type === "TP_BLUR") {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    queryEl.blur();
    return;
  }

  if (data.type === "TP_TABS") {
    const resp = data.payload;
    if (!resp?.ok) return;

    allTabs = resp.tabs || [];
    const hasGroups = buildGroupOptions(allTabs);
    buildSortOptions(hasGroups);
    applyFilter();
    selectedIndex = 0;
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
sortModeEl.addEventListener("change", () => {
  currentSort = sortModeEl.value;
  if (settings.rememberSort) saveState();
  applyFilter();
});
groupFilterEl.addEventListener("change", () => {
  currentGroup = groupFilterEl.value;
  if (settings.rememberFilter) saveState();
  applyFilter();
});
backdropEl.addEventListener("mousedown", (e) => {
  e.preventDefault();
  close();
});
