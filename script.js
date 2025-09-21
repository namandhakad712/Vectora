let isHindi = false;

const translations = {
  en: {
    title: "Vectora",
    placeholder: "Enter text or paste a link...",
    checkBtn: "Check",
    langBtn: "Hindi / English",
    login: "Login",
    nav_home: "Home",
    nav_about: "About",
    nav_contact: "Contact",
    nav_patent: "Patent",
    verify_text: "Verify before you",
    believe_text: "believe.",
    use_vectora: "USE VECTORA",
    check_title: "Vectora Is a Web based Platform",
    check_sub: "Enter text, paste a link, or upload an image to check facts. Vectora returns an authenticity percentage and reasoning.",
    instructions: `Paste any WhatsApp forward or viral message below and click <b>Check</b> to verify its authenticity. Vectora helps you avoid misinformation and stay safe online.`
    ,ai_check: "AI Check",
    extension_title: "AI Authenticity Browser Extension",
    download_extension: "Download Extension"
  },
  hi: {
    title: "वेक्टोरा",
    placeholder: "टेक्स्ट यहाँ दर्ज करें या लिंक पेस्ट करें...",
    checkBtn: "जांचें",
    langBtn: "English / हिन्दी",
    login: "लॉगिन",
    nav_home: "होम",
    nav_about: "हमारे बारे में",
    nav_contact: "संपर्क",
    nav_patent: "पेटेंट",
    verify_text: "जांचें इससे पहले कि आप",
    believe_text: "विश्वास करें।",
    use_vectora: "यूज़ वेक्टोरा",
    check_title: "Vectora एक वेब-आधारित प्लेटफ़ॉर्म है",
    check_sub: "पाठ दर्ज करें, एक लिंक पेस्ट करें, या छवि अपलोड करें ताकि तथ्य जाँचे जा सकें। Vectora प्रामाणिकता प्रतिशत और तर्क लौटाता है।",
    instructions: `किसी भी व्हाट्सएप फॉरवर्ड या वायरल संदेश को नीचे पेस्ट करें और उसकी प्रामाणिकता की जाँच करने के लिए <b>जांचें</b> पर क्लिक करें। Vectora आपको गलत सूचना से बचने में मदद करता है।`
    ,ai_check: "AI जाँच",
    extension_title: "AI प्रामाणिकता ब्राउज़र एक्सटेंशन",
    download_extension: "एक्सटेंशन डाउनलोड करें"
  }
};

// Helper to fetch translated text for dynamic strings
function t(key){
  const lang = isHindi ? 'hi' : 'en';
  if(translations[lang] && translations[lang][key]) return translations[lang][key];
  if(translations['en'] && translations['en'][key]) return translations['en'][key];
  return key;
}

// ensure some commonly used keys exist with defaults
translations.en.clear = translations.en.clear || 'Clear';
translations.hi.clear = translations.hi.clear || 'साफ़ करें';
translations.en.result_label = translations.en.result_label || 'Result:';
translations.hi.result_label = translations.hi.result_label || 'परिणाम:';
translations.en.awaiting = translations.en.awaiting || 'Awaiting input...';
translations.hi.awaiting = translations.hi.awaiting || 'प्रविष्टि प्रतीक्षित...';
translations.en.please_enter = translations.en.please_enter || 'Please enter text or paste a link.';
translations.hi.please_enter = translations.hi.please_enter || 'कृपया पाठ दर्ज करें या एक लिंक पेस्ट करें।';
translations.en.checking = translations.en.checking || 'Checking...';
translations.hi.checking = translations.hi.checking || 'जाँच हो रही है...';
translations.en.network_error = translations.en.network_error || 'Network error';
translations.hi.network_error = translations.hi.network_error || 'नेटवर्क त्रुटि';
translations.en.error_prefix = translations.en.error_prefix || 'Error:';
translations.hi.error_prefix = translations.hi.error_prefix || 'त्रुटि:';

// also ensure checkBtn exists (already defined above but safe-guard)
translations.en.checkBtn = translations.en.checkBtn || 'Check';
translations.hi.checkBtn = translations.hi.checkBtn || 'जांचें';

function toggleLanguage() {
  isHindi = !isHindi;
  const lang = isHindi ? "hi" : "en";
  // translate page by data-i18n attributes
  translatePage(lang);

  // write to any hidden input named lang so forms include the selection
  const hiddenLangs = document.querySelectorAll('input[name="lang"]');
  hiddenLangs.forEach(i => { i.value = lang; });

  // store preference
  sessionStorage.setItem('vectora-lang', lang);
}

function translatePage(lang){
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if(key && translations[lang] && translations[lang][key]){
      if(el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea'){
        el.placeholder = translations[lang][key];
      } else {
        el.innerHTML = translations[lang][key];
      }
    }
  });
}

async function checkFact() {
  const textEl = document.getElementById("inputText");
  const linkEl = document.getElementById("inputLink");
  const imgEl = document.getElementById("imageInput");
  const resultEl = document.getElementById("result");
  const text = textEl ? textEl.value.trim() : "";
  const link = linkEl ? linkEl.value.trim() : "";
  const image = imgEl && imgEl.files && imgEl.files[0] ? imgEl.files[0] : null;
  const langEl = document.getElementById('lang');
  const lang = langEl ? langEl.value : (isHindi ? 'hi' : 'en');

  if (!resultEl) return;

  if (!text && !image && !link) {
    resultEl.innerText = isHindi ? "कृपया कुछ पाठ, एक छवि, या लिंक दर्ज करें।" : "Please enter some text, upload an image, or provide a link.";
    return;
  }

  resultEl.innerText = isHindi ? "जांच हो रही है..." : "Checking...";

  const formData = new FormData();
  formData.append("user_input", text);
  formData.append("user_link", link);
  formData.append("lang", lang);
  if (image) formData.append("image_input", image);

  try {
    const resp = await fetch("/process", { method: "POST", body: formData });
    const data = await resp.json();
    resultEl.innerText = data.reply || (isHindi ? "कोई प्रतिक्रिया नहीं मिली।" : "No response received.");
  } catch (e) {
    resultEl.innerText = isHindi ? "त्रुटि हुई।" : "An error occurred.";
  }
}

// Image upload and drag & drop logic (only if elements exist on page)
document.addEventListener('DOMContentLoaded', () => {
  // attach language toggle buttons on pages
  // Hide top language if we navigated via the Use Vectora button
  if(sessionStorage.getItem('hide-top-lang') === '1'){
    // add a body class so CSS can enforce hiding without inline styles
    document.body.classList.add('hide-top-lang');
    // clear the flag so it doesn't persist beyond this navigation
    sessionStorage.removeItem('hide-top-lang');
  }

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { toggleLanguage(); });
  });

  // apply stored language preference immediately
  const storedLang = sessionStorage.getItem('vectora-lang');
  if(storedLang){
    isHindi = (storedLang === 'hi');
    translatePage(storedLang);
  }

  // If a hide-top-lang body class is applied, also make sure the top-lang button is removed from accessibility tree
  if(document.body.classList.contains('hide-top-lang')){
    const top = document.getElementById('top-lang-btn');
    if(top){ top.setAttribute('aria-hidden','true'); top.tabIndex = -1; }
  }

  const uploadArea = document.getElementById('uploadArea');
  const imageInput = document.getElementById('imageInput');
  const imagePreview = document.getElementById('imagePreview');

  if (uploadArea && imagePreview) {
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImage(e.dataTransfer.files[0]);
      }
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImage(e.target.files[0]);
      }
    });
  }

  function handleImage(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) return;
    if (!imagePreview) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      imagePreview.innerHTML = `<img src="${e.target.result}" alt="Uploaded Image" />`;
    };
    reader.readAsDataURL(file);
  }
});