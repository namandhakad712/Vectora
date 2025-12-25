// background.js - Standalone service worker for Vectora AI Check Extension
// ULTRA USELESS CONCEPT OF USING SERVER TO USE A EXTENSION.
// No backend server required - makes direct API calls to AI providers

// Settings
let settings = {
  provider: 'gemini',
  cerebras_api_key: '',
  cerebras_model: 'llama-3.3-70b',
  gemini_api_key: '',
  gemini_model: 'gemini-2.0-flash-exp',
  groq_api_key: '',
  groq_model: 'llama-3.3-70b-versatile'
};

// Load settings on startup
loadSettings();

function loadSettings() {
  chrome.storage.sync.get([
    'provider',
    'cerebras_api_key',
    'cerebras_model',
    'gemini_api_key',
    'gemini_model',
    'groq_api_key',
    'groq_model'
  ], (result) => {
    settings = { ...settings, ...result };
    console.log('Settings loaded:', { ...settings, cerebras_api_key: '***', gemini_api_key: '***', groq_api_key: '***' });
  });
}

// Listen for messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'settingsUpdated') {
    loadSettings();
    sendResponse({ success: true });
  }

  // Handle text analysis from popup/content script
  else if (message.action === 'analyzeText') {
    console.log('Text analysis requested:', message.text.substring(0, 50) + '...');

    const apiKey = settings[`${settings.provider}_api_key`];
    if (!apiKey) {
      const errorMsg = 'Please configure API key in settings';
      sendResponse({ success: false, message: errorMsg });

      // Show error notification
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) showNotification(tabs[0].id, 0, errorMsg);
      });

      return true;
    }

    console.log('Calling analyzeText with provider:', settings.provider);

    analyzeText(message.text).then(result => {
      console.log('Analysis result:', result);
      sendResponse({ success: true, ...result });

      // Show notification on active tab and save history
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          showNotification(tabs[0].id, result.ai_percent, result.message);
          saveToHistory(tabs[0].url, 'text', result);
        }
      });
    }).catch(error => {
      console.error('Text analysis error:', error);
      const errorMsg = `Error: ${error.message}`;
      sendResponse({ success: false, message: errorMsg });

      // Show error notification
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) showNotification(tabs[0].id, 0, errorMsg);
      });
    });

    return true; // Keep channel open for async response
  }

  // Handle image analysis from content script
  else if (message.action === 'analyzeImage') {
    const apiKey = settings[`${settings.provider}_api_key`];
    if (!apiKey) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) showNotification(tabs[0].id, 0, 'Please configure API key in settings');
      });
      return true;
    }

    analyzeImage(message.imageUrl).then(result => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          showNotification(tabs[0].id, result.ai_percent, result.message);
          chrome.storage.local.set({ lastCheck: result });
          saveToHistory(tabs[0].url, 'image', result);
        }
      });
    }).catch(error => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) showNotification(tabs[0].id, 0, `Error: ${error.message}`);
      });
    });

    return true;
  }

  // Handle screen capture
  else if (message.action === 'captureVisibleTab') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('Capture error:', chrome.runtime.lastError);
        return;
      }

      // Crop and analyze
      cropAndAnalyze(dataUrl, message.crop);
    });

    return true;
  }

  // Get model capabilities (for popup validation)
  else if (message.action === 'getModelCapabilities') {
    const provider = message.provider || settings.provider;
    const model = message.model || settings[`${provider}_model`];

    // Determine capabilities based on provider and model (matching main.py)
    let capabilities = ['text']; // All models support text

    if (provider === 'gemini') {
      // Gemini 1.5+ supports everything
      capabilities.push('image', 'web_search');
    }
    else if (provider === 'groq') {
      // Groq models: EITHER image OR web_search, not both

      // Vision models (TEXT + IMAGE)
      if (model && (
        model.includes('llama-guard') ||
        model.includes('llama-4-maverick') ||
        model.includes('llama-4-scout') ||
        model.includes('vision')
      )) {
        capabilities.push('image');
      }

      // Compound & OSS models (TEXT + WEB SEARCH)
      else if (model && (
        model.includes('compound') ||
        model.includes('gpt-oss')
      )) {
        capabilities.push('web_search');
      }
    }
    // Cerebras is text-only (no additional capabilities)

    sendResponse({ capabilities });
    return true;
  }

  return false;
});

// Save usage history
async function saveToHistory(url, feature, result) {
  try {
    const history = await chrome.storage.local.get('usageHistory');
    const historyList = history.usageHistory || [];

    // Add new entry
    historyList.unshift({
      url: url,
      feature: feature, // 'text', 'image', or 'screen'
      ai_percent: result.ai_percent,
      message: result.message,
      timestamp: Date.now(),
      provider: settings.provider,
      model: settings[`${settings.provider}_model`]
    });

    // Keep only last 50 entries
    if (historyList.length > 50) {
      historyList.splice(50);
    }

    await chrome.storage.local.set({ usageHistory: historyList });
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}


// Crop captured image and analyze
async function cropAndAnalyze(dataUrl, crop) {
  try {
    console.log('Cropping screenshot...', crop);

    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Create ImageBitmap (works in service worker)
    const imageBitmap = await createImageBitmap(blob);

    // Validate crop dimensions
    const actualWidth = Math.min(crop.width, imageBitmap.width - crop.x);
    const actualHeight = Math.min(crop.height, imageBitmap.height - crop.y);

    console.log('Image dimensions:', imageBitmap.width, imageBitmap.height);
    console.log('Crop area:', crop.x, crop.y, actualWidth, actualHeight);

    // Create canvas and crop
    const canvas = new OffscreenCanvas(actualWidth, actualHeight);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(
      imageBitmap,
      crop.x, crop.y, actualWidth, actualHeight,
      0, 0, actualWidth, actualHeight
    );

    const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
    const croppedDataUrl = await blobToDataUrl(croppedBlob);

    console.log('Cropped image created, analyzing...');

    // Analyze cropped image
    const result = await analyzeImageFromDataUrl(croppedDataUrl);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        showNotification(tabs[0].id, result.ai_percent, result.message);
        chrome.storage.local.set({ lastCheck: result });
        saveToHistory(tabs[0].url, 'screen', result);
      }
    });
  } catch (error) {
    console.error('Crop and analyze error:', error);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) showNotification(tabs[0].id, 0, `Error: ${error.message}`);
    });
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}


// Initialize context menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // Text selection menu
    chrome.contextMenus.create({
      id: 'vectora-check-text',
      title: 'Check AI Authenticity',
      contexts: ['selection']
    });

    // Image menu
    chrome.contextMenus.create({
      id: 'vectora-check-image',
      title: 'Check AI Authenticity',
      contexts: ['image']
    });
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'vectora-check-text') {
      const selectedText = info.selectionText || '';

      if (!selectedText.trim()) {
        showNotification(tab.id, 0, 'Please select text to analyze');
        return;
      }

      // Check if API key is configured
      const apiKey = settings[`${settings.provider}_api_key`];
      if (!apiKey) {
        showNotification(tab.id, 0, 'Please configure API key in extension settings');
        return;
      }

      showNotification(tab.id, 0, 'Analyzing text...');

      const result = await analyzeText(selectedText);

      showNotification(tab.id, result.ai_percent, result.message);
      chrome.storage.local.set({ lastCheck: result });
    }

    else if (info.menuItemId === 'vectora-check-image') {
      const srcUrl = info.srcUrl || '';

      if (!srcUrl) {
        showNotification(tab.id, 0, 'Could not extract image URL');
        return;
      }

      const apiKey = settings[`${settings.provider}_api_key`];
      if (!apiKey) {
        showNotification(tab.id, 0, 'Please configure API key in extension settings');
        return;
      }

      showNotification(tab.id, 0, 'Analyzing image...');

      const result = await analyzeImage(srcUrl);

      showNotification(tab.id, result.ai_percent, result.message);
      chrome.storage.local.set({ lastCheck: result });
    }
  } catch (error) {
    console.error('Context menu error:', error);
    showNotification(tab.id, 0, `Error: ${error.message}`);
  }
});

// Analyze text using selected AI provider
async function analyzeText(text) {
  const provider = settings.provider;
  const apiKey = settings[`${provider}_api_key`];
  const model = settings[`${provider}_model`];

  const prompt = `Analyze this text and determine the likelihood it was generated by AI.

Text to analyze:
${text}

Respond with ONLY a JSON object (no markdown, no extra text):
{"ai_percent": <0-100>, "reason": "<brief explanation>"}

Consider: writing style, unusual patterns, perfect grammar, repetitive phrases, lack of human emotion/opinions, generic content.
Return a percentage 0-100 where:
- 0-20%: Clearly human written
- 21-40%: Likely human with possible AI assistance
- 41-60%: Mixed or unclear
- 61-80%: Likely AI-generated
- 81-100%: Almost certainly AI-generated`;

  try {
    let response;

    if (provider === 'cerebras') {
      response = await callCerebrasAPI(apiKey, model, prompt);
    } else if (provider === 'gemini') {
      response = await callGeminiAPI(apiKey, model, prompt);
    } else if (provider === 'groq') {
      response = await callGroqAPI(apiKey, model, prompt);
    }

    return parseAIResponse(response);
  } catch (error) {
    console.error('Analysis error:', error);
    throw error; // NO FAKE DATA - throw real error
  }
}

// Analyze image using selected AI provider
async function analyzeImage(imageUrl) {
  const provider = settings.provider;
  const apiKey = settings[`${provider}_api_key`];
  const model = settings[`${provider}_model`];

  const prompt = `Analyze this image and determine the likelihood it was AI-generated.

Respond with ONLY a JSON object (no markdown, no extra text):
{"ai_percent": <0-100>, "reason": "<brief explanation>"}

Consider: artifacts, unnatural patterns, weird textures, impossible physics, watermarks, AI tool signatures.
Return 0-100 where 0=clearly real, 100=certainly AI-generated.`;

  try {
    // Download image and convert to base64
    const imageData = await downloadImage(imageUrl);

    let response;

    if (provider === 'gemini') {
      response = await callGeminiVisionAPI(apiKey, model, prompt, imageData);
    } else if (provider === 'groq') {
      // Check if model supports vision (TEXT + IMAGE models from main.py)
      const isVisionModel =
        model.includes('llama-guard') ||
        model.includes('llama-4-maverick') ||
        model.includes('llama-4-scout') ||
        model.includes('vision'); // Keep this for any future vision models

      if (!isVisionModel) {
        throw new Error(`Selected Groq model "${model}" does not support image analysis.\n\nSupported models:\n• llama-guard-4-12b\n• llama-4-maverick-17b-128e-instruct\n• llama-4-scout-17b-16e-instruct`);
      }
      response = await callGroqVisionAPI(apiKey, model, prompt, imageData);
    } else {
      throw new Error('Cerebras does not support image analysis. Please select Gemini or Groq with a vision model.');
    }

    return parseAIResponse(response);
  } catch (error) {
    console.error('Image analysis error:', error);
    throw error; // NO FAKE DATA - throw real error
  }
}

// Download image and convert to base64
async function downloadImage(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve({ data: base64, mimeType: blob.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    throw new Error(`Failed to download image: ${error.message}`);
  }
}

// Analyze image from data URL (for screen capture)
async function analyzeImageFromDataUrl(dataUrl) {
  const provider = settings.provider;
  const apiKey = settings[`${provider}_api_key`];
  const model = settings[`${provider}_model`];

  const prompt = `Analyze this screenshot and determine the likelihood it contains AI-generated content.

Respond with ONLY a JSON object (no markdown, no extra text):
{"ai_percent": <0-100>, "reason": "<brief explanation>"}

Consider: artifacts, unnatural patterns, AI-generated text/images, impossible elements.
Return 0-100 where 0=clearly real, 100=certainly AI-generated.`;

  try {
    // Extract base64 data from data URL
    const base64Data = dataUrl.split(',')[1];
    const mimeType = dataUrl.match(/data:(.*?);/)[1];

    const imageData = { data: base64Data, mimeType };

    let response;

    if (provider === 'gemini') {
      response = await callGeminiVisionAPI(apiKey, model, prompt, imageData);
    } else if (provider === 'groq') {
      // Check if model supports vision (TEXT + IMAGE models from main.py)
      const isVisionModel =
        model.includes('llama-guard') ||
        model.includes('llama-4-maverick') ||
        model.includes('llama-4-scout') ||
        model.includes('vision');

      if (!isVisionModel) {
        throw new Error(`Selected Groq model "${model}" does not support image analysis.`);
      }
      response = await callGroqVisionAPI(apiKey, model, prompt, imageData);
    } else {
      throw new Error('Cerebras does not support image analysis.');
    }

    return parseAIResponse(response);
  } catch (error) {
    console.error('Image analysis error:', error);
    throw error; // NO FAKE DATA - throw real error
  }
}


// API Calls

async function callCerebrasAPI(apiKey, model, prompt) {
  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 256
    })
  });

  if (!response.ok) {
    throw new Error(`Cerebras API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGeminiAPI(apiKey, model, prompt, imageData = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const parts = [{ text: prompt }];

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.3 }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callGeminiVisionAPI(apiKey, model, prompt, imageData) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const parts = [
    { text: prompt },
    {
      inline_data: {
        mime_type: imageData.mimeType,
        data: imageData.data
      }
    }
  ];

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.3 }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callGroqAPI(apiKey, model, prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 256
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGroqVisionAPI(apiKey, model, prompt, imageData) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${imageData.mimeType};base64,${imageData.data}`
            }
          }
        ]
      }],
      temperature: 0.3,
      max_tokens: 256
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Parse AI response to extract percentage and reason
function parseAIResponse(text) {
  try {
    // Clean markdown code blocks
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    // Try to find JSON in response
    const jsonMatch = text.match(/\{.*?\}/s);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[0]);

      // NO FAKE DATA - must have real ai_percent from AI
      if (json.ai_percent === undefined || json.ai_percent === null) {
        throw new Error('AI response missing ai_percent field');
      }

      return {
        ai_percent: Math.min(100, Math.max(0, parseInt(json.ai_percent))),
        message: json.reason || 'Analysis complete'
      };
    }

    // Fallback: extract from text
    const percentMatch = text.match(/(\d+)%/);
    if (!percentMatch) {
      throw new Error(`AI response has no percentage. Response: ${text.substring(0, 200)}`);
    }

    return {
      ai_percent: Math.min(100, Math.max(0, parseInt(percentMatch[1]))),
      message: text.substring(0, 200)
    };
  } catch (error) {
    console.error('Failed to parse AI response:', text);
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }
}

// Show notification overlay
function showNotification(tabId, aiPercent, message) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: injectNotification,
    args: [aiPercent, message]
  }).catch(err => console.error('Notification error:', err));
}

// Injected notification function
function injectNotification(percent, msg) {
  const existing = document.getElementById('vectora-notification');
  if (existing) existing.remove();

  if (!document.getElementById('vectora-styles')) {
    const style = document.createElement('style');
    style.id = 'vectora-styles';
    style.textContent = `
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
      max-width: 400px;
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
        word-break: break-word;
      }
      .vectora-powered {
        font-size: 10px;
        color: #666;
        text-align: right;
        font-weight: 500;
        letter-spacing: 0.5px;
      }
    `;
    document.head.appendChild(style);
  }

  const notif = document.createElement('div');
  notif.id = 'vectora-notification';
  notif.innerHTML = `
    <div class="vectora-label">AI Involvement</div>
    <div class="vectora-ai-percent">${Math.round(percent)}%</div>
    <div class="vectora-message">${msg}</div>
    <div class="vectora-powered">Powered by Vectora</div>
  `;
  document.body.appendChild(notif);

  setTimeout(() => {
    notif.style.opacity = '0';
    notif.style.transition = 'opacity 0.3s ease-out';
    setTimeout(() => {
      if (notif.parentNode) notif.remove();
    }, 300);
  }, 5000);
}
