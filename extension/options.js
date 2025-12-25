// options.js - Live model fetching from APIs (like check.html)

let currentProvider = 'gemini';
let availableModels = { cerebras: [], gemini: [], groq: [] };
let selectedModels = { cerebras: '', gemini: '', groq: '' };

// UI Elements
const tabs = document.querySelectorAll('.tab');
const sections = document.querySelectorAll('.config-section');
const saveBtn = document.getElementById('save-btn');
const testBtn = document.getElementById('test-btn');
const status = document.getElementById('status');

// API Key Inputs
const cerebrasKey = document.getElementById('cerebras-key');
const geminiKey = document.getElementById('gemini-key');
const groqKey = document.getElementById('groq-key');

// Model Dropdowns
const providers = ['cerebras', 'gemini', 'groq'];
const triggers = {};
const dropdowns = {};
const selectedSpans = {};

providers.forEach(p => {
    triggers[p] = document.getElementById(`${p}-trigger`);
    dropdowns[p] = document.getElementById(`${p}-dropdown`);
    selectedSpans[p] = document.getElementById(`${p}-selected`);

    triggers[p].addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllDropdowns();
        dropdowns[p].classList.toggle('open');
    });
});

document.addEventListener('click', () => closeAllDropdowns());

function closeAllDropdowns() {
    providers.forEach(p => dropdowns[p].classList.remove('open'));
}

// Tab switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        switchProvider(tab.dataset.provider);
    });
});

function switchProvider(provider) {
    currentProvider = provider;
    tabs.forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-provider="${provider}"]`).classList.add('active');
    sections.forEach(s => s.classList.remove('active'));
    document.getElementById(`${provider}-section`).classList.add('active');
}

// Load saved settings
chrome.storage.sync.get([
    'provider',
    'cerebras_api_key', 'cerebras_model',
    'gemini_api_key', 'gemini_model',
    'groq_api_key', 'groq_model'
], (result) => {
    if (result.provider) {
        currentProvider = result.provider;
        switchProvider(currentProvider);
    }

    if (result.cerebras_api_key) cerebrasKey.value = result.cerebras_api_key;
    if (result.gemini_api_key) geminiKey.value = result.gemini_api_key;
    if (result.groq_api_key) groqKey.value = result.groq_api_key;

    selectedModels.cerebras = result.cerebras_model || '';
    selectedModels.gemini = result.gemini_model || '';
    selectedModels.groq = result.groq_model || '';

    // Fetch models from APIs
    fetchAllModels();

    // Load usage history
    loadHistory();
});

// Load usage history
async function loadHistory() {
    const result = await chrome.storage.local.get('usageHistory');
    const historyList = result.usageHistory || [];

    const historyContainer = document.getElementById('history-list');

    if (historyList.length === 0) {
        historyContainer.innerHTML = '<div class="history-empty">No history yet. Start using the extension!</div>';
        return;
    }

    historyContainer.innerHTML = '';

    historyList.forEach(entry => {
        const item = document.createElement('div');
        item.className = `history-item ${entry.feature}`;

        const iconMap = {
            text: 'notepad.png',
            image: 'image-camera.png',
            screen: 'web-search.png'
        };

        const url = new URL(entry.url);
        const domain = url.hostname.replace('www.', '');
        const timeAgo = getTimeAgo(entry.timestamp);

        item.innerHTML = `
      <div class="history-feature">
        <img src="icons/${iconMap[entry.feature]}" alt="${entry.feature}">
        <span>${entry.feature}</span>
      </div>
      <div class="history-url" title="${entry.url}">${domain}</div>
      <div class="history-result">AI: ${entry.ai_percent}%</div>
      <div class="history-time">${timeAgo}</div>
    `;

        item.addEventListener('click', () => {
            chrome.tabs.create({ url: entry.url });
        });

        historyContainer.appendChild(item);
    });
}

function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

// Fetch models from all providers
async function fetchAllModels() {
    await Promise.all([
        fetchCerebrasModels(),
        fetchGeminiModels(),
        fetchGroqModels()
    ]);
}

// Fetch Cerebras models from API
async function fetchCerebrasModels() {
    selectedSpans.cerebras.textContent = 'Loading models...';

    try {
        const apiKey = cerebrasKey.value.trim();
        if (!apiKey) {
            throw new Error('API key required');
        }

        const response = await fetch('https://api.cerebras.ai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Cerebras API response: { "data": [{ "id": "llama3.1-70b" }, ...] }
        availableModels.cerebras = data.data.map(m => ({
            id: m.id,
            capabilities: ['text'] // Cerebras is text-only
        }));

        console.log('Cerebras models fetched:', availableModels.cerebras.length);

    } catch (e) {
        console.error('Cerebras fetch error:', e);
        // Only use fallback if absolutely necessary
        availableModels.cerebras = [];
        selectedSpans.cerebras.textContent = 'Enter API key to load models';
        return;
    }

    renderModelDropdown('cerebras');
}

// Fetch Gemini models from API
async function fetchGeminiModels() {
    selectedSpans.gemini.textContent = 'Loading models...';

    try {
        const apiKey = geminiKey.value.trim();
        if (!apiKey) {
            throw new Error('API key required');
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Filter for models that support generateContent
        availableModels.gemini = data.models
            .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
            .map(m => ({
                id: m.name.replace('models/', ''),
                capabilities: ['text', 'image', 'web_search'] // Gemini 1.5+ supports all
            }));

        console.log('Gemini models fetched:', availableModels.gemini.length);

    } catch (e) {
        console.error('Gemini fetch error:', e);
        availableModels.gemini = [];
        selectedSpans.gemini.textContent = 'Enter API key to load models';
        return;
    }

    renderModelDropdown('gemini');
}

// Fetch Groq models from API
async function fetchGroqModels() {
    selectedSpans.groq.textContent = 'Loading models...';

    try {
        const apiKey = groqKey.value.trim();
        if (!apiKey) {
            throw new Error('API key required');
        }

        const response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Map Groq models with capabilities based on model name/type (matching main.py)
        availableModels.groq = data.data.map(m => {
            const caps = ['text'];

            // Vision models support images (TEXT + IMAGE)
            if (m.id.includes('vision') || m.id.includes('llama-guard') ||
                m.id.includes('llama-4-maverick') || m.id.includes('llama-4-scout')) {
                caps.push('image');
            }
            // Compound and OSS models support web search (TEXT + WEB SEARCH)
            else if (m.id.includes('compound') || m.id.includes('gpt-oss')) {
                caps.push('web_search');
            }
            // Otherwise just text-only

            return {
                id: m.id,
                capabilities: caps
            };
        });

        console.log('Groq models fetched:', availableModels.groq.length);

    } catch (e) {
        console.error('Groq fetch error:', e);
        availableModels.groq = [];
        selectedSpans.groq.textContent = 'Enter API key to load models';
        return;
    }

    renderModelDropdown('groq');
}

// Render model dropdown with capability icons
function renderModelDropdown(provider) {
    const dropdown = dropdowns[provider];
    const models = availableModels[provider];

    if (models.length === 0) {
        dropdown.innerHTML = '<div class="loading">Enter API key and click Test to load models</div>';
        selectedSpans[provider].textContent = 'No models loaded';
        return;
    }

    dropdown.innerHTML = '';

    models.forEach(model => {
        const option = document.createElement('div');
        option.className = 'model-option';

        const icons = createCapabilityIcons(model.capabilities);
        const name = document.createElement('span');
        name.className = 'model-name';
        name.textContent = model.id;

        option.appendChild(icons);
        option.appendChild(name);

        option.addEventListener('click', (e) => {
            e.stopPropagation();
            selectModel(provider, model.id);
            dropdown.classList.remove('open');
        });

        dropdown.appendChild(option);
    });

    // Auto-select saved model or first model
    if (selectedModels[provider]) {
        const model = models.find(m => m.id === selectedModels[provider]);
        if (model) {
            updateSelectedDisplay(provider, model);
        } else if (models.length > 0) {
            selectModel(provider, models[0].id);
        }
    } else if (models.length > 0) {
        selectModel(provider, models[0].id);
    }
}

function createCapabilityIcons(capabilities) {
    const container = document.createElement('div');
    container.className = 'capability-icons';

    if (capabilities.includes('text')) {
        const icon = document.createElement('img');
        icon.src = 'icons/notepad.png';
        icon.className = 'cap-icon';
        icon.title = 'Text';
        container.appendChild(icon);
    }

    if (capabilities.includes('image')) {
        const icon = document.createElement('img');
        icon.src = 'icons/image-camera.png';
        icon.className = 'cap-icon';
        icon.title = 'Image';
        container.appendChild(icon);
    }

    if (capabilities.includes('web_search')) {
        const icon = document.createElement('img');
        icon.src = 'icons/web-search.png';
        icon.className = 'cap-icon';
        icon.title = 'Web Search';
        container.appendChild(icon);
    }

    return container;
}

function selectModel(provider, modelId) {
    selectedModels[provider] = modelId;
    const model = availableModels[provider].find(m => m.id === modelId);
    if (model) {
        updateSelectedDisplay(provider, model);
    }
}

function updateSelectedDisplay(provider, model) {
    const span = selectedSpans[provider];
    span.innerHTML = '';

    const icons = createCapabilityIcons(model.capabilities);
    const name = document.createElement('span');
    name.textContent = model.id;

    span.appendChild(icons);
    span.appendChild(name);

    // Update capabilities display below selector
    updateCapabilitiesDisplay(provider, model.capabilities);
}

function updateCapabilitiesDisplay(provider, capabilities) {
    const capsDiv = document.getElementById(`${provider}-capabilities`);
    if (!capsDiv) return;

    const iconMap = {
        text: 'notepad.png',
        image: 'image-camera.png',
        web_search: 'web-search.png'
    };

    const labelMap = {
        text: 'Text Analysis',
        image: 'Image Analysis',
        web_search: 'Web Search'
    };

    let html = '<div class="cap-title">Model Capabilities:</div><div class="cap-list">';

    capabilities.forEach(cap => {
        html += `
            <div class="cap-item">
                <img src="icons/${iconMap[cap]}" alt="${cap}">
                <span>${labelMap[cap]}</span>
            </div>
        `;
    });

    html += '</div>';

    capsDiv.innerHTML = html;
    capsDiv.classList.add('show');
}

// Save settings
saveBtn.addEventListener('click', () => {
    const settings = {
        provider: currentProvider,
        cerebras_api_key: cerebrasKey.value.trim(),
        cerebras_model: selectedModels.cerebras,
        gemini_api_key: geminiKey.value.trim(),
        gemini_model: selectedModels.gemini,
        groq_api_key: groqKey.value.trim(),
        groq_model: selectedModels.groq
    };

    const currentKey = settings[`${currentProvider}_api_key`];
    if (!currentKey) {
        showStatus(`Please enter an API key for ${currentProvider}`, 'error');
        return;
    }

    if (!selectedModels[currentProvider]) {
        showStatus('Please select a model', 'error');
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    chrome.storage.sync.set(settings, () => {
        showStatus('✓ Settings saved', 'success');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';

        chrome.runtime.sendMessage({ action: 'settingsUpdated' });
    });
});

// Test connection and fetch models
testBtn.addEventListener('click', async () => {
    const apiKey = currentProvider === 'cerebras' ? cerebrasKey.value.trim() :
        currentProvider === 'gemini' ? geminiKey.value.trim() :
            groqKey.value.trim();

    if (!apiKey) {
        showStatus('Please enter an API key', 'error');
        return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    showStatus('Fetching models from API...', 'success');

    try {
        // Fetch models for current provider
        if (currentProvider === 'cerebras') {
            await fetchCerebrasModels();
        } else if (currentProvider === 'gemini') {
            await fetchGeminiModels();
        } else if (currentProvider === 'groq') {
            await fetchGroqModels();
        }

        const count = availableModels[currentProvider].length;
        if (count > 0) {
            showStatus(`✓ Loaded ${count} models from ${currentProvider}`, 'success');
        } else {
            showStatus(`✗ No models found. Check API key.`, 'error');
        }
    } catch (e) {
        showStatus(`✗ ${e.message}`, 'error');
    } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test';
    }
});

function showStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';

    setTimeout(() => {
        status.style.display = 'none';
    }, 4000);
}

// Clear History Button
document.getElementById('clear-history-btn').addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all usage history?')) {
        await chrome.storage.local.set({ usageHistory: [] });
        loadHistory(); // Reload to show empty state
        showStatus('History cleared successfully', 'success');
    }
});

// Vectora API Toggle
const vectoraToggle = document.getElementById('use-vectora-api');

// Load toggle state
chrome.storage.sync.get('use_vectora_api', (result) => {
    vectoraToggle.checked = result.use_vectora_api || false;
    if (vectoraToggle.checked) {
        fetchVectoraAPIKeys();
    }
});

vectoraToggle.addEventListener('change', async () => {
    const enabled = vectoraToggle.checked;

    await chrome.storage.sync.set({ use_vectora_api: enabled });

    if (enabled) {
        showStatus('Fetching API keys from Vectora...', 'success');
        await fetchVectoraAPIKeys();
    } else {
        showStatus('Using manual API keys', 'success');
    }
});

async function fetchVectoraAPIKeys() {
    try {
        const response = await fetch('https://vectoraai.vercel.app/api/extension/keys');

        if (!response.ok) {
            throw new Error('Failed to fetch API keys');
        }

        const keys = await response.json();

        // Auto-fill API key fields
        if (keys.gemini_api_key) {
            geminiKey.value = keys.gemini_api_key;
        }
        if (keys.groq_api_key) {
            groqKey.value = keys.groq_api_key;
        }
        if (keys.cerebras_api_key) {
            cerebrasKey.value = keys.cerebras_api_key;
        }

        showStatus('API keys fetched from Vectora successfully!', 'success');

        // Auto-save
        saveBtn.click();

    } catch (error) {
        console.error('Error fetching Vectora API keys:', error);
        showStatus('Failed to fetch API keys from Vectora', 'error');
        vectoraToggle.checked = false;
        await chrome.storage.sync.set({ use_vectora_api: false });
    }
}
