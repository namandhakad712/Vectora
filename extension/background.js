// background.js - Manifest V3 service worker

chrome.runtime.onInstalled.addListener(() => {
  // create context menu for selected text
  chrome.contextMenus.create({
    id: 'vectora-check-text',
    title: 'Check AI Authenticity',
    contexts: ['selection']
  });

  // create context menu for images
  chrome.contextMenus.create({
    id: 'vectora-check-image',
    title: 'Check AI Authenticity',
    contexts: ['image']
  });
});

async function postToBackend(payload){
  try{
    // For local testing: http://127.0.0.1:5001/ai-check
    // For Vercel production: https://YOUR-VERCEL-APP.vercel.app/ai-check
    const resp = await fetch('http://127.0.0.1:5001/ai-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!resp.ok){
      return { error: 'Network error: ' + resp.status };
    }
    return await resp.json();
  }catch(e){
    return { error: String(e) };
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if(info.menuItemId === 'vectora-check-text'){
    const selectedText = info.selectionText || '';
    const result = await postToBackend({ text: selectedText });
    if(result && result.error){
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (msg) => alert(msg),
        args: [result.error]
      });
    } else {
      const msg = `AI Likelihood: ${result.ai_percent}% — ${result.message}`;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (m) => alert(m),
        args: [msg]
      });
      // store last result
      chrome.storage.local.set({ lastCheck: result });
    }
  }

  if(info.menuItemId === 'vectora-check-image'){
    const srcUrl = info.srcUrl || '';
    const result = await postToBackend({ image_url: srcUrl });
    if(result && result.error){
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (msg) => alert(msg),
        args: [result.error]
      });
    } else {
      const msg = `AI Likelihood: ${result.ai_percent}% — ${result.message}`;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (m) => alert(m),
        args: [msg]
      });
      chrome.storage.local.set({ lastCheck: result });
    }
  }
});
