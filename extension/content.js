// content.js - Text selection popup, image selector, and screen cropper

// ========== TEXT SELECTION POPUP ==========

let selectionPopup = null;
let cropperOverlay = null;
let currentScrollHandler = null; // For image selector scroll handling

// Create selection popup
function createSelectionPopup() {
  if (selectionPopup) return;

  selectionPopup = document.createElement('div');
  selectionPopup.id = 'vectora-selection-popup';
  selectionPopup.innerHTML = `
    <button id="vectora-check-btn">
      <img src="${chrome.runtime.getURL('icons/notepad.png')}" alt="Check">
      Check AI
    </button>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #vectora-selection-popup {
      position: absolute;
      z-index: 999999;
      display: none;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid rgba(0, 243, 255, 0.5);
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 4px 12px rgba(0, 243, 255, 0.3);
      backdrop-filter: blur(8px);
      animation: popIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    
    @keyframes popIn {
      from {
        opacity: 0;
        transform: translateY(-10px) scale(0.8);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    
    #vectora-check-btn {
      background: rgba(0, 243, 255, 0.1);
      border: none;
      color: #00f3ff;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    
    #vectora-check-btn:hover {
      background: rgba(0, 243, 255, 0.2);
      transform: translateY(-1px);
    }
    
    #vectora-check-btn img {
      width: 16px;
      height: 16px;
      filter: brightness(0) invert(1);
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(selectionPopup);

  // Add click handler
  document.getElementById('vectora-check-btn').addEventListener('click', () => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      console.log('Sending text to background:', selectedText.substring(0, 50) + '...');
      chrome.runtime.sendMessage({
        action: 'analyzeText',
        text: selectedText
      });
      selectionPopup.style.display = 'none';
    }
  });
}

// Show popup near selection
function showSelectionPopup(x, y) {
  if (!selectionPopup) createSelectionPopup();

  selectionPopup.style.left = `${x}px`;
  selectionPopup.style.top = `${y - 50}px`;
  selectionPopup.style.display = 'block';
}

// Hide popup
function hideSelectionPopup() {
  if (selectionPopup) {
    selectionPopup.style.display = 'none';
  }
}

// Listen for text selection
document.addEventListener('mouseup', (e) => {
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText && selectedText.length > 10) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showSelectionPopup(
        rect.left + window.scrollX + (rect.width / 2) - 50,
        rect.top + window.scrollY
      );
    } else {
      hideSelectionPopup();
    }
  }, 100);
});

// Hide on click elsewhere
document.addEventListener('mousedown', (e) => {
  if (selectionPopup && !selectionPopup.contains(e.target)) {
    hideSelectionPopup();
  }
});

// ========== IMAGE SELECTOR ==========

function activateImageSelector() {
  console.log('Activating image selector...');

  // Create full-screen overlay
  const overlay = document.createElement('div');
  overlay.id = 'vectora-image-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.7);
    z-index: 999998;
    cursor: crosshair;
    overflow: hidden;
  `;

  document.body.appendChild(overlay);

  const highlightBoxes = [];

  // Function to update highlight positions
  function updateHighlightPositions() {
    const images = document.querySelectorAll('img');

    // Remove old highlights
    highlightBoxes.forEach(box => box.remove());
    highlightBoxes.length = 0;

    // Create new highlights
    images.forEach(img => {
      const rect = img.getBoundingClientRect();

      // Only show if visible in viewport
      if (rect.width > 0 && rect.height > 0 &&
        rect.top < window.innerHeight && rect.bottom > 0) {

        const imageOverlay = document.createElement('div');
        imageOverlay.className = 'vectora-image-highlight';
        imageOverlay.style.cssText = `
          position: fixed;
          left: ${rect.left}px;
          top: ${rect.top}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          border: 3px solid #00f3ff;
          box-shadow: 0 0 20px rgba(0, 243, 255, 0.6);
          cursor: pointer;
          z-index: 999999;
          transition: all 0.2s;
          pointer-events: auto;
        `;

        imageOverlay.addEventListener('mouseenter', () => {
          imageOverlay.style.transform = 'scale(1.05)';
          imageOverlay.style.boxShadow = '0 0 30px rgba(0, 243, 255, 0.9)';
        });

        imageOverlay.addEventListener('mouseleave', () => {
          imageOverlay.style.transform = 'scale(1)';
          imageOverlay.style.boxShadow = '0 0 20px rgba(0, 243, 255, 0.6)';
        });

        imageOverlay.addEventListener('click', (e) => {
          e.stopPropagation();
          const imgUrl = img.src || img.currentSrc;
          console.log('Image clicked:', imgUrl);
          chrome.runtime.sendMessage({
            action: 'analyzeImage',
            imageUrl: imgUrl
          });
          deactivateImageSelector();
        });

        overlay.appendChild(imageOverlay);
        highlightBoxes.push(imageOverlay);
      }
    });
  }

  // Initial highlight
  updateHighlightPositions();

  // Update on scroll
  let scrollTimeout;
  currentScrollHandler = () => { // Assign to the module-scoped variable
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(updateHighlightPositions, 100);
  };
  window.addEventListener('scroll', currentScrollHandler, { passive: true });

  // Cancel on overlay click
  overlay.addEventListener('click', () => {
    deactivateImageSelector();
  });

  // Show instructions
  showInstructions('Click any highlighted image to analyze', () => {
    deactivateImageSelector();
  });
}

function deactivateImageSelector() {
  const overlay = document.getElementById('vectora-image-overlay');
  if (overlay) {
    // Remove scroll listener
    if (currentScrollHandler) {
      window.removeEventListener('scroll', currentScrollHandler);
      currentScrollHandler = null; // Clear the reference
    }
    overlay.remove();
  }
  hideInstructions();
}

// ========== SCREEN CROPPER ==========

function activateScreenCropper() {
  if (cropperOverlay) return;

  cropperOverlay = document.createElement('div');
  cropperOverlay.id = 'vectora-cropper-overlay';
  cropperOverlay.innerHTML = `
    <div class="vectora-cropper-container">
      <div class="vectora-crop-area" id="vectora-crop-area"></div>
      <div class="vectora-cropper-instructions">
        <p>Click and drag to select any area</p>
        <button id="vectora-capture-btn">Capture & Analyze</button>
        <button id="vectora-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #vectora-cropper-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.7);
      z-index: 999998;
      cursor: crosshair;
    }
    
    .vectora-crop-area {
      position: absolute;
      border: 3px dashed #00f3ff;
      background: rgba(0, 243, 255, 0.15);
      pointer-events: none;
      box-shadow: 0 0 30px rgba(0, 243, 255, 0.5);
    }
    
    .vectora-cropper-instructions {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid rgba(0, 243, 255, 0.5);
      border-radius: 8px;
      padding: 15px 20px;
      text-align: center;
      z-index: 999999;
    }
    
    .vectora-cropper-instructions p {
      color: #00f3ff;
      font-size: 14px;
      margin-bottom: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    
    .vectora-cropper-instructions button {
      background: #00f3ff;
      color: #000;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      margin: 0 5px;
      transition: all 0.2s;
    }
    
    .vectora-cropper-instructions button:hover {
      background: #00d4e6;
      transform: translateY(-1px);
    }
    
    #vectora-cancel-btn {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    
    #vectora-cancel-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(cropperOverlay);

  // Cropping logic
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  const cropArea = document.getElementById('vectora-crop-area');

  cropperOverlay.addEventListener('mousedown', (e) => {
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    cropArea.style.left = `${startX}px`;
    cropArea.style.top = `${startY}px`;
    cropArea.style.width = '0px';
    cropArea.style.height = '0px';
    cropArea.style.display = 'block';
  });

  cropperOverlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;

    const currentX = e.clientX;
    const currentY = e.clientY;
    const width = currentX - startX;
    const height = currentY - startY;

    cropArea.style.width = `${Math.abs(width)}px`;
    cropArea.style.height = `${Math.abs(height)}px`;
    cropArea.style.left = `${width < 0 ? currentX : startX}px`;
    cropArea.style.top = `${height < 0 ? currentY : startY}px`;
  });

  cropperOverlay.addEventListener('mouseup', () => {
    isDrawing = false;
  });

  // Capture button
  document.getElementById('vectora-capture-btn').addEventListener('click', () => {
    captureSelectedArea();
  });

  // Cancel button
  document.getElementById('vectora-cancel-btn').addEventListener('click', () => {
    deactivateScreenCropper();
  });
}

function captureSelectedArea() {
  const cropArea = document.getElementById('vectora-crop-area');
  const rect = cropArea.getBoundingClientRect();

  console.log('Sending screen capture request:', {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  });

  // Just send the coordinates - let background.js handle everything
  chrome.runtime.sendMessage({
    action: 'captureVisibleTab',
    crop: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  });

  deactivateScreenCropper();
}

function deactivateScreenCropper() {
  if (cropperOverlay) {
    cropperOverlay.remove();
    cropperOverlay = null;
  }
}

// ========== INSTRUCTION OVERLAY ==========

function showInstructions(message, onCancel) {
  const overlay = document.createElement('div');
  overlay.id = 'vectora-instruction-overlay';
  overlay.innerHTML = `
      < div class="vectora-instruction-box" >
      <p>${message}</p>
      <button id="vectora-instruction-cancel">Cancel (ESC)</button>
    </div >
      `;

  const style = document.createElement('style');
  style.textContent = `
    #vectora - instruction - overlay {
      position: fixed;
      top: 20px;
      left: 50 %;
      transform: translateX(-50 %);
      z - index: 999997;
    }
    
    .vectora - instruction - box {
      background: linear - gradient(135deg, #1a1a2e 0 %, #16213e 100 %);
      border: 1px solid rgba(0, 243, 255, 0.5);
      border - radius: 8px;
      padding: 15px 20px;
      text - align: center;
      box - shadow: 0 4px 12px rgba(0, 243, 255, 0.3);
    }
    
    .vectora - instruction - box p {
      color: #00f3ff;
      font - size: 14px;
      margin - bottom: 10px;
      font - family: -apple - system, BlinkMacSystemFont, 'Segoe UI', sans - serif;
    }
    
    .vectora - instruction - box button {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border: none;
      padding: 8px 16px;
      border - radius: 4px;
      cursor: pointer;
      font - size: 13px;
      transition: all 0.2s;
    }
    
    .vectora - instruction - box button:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  document.getElementById('vectora-instruction-cancel').addEventListener('click', () => {
    onCancel();
  });

  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      onCancel();
      document.removeEventListener('keydown', escHandler);
    }
  });
}

function hideInstructions() {
  const overlay = document.getElementById('vectora-instruction-overlay');
  if (overlay) overlay.remove();
}

// ========== MESSAGE LISTENER ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'selectImage') {
    activateImageSelector();
    sendResponse({ success: true });
  }

  else if (message.action === 'cropScreen') {
    activateScreenCropper();
    sendResponse({ success: true });
  }

  return true;
});
