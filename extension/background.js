// background.js - Manifest V3 service worker

// Inject notification UI and show AI check result
function showNotification(tabId, aiPercent, message) {
  const notifCode = `
    (function() {
      if (document.getElementById('vectora-notification')) return; // Prevent duplicates
      
      const style = document.createElement('style');
      style.textContent = \`
        #vectora-notification {
          position: fixed;
          top: 24px;
          right: 24px;
          z-index: 999999;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border: 1px solid rgba(0, 243, 255, 0.3);
          border-radius: 12px;
          padding: 16px 20px;
          min-width: 280px;
          max-width: 320px;
          box-shadow: 0 8px 32px rgba(0, 243, 255, 0.15), 0 0 20px rgba(0, 0, 0, 0.5);
          font-family: 'Segoe UI', Tahoma, Geneva, sans-serif;
          color: #e0e0e0;
          backdrop-filter: blur(8px);
          animation: vectoraSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        @keyframes vectoraSlideIn {
          from {
            opacity: 0;
            transform: translateX(360px) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0) translateY(0);
          }
        }
        
        .vectora-ai-percent {
          font-size: 32px;
          font-weight: 900;
          color: #00f3ff;
          text-shadow: 0 0 10px rgba(0, 243, 255, 0.5);
          margin-bottom: 6px;
          letter-spacing: -1px;
        }
        
        .vectora-label {
          font-size: 11px;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 10px;
          font-weight: 600;
        }
        
        .vectora-message {
          font-size: 13px;
          color: #b0b0b0;
          margin-bottom: 12px;
          line-height: 1.4;
        }
        
        .vectora-powered {
          font-size: 10px;
          color: #666;
          text-align: right;
          font-weight: 500;
          letter-spacing: 0.5px;
        }
        
        @media (max-width: 480px) {
          #vectora-notification {
            top: 12px;
            right: 12px;
            min-width: 240px;
            padding: 12px 14px;
          }
          .vectora-ai-percent {
            font-size: 28px;
          }
        }
      \`;
      document.head.appendChild(style);
      
      const notif = document.createElement('div');
      notif.id = 'vectora-notification';
      notif.innerHTML = \`
        <div class="vectora-label">AI Involvement</div>
        <div class="vectora-ai-percent">\${Math.round(arguments[0])}%</div>
        <div class="vectora-message">\${arguments[1]}</div>
        <div class="vectora-powered">Powered by Vectora</div>
      \`;
      document.body.appendChild(notif);
      
      // Auto-remove after 4.5 seconds
      setTimeout(() => {
        notif.style.animation = 'vectoraSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) reverse';
        setTimeout(() => notif.remove(), 300);
      }, 4500);
    })(\${aiPercent}, \`\${message}\`);
  \`;
  
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: new Function(notifCode)
  });
}

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
      showNotification(tab.id, 0, 'Please select text to analyze');
      return;
    }
    
    const result = await postToBackend({ text: selectedText });
    const ai_percent = result.ai_percent || 50;
    const message = result.message || 'Analysis complete';
    
    showNotification(tab.id, ai_percent, message);
    chrome.storage.local.set({ lastCheck: result });
  }

  if(info.menuItemId === 'vectora-check-image'){
    const srcUrl = info.srcUrl || '';
    if(!srcUrl){
      showNotification(tab.id, 0, 'Could not extract image');
      return;
    }
    
    const result = await postToBackend({ image_url: srcUrl });
    const ai_percent = result.ai_percent || 50;
    const message = result.message || 'Analysis complete';
    
    showNotification(tab.id, ai_percent, message);
    chrome.storage.local.set({ lastCheck: result });
  }
});
