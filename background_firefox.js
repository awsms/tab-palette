const extensionApi = globalThis.browser || globalThis.chrome;

extensionApi.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle_palette") return;

  const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab?.id) return;

  try {
    await extensionApi.tabs.sendMessage(activeTab.id, { type: "TP_TOGGLE" });
  } catch {
    try {
      await extensionApi.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ["content_script.js"]
      });
      await extensionApi.tabs.sendMessage(activeTab.id, { type: "TP_TOGGLE" });
    } catch {
      // ignore failed injection on restricted pages
    }
  }
});

if (extensionApi.action?.onClicked) {
  extensionApi.action.onClicked.addListener(async (tab) => {
    if (!tab?.id) return;
    try {
      await extensionApi.tabs.sendMessage(tab.id, { type: "TP_TOGGLE" });
    } catch {
      try {
        await extensionApi.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content_script.js"]
        });
        await extensionApi.tabs.sendMessage(tab.id, { type: "TP_TOGGLE" });
      } catch {
        // ignore failed injection on restricted pages
      }
    }
  });
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
    favIconUrl: tab.favIconUrl || "",
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
  let groupTitle = "";
  let groupColor = "";
  let groupCollapsed = false;
  if (typeof tab.groupId === "number" && tab.groupId >= 0) {
    try {
      const group = await extensionApi.tabGroups.get(tab.groupId);
      groupTitle = group.title || "";
      groupColor = group.color || "";
      groupCollapsed = !!group.collapsed;
    } catch {
      // ignore missing groups or unsupported cases
    }
  }

  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    active: !!tab.active,
    pinned: !!tab.pinned,
    title: tab.title || "",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || "",
    audible: !!tab.audible,
    muted: !!tab.mutedInfo?.muted,
    lastAccessed: tab.lastAccessed || 0,
    groupId: typeof tab.groupId === "number" ? tab.groupId : -1,
    groupTitle,
    groupColor,
    groupCollapsed
  };
}

extensionApi.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "TP_GET_TABS") {
    return (async () => {
      const currentWindow = msg.currentWindow !== false;
      const tabs = await extensionApi.tabs.query(currentWindow ? { currentWindow: true } : {});
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

      return { ok: true, tabs: tabs.map((tab) => toTabPayload(tab, groupMap)) };
    })();
  }

  if (msg?.type === "TP_ACTIVATE_TAB") {
    return (async () => {
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
    })();
  }

  if (msg?.type === "TP_CLOSE_TAB") {
    return (async () => {
      if (typeof msg.tabId !== "number") return { ok: false };
      try {
        await extensionApi.tabs.remove(msg.tabId);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    })();
  }

  if (msg?.type === "TP_CLOSE_TABS") {
    return (async () => {
      if (!Array.isArray(msg.tabIds) || msg.tabIds.length === 0) return { ok: false };
      try {
        await extensionApi.tabs.remove(msg.tabIds);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    })();
  }

  if (msg?.type === "TP_GET_ZOOM") {
    return (async () => {
      try {
        const tabId = sender?.tab?.id;
        if (typeof tabId !== "number") return { ok: false };
        const zoom = await extensionApi.tabs.getZoom(tabId);
        return { ok: true, zoom };
      } catch {
        return { ok: false };
      }
    })();
  }

  return false;
});

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
