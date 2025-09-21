// popup.js

async function renderLast(){
  const data = await new Promise((resolve) => {
    chrome.storage.local.get(['lastCheck'], (res) => resolve(res.lastCheck));
  });
  const content = document.getElementById('content');
  if(!data){ content.textContent = 'No checks yet.'; return }
  content.innerHTML = `<div class="result"><div class="percent">${data.ai_percent}%</div><div>${data.message}</div></div>`;
}

renderLast();
