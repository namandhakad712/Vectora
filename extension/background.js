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
    // Use Vercel production URL or local fallback
    const endpoint = 'https://vectora.vercel.app/ai-check' || 'http://127.0.0.1:5001/ai-check';
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15000
    });
    
    if(!resp.ok){
      return { error: 'Server error: ' + resp.status, ai_percent: 50, message: 'Unable to reach analysis server' };
    }
    const data = await resp.json();
    return data || { error: 'No response', ai_percent: 50, message: 'Analysis unavailable' };
  }catch(e){
    return { error: String(e), ai_percent: 50, message: 'Network error - please try again' };
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if(info.menuItemId === 'vectora-check-text'){
    const selectedText = info.selectionText || '';
    if(!selectedText.trim()){
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => alert('Please select some text to check.')
      });
      return;
    }
    
    const result = await postToBackend({ text: selectedText });
    const ai_percent = result.ai_percent || 50;
    const message = result.message || 'Analysis complete';
    const msg = `AI Involvement: ${ai_percent}%\n${message}`;
    
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (m) => alert(m),
      args: [msg]
    });
    chrome.storage.local.set({ lastCheck: result });
  }

  if(info.menuItemId === 'vectora-check-image'){
    const srcUrl = info.srcUrl || '';
    if(!srcUrl){
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => alert('Could not extract image URL.')
      });
      return;
    }
    
    const result = await postToBackend({ image_url: srcUrl });
    const ai_percent = result.ai_percent || 50;
    const message = result.message || 'Analysis complete';
    const msg = `AI Involvement: ${ai_percent}%\n${message}`;
    
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (m) => alert(m),
      args: [msg]
    });
    chrome.storage.local.set({ lastCheck: result });
  }
});
