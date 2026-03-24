chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle_palette") return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;

  console.log("[TP] toggle_palette command", { tabId: activeTab.id, windowId: activeTab.windowId });
  // Ask content script to toggle the UI; it will request tab data when needed.
  chrome.tabs.sendMessage(activeTab.id, { type: "TP_TOGGLE" }).catch((err) => {
    // If content script isn't ready (rare), inject it and retry.
    chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content_script.js"]
    }).then(() => {
      chrome.tabs.sendMessage(activeTab.id, { type: "TP_TOGGLE" }).catch((err2) => {
      });
    }).catch(() => {});
  });
});

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // ignore
  }
});

if (chrome.action && chrome.action.onClicked) {
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidepanel.html",
      enabled: true
    });
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    // ignore
  }
});
}

// Provide tab data on demand (so content script stays lightweight)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "TP_GET_TABS") {
    (async () => {
      const currentWindow = msg.currentWindow !== false;

      const tabs = await chrome.tabs.query(currentWindow ? { currentWindow: true } : {});
      const groupIds = Array.from(
        new Set(tabs.map(t => t.groupId).filter(id => typeof id === "number" && id >= 0))
      );
      const groupMap = {};
      await Promise.all(groupIds.map(async (id) => {
        try {
          const g = await chrome.tabGroups.get(id);
          groupMap[id] = {
            id,
            title: g.title || "",
            color: g.color || "",
            collapsed: !!g.collapsed
          };
        } catch {
          // ignore missing/permission errors
        }
      }));
      // Normalize fields for the UI
      const payload = tabs.map(t => ({
        id: t.id,
        windowId: t.windowId,
        index: t.index,
        active: !!t.active,
        pinned: !!t.pinned,
        title: t.title || "",
        url: t.url || "",
        favIconUrl: `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(t.url || "")}&size=32`,
        audible: !!t.audible,
        muted: !!t.mutedInfo?.muted,
        lastAccessed: t.lastAccessed || 0,
        groupId: typeof t.groupId === "number" ? t.groupId : -1,
        groupTitle: groupMap[t.groupId]?.title || "",
        groupColor: groupMap[t.groupId]?.color || "",
        groupCollapsed: groupMap[t.groupId]?.collapsed || false
      }));

      sendResponse({ ok: true, tabs: payload });
    })();

    // async response
    return true;
  }

  if (msg?.type === "TP_ACTIVATE_TAB") {
    (async () => {
      const { tabId, windowId } = msg;
      if (typeof tabId !== "number") return sendResponse({ ok: false });

      try {
        // Focus window first (helps if activating a tab in another window)
        if (typeof windowId === "number") {
          await chrome.windows.update(windowId, { focused: true });
        }
        await chrome.tabs.update(tabId, { active: true });
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg?.type === "TP_CLOSE_TAB") {
    (async () => {
      const { tabId } = msg;
      if (typeof tabId !== "number") return sendResponse({ ok: false });
      try {
        await chrome.tabs.remove(tabId);
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg?.type === "TP_CLOSE_TABS") {
    (async () => {
      const { tabIds } = msg;
      if (!Array.isArray(tabIds) || tabIds.length === 0) return sendResponse({ ok: false });
      try {
        await chrome.tabs.remove(tabIds);
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg?.type === "TP_GET_ZOOM") {
    (async () => {
      try {
        const tabId = sender?.tab?.id;
        if (typeof tabId !== "number") return sendResponse({ ok: false });
        const zoom = await chrome.tabs.getZoom(tabId);
        sendResponse({ ok: true, zoom });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  return false;
});

async function buildTabPayload(t) {
  let groupTitle = "";
  let groupColor = "";
  let groupCollapsed = false;
  if (typeof t.groupId === "number" && t.groupId >= 0) {
    try {
      const g = await chrome.tabGroups.get(t.groupId);
      groupTitle = g.title || "";
      groupColor = g.color || "";
      groupCollapsed = !!g.collapsed;
    } catch {
      // ignore
    }
  }
  return {
    id: t.id,
    windowId: t.windowId,
    index: t.index,
    active: !!t.active,
    pinned: !!t.pinned,
    title: t.title || "",
    url: t.url || "",
    favIconUrl: `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(t.url || "")}&size=32`,
    audible: !!t.audible,
    muted: !!t.mutedInfo?.muted,
    lastAccessed: t.lastAccessed || 0,
    groupId: typeof t.groupId === "number" ? t.groupId : -1,
    groupTitle,
    groupColor,
    groupCollapsed
  };
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab?.id) return;
  const keys = ["audible", "mutedInfo", "title", "favIconUrl", "url", "groupId"];
  const changed = keys.some(k => k in changeInfo);
  if (!changed) return;
  const payload = await buildTabPayload(tab);
  chrome.runtime.sendMessage({ type: "TP_TAB_UPDATE", tab: payload }).catch(() => {});
  if (typeof tab.windowId === "number") {
    chrome.tabs.query({ active: true, windowId: tab.windowId }).then((tabs) => {
      const active = tabs[0];
      if (!active?.id) return;
      chrome.tabs.sendMessage(active.id, { type: "TP_TAB_UPDATE", tab: payload }).catch(() => {});
    }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async (info) => {
  if (!info?.tabId) return;
  try {
    const tab = await chrome.tabs.get(info.tabId);
    if (!tab?.id) return;
    const payload = await buildTabPayload(tab);
    chrome.runtime.sendMessage({ type: "TP_TAB_UPDATE", tab: payload }).catch(() => {});
  } catch {
    // ignore
  }
});
