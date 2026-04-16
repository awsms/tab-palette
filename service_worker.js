const extensionApi = globalThis.browser ?? globalThis.chrome;
const isFirefox = typeof globalThis.browser !== "undefined";
const hasTabGroups = !!extensionApi.tabGroups?.get;
const hasSidePanel = !!extensionApi.sidePanel?.open;
const hasChromeFavicon = !!(globalThis.chrome?.runtime?.id && !isFirefox);

async function toggleInTab(tabId) {
  await extensionApi.tabs.sendMessage(tabId, { type: "TP_TOGGLE" });
}

async function ensureContentScript(tabId) {
  await extensionApi.scripting.executeScript({
    target: { tabId },
    files: ["content_script.js"]
  });
}

async function togglePaletteInActiveTab() {
  const [activeTab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;
  try {
    await toggleInTab(activeTab.id);
  } catch {
    try {
      await ensureContentScript(activeTab.id);
      await toggleInTab(activeTab.id);
    } catch {
      // ignore failed injection on restricted pages
    }
  }
}

function getTabFaviconUrl(tab) {
  if (hasChromeFavicon && tab?.url) {
    return `chrome-extension://${extensionApi.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=32`;
  }
  return tab?.favIconUrl || "";
}

async function getGroupMap(tabs) {
  if (!hasTabGroups) return {};
  const groupIds = Array.from(
    new Set(tabs.map((tab) => tab.groupId).filter((id) => typeof id === "number" && id >= 0))
  );
  const groupMap = {};
  await Promise.all(groupIds.map(async (id) => {
    try {
      const group = await extensionApi.tabGroups.get(id);
      groupMap[id] = {
        id,
        title: group.title || "",
        color: group.color || "",
        collapsed: !!group.collapsed
      };
    } catch {
      // ignore missing groups or unsupported cases
    }
  }));
  return groupMap;
}

function toTabPayload(tab, groupMap = {}) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    active: !!tab.active,
    pinned: !!tab.pinned,
    title: tab.title || "",
    url: tab.url || "",
    favIconUrl: getTabFaviconUrl(tab),
    audible: !!tab.audible,
    muted: !!tab.mutedInfo?.muted,
    lastAccessed: tab.lastAccessed || 0,
    groupId: typeof tab.groupId === "number" ? tab.groupId : -1,
    groupTitle: groupMap[tab.groupId]?.title || "",
    groupColor: groupMap[tab.groupId]?.color || "",
    groupCollapsed: groupMap[tab.groupId]?.collapsed || false
  };
}

async function buildTabPayload(tab) {
  const groupMap = await getGroupMap([tab]);
  return toTabPayload(tab, groupMap);
}

extensionApi.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle_palette") return;
  await togglePaletteInActiveTab();
});

extensionApi.runtime.onInstalled.addListener(() => {
  if (!hasSidePanel) return;
  try {
    extensionApi.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // ignore
  }
});

if (extensionApi.action?.onClicked) {
  extensionApi.action.onClicked.addListener(async (tab) => {
    if (!tab?.id) return;
    if (hasSidePanel) {
      try {
        await extensionApi.sidePanel.setOptions({
          tabId: tab.id,
          path: "sidepanel.html",
          enabled: true
        });
        await extensionApi.sidePanel.open({ tabId: tab.id });
        return;
      } catch {
        // fall back to overlay mode
      }
    }
    try {
      await toggleInTab(tab.id);
    } catch {
      try {
        await ensureContentScript(tab.id);
        await toggleInTab(tab.id);
      } catch {
        // ignore failed injection on restricted pages
      }
    }
  });
}

async function handleMessage(msg, sender) {
  if (msg?.type === "TP_GET_TABS") {
    const currentWindow = msg.currentWindow !== false;
    const tabs = await extensionApi.tabs.query(currentWindow ? { currentWindow: true } : {});
    const groupMap = await getGroupMap(tabs);
    return { ok: true, tabs: tabs.map((tab) => toTabPayload(tab, groupMap)) };
  }

  if (msg?.type === "TP_ACTIVATE_TAB") {
    const { tabId, windowId } = msg;
    if (typeof tabId !== "number") return { ok: false };
    try {
      if (typeof windowId === "number") {
        await extensionApi.windows.update(windowId, { focused: true });
      }
      await extensionApi.tabs.update(tabId, { active: true });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  if (msg?.type === "TP_CLOSE_TAB") {
    if (typeof msg.tabId !== "number") return { ok: false };
    try {
      await extensionApi.tabs.remove(msg.tabId);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  if (msg?.type === "TP_CLOSE_TABS") {
    if (!Array.isArray(msg.tabIds) || msg.tabIds.length === 0) return { ok: false };
    try {
      await extensionApi.tabs.remove(msg.tabIds);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  if (msg?.type === "TP_GET_ZOOM") {
    try {
      const tabId = sender?.tab?.id;
      if (typeof tabId !== "number") return { ok: false };
      const zoom = await extensionApi.tabs.getZoom(tabId);
      return { ok: true, zoom };
    } catch {
      return { ok: false };
    }
  }

  return false;
}

if (isFirefox) {
  extensionApi.runtime.onMessage.addListener((msg, sender) => handleMessage(msg, sender));
} else {
  extensionApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  });
}

extensionApi.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (!tab?.id) return;
  const keys = ["audible", "mutedInfo", "title", "favIconUrl", "url", "groupId"];
  if (!keys.some((key) => key in changeInfo)) return;

  const payload = await buildTabPayload(tab);
  extensionApi.runtime.sendMessage({ type: "TP_TAB_UPDATE", tab: payload }).catch(() => {});

  if (typeof tab.windowId === "number") {
    extensionApi.tabs.query({ active: true, windowId: tab.windowId }).then((tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) return;
      extensionApi.tabs.sendMessage(activeTab.id, { type: "TP_TAB_UPDATE", tab: payload }).catch(() => {});
    }).catch(() => {});
  }
});

extensionApi.tabs.onActivated.addListener(async (info) => {
  if (!info?.tabId) return;
  try {
    const tab = await extensionApi.tabs.get(info.tabId);
    if (!tab?.id) return;
    const payload = await buildTabPayload(tab);
    extensionApi.runtime.sendMessage({ type: "TP_TAB_UPDATE", tab: payload }).catch(() => {});
  } catch {
    // ignore
  }
});
