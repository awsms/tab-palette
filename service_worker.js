// service_worker.js (MV3)

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle_palette") return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;

  // Ask content script to toggle the UI; it will request tab data when needed.
  chrome.tabs.sendMessage(activeTab.id, { type: "TP_TOGGLE" }).catch(() => {
    // If content script isn't ready (rare), inject it and retry.
    chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content_script.js"]
    }).then(() => {
      chrome.tabs.sendMessage(activeTab.id, { type: "TP_TOGGLE" }).catch(() => {});
    }).catch(() => {});
  });
});

// Provide tab data on demand (so content script stays lightweight)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "TP_GET_TABS") {
    (async () => {
      const currentWindow = msg.currentWindow !== false;

      const tabs = await chrome.tabs.query(currentWindow ? { currentWindow: true } : {});
      // Normalize fields for the UI
      const payload = tabs.map(t => ({
        id: t.id,
        windowId: t.windowId,
        index: t.index,
        active: !!t.active,
        pinned: !!t.pinned,
        title: t.title || "",
        url: t.url || "",
        favIconUrl: t.favIconUrl || ""
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

  return false;
});
