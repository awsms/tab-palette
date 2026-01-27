const STORAGE_KEYS = {
  settings: "tp_settings"
};

const DEFAULT_SETTINGS = {
  sortMode: "lastAccessed",
  groupFilter: "all",
  rememberSort: true,
  rememberFilter: true,
  searchGroups: true,
  enableGroups: true,
  uiScale: 1,
  showHints: true
};

const sortModeEl = document.getElementById("sortMode");
const groupFilterEl = document.getElementById("groupFilter");
const rememberSortEl = document.getElementById("rememberSort");
const rememberFilterEl = document.getElementById("rememberFilter");
const searchGroupsEl = document.getElementById("searchGroups");
const enableGroupsEl = document.getElementById("enableGroups");
const showHintsEl = document.getElementById("showHints");
const uiScaleEl = document.getElementById("uiScale");
const saveBtn = document.getElementById("save");
const resetBtn = document.getElementById("reset");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
  if (!msg) return;
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
}

function readForm() {
  return {
    sortMode: sortModeEl.value,
    groupFilter: groupFilterEl.value,
    rememberSort: rememberSortEl.checked,
    rememberFilter: rememberFilterEl.checked,
    searchGroups: searchGroupsEl.checked,
    enableGroups: enableGroupsEl.checked,
    showHints: showHintsEl.checked,
    uiScale: Number(uiScaleEl.value) || 1
  };
}

function writeForm(settings) {
  sortModeEl.value = settings.sortMode;
  groupFilterEl.value = settings.groupFilter;
  rememberSortEl.checked = settings.rememberSort;
  rememberFilterEl.checked = settings.rememberFilter;
  searchGroupsEl.checked = settings.searchGroups;
  enableGroupsEl.checked = settings.enableGroups;
  showHintsEl.checked = settings.showHints;
  uiScaleEl.value = String(settings.uiScale ?? 1);
  updateGroupDependents(settings.enableGroups);
}

function updateGroupDependents(enabled) {
  groupFilterEl.disabled = !enabled;
  rememberFilterEl.disabled = !enabled;
  searchGroupsEl.disabled = !enabled;
  const groupSortOpt = sortModeEl.querySelector("option[value=\"group\"]");
  if (groupSortOpt) groupSortOpt.disabled = !enabled;
  if (!enabled && sortModeEl.value === "group") {
    sortModeEl.value = "lastAccessed";
  }
}

async function load() {
  const resp = await chrome.storage.sync.get([STORAGE_KEYS.settings]);
  const settings = { ...DEFAULT_SETTINGS, ...(resp[STORAGE_KEYS.settings] || {}) };
  writeForm(settings);
}

async function save() {
  const settings = readForm();
  await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings });
  setStatus("Saved");
}

async function resetDefaults() {
  await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS } });
  writeForm({ ...DEFAULT_SETTINGS });
  setStatus("Reset");
}

saveBtn.addEventListener("click", save);
resetBtn.addEventListener("click", resetDefaults);
enableGroupsEl.addEventListener("change", () => updateGroupDependents(enableGroupsEl.checked));

load();
