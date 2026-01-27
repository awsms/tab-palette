chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle_palette") return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;

  console.log("[TP] toggle_palette command", { tabId: activeTab.id, windowId: activeTab.windowId });

  const settingsResp = await chrome.storage.sync.get(["tp_settings"]);
  const settings = settingsResp.tp_settings || {};
  console.log("[TP] settings", settings);
  if (settings.displayMode === "sidepanel") {
    try {
      console.log("[TP] enabling side panel");
      await chrome.sidePanel.setOptions({
        tabId: activeTab.id,
        path: "sidepanel.html",
        enabled: true
      });
      try {
        console.log("[TP] opening side panel (tabId)");
        await chrome.sidePanel.open({ tabId: activeTab.id });
      } catch {
        console.log("[TP] opening side panel (windowId)");
        await chrome.sidePanel.open({ windowId: activeTab.windowId });
      }
      console.log("[TP] side panel opened");
      return;
    } catch (err) {
      console.log("[TP] side panel failed (likely needs user gesture)", err);
      return;
    }
  }

  // Ask content script to toggle the UI; it will request tab data when needed.
  console.log("[TP] toggling overlay");
  chrome.tabs.sendMessage(activeTab.id, { type: "TP_TOGGLE" }).catch((err) => {
    console.log("[TP] content script not ready, injecting", err);
    // If content script isn't ready (rare), inject it and retry.
    chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content_script.js"]
    }).then(() => {
      console.log("[TP] injected content script");
      chrome.tabs.sendMessage(activeTab.id, { type: "TP_TOGGLE" }).catch((err2) => {
        console.log("[TP] toggle after inject failed", err2);
      });
    }).catch((err2) => {
      console.log("[TP] inject failed", err2);
    });
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
    const settingsResp = await chrome.storage.sync.get(["tp_settings"]);
    const settings = settingsResp.tp_settings || {};
    if (settings.displayMode !== "sidepanel") {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "TP_TOGGLE" });
      return;
    }
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
  if (msg?.type === "TP_OPEN_SIDEPANEL") {
    (async () => {
      try {
        const tabId = sender?.tab?.id;
        const windowId = sender?.tab?.windowId;
        if (typeof tabId !== "number") return sendResponse({ ok: false });
        await chrome.sidePanel.setOptions({
          tabId,
          path: "sidepanel.html",
          enabled: true
        });
        try {
          await chrome.sidePanel.open({ tabId });
        } catch {
          if (typeof windowId === "number") {
            await chrome.sidePanel.open({ windowId });
          }
        }
        sendResponse({ ok: true });
      } catch (err) {
        console.log("[TP] side panel open via keydown failed", err);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
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
        favIconUrl: t.favIconUrl || "",
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
