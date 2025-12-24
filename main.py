from flask import Flask, request, jsonify, render_template, Response, stream_with_context
from flask_cors import CORS
import requests
import re
import sys
import os
import json
import base64
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# Optional PDF support
try:
    from pdf2image import convert_from_path # type: ignore
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False

load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

# DATA DIRS
# DATA DIRS
# In Vercel (Lambda), only /tmp is writable
UPLOAD_FOLDER = '/tmp/vectora_uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ✅ API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY")

# Base URLs
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"


def extract_probability(text):
    if not text: return None
    match = re.search(r"(\d{1,3}) ?%", text)
    if match: return int(match.group(1))
    return None

# --- GEMINI HELPERS ---

def upload_to_gemini(file_path, mime_type):
    """Uploads file to Gemini Files API and returns file_uri."""
    file_size = os.path.getsize(file_path)
    display_name = os.path.basename(file_path)
    
    # 1. Initial Resumable Request
    url = f"{GEMINI_BASE_URL}/upload/v1beta/files"
    headers = {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": str(file_size),
        "X-Goog-Upload-Header-Content-Type": mime_type,
        "Content-Type": "application/json"
    }
    params = {"key": GEMINI_API_KEY}
    data = {"file": {"display_name": display_name}}
    
    req1 = requests.post(url, headers=headers, params=params, json=data)
    upload_url = req1.headers.get("X-Goog-Upload-URL")
    
    if not upload_url:
        raise Exception(f"Failed to get upload URL: {req1.text}")
        
    # 2. Upload Bytes
    with open(file_path, "rb") as f:
        headers2 = {
            "Content-Length": str(file_size),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize"
        }
        req2 = requests.post(upload_url, headers=headers2, data=f)
    
    if req2.status_code != 200:
        raise Exception(f"File upload failed: {req2.text}")
        
    file_info = req2.json()
    return file_info["file"]["uri"]

def stream_gemini(prompt, model, file_uri=None, mime_type=None, web_search=False):
    # Prepare URL
    if not model.startswith("models/") and not model.startswith("tunedModels/"):
         model_path = f"models/{model}"
    else:
         model_path = model

    url = f"{GEMINI_BASE_URL}/{model_path}:streamGenerateContent?alt=sse"
    params = {"key": GEMINI_API_KEY}
    headers = {"Content-Type": "application/json"}
    
    parts = [{"text": prompt}]
    if file_uri:
        parts.insert(0, {"file_data": {"mime_type": mime_type, "file_uri": file_uri}})
    
    contents = [{"parts": parts}]
    
    tools = []
    if web_search:
        tools.append({"googleSearch": {}})
        
    payload = {
        "contents": contents,
        "generationConfig": {"temperature": 0.1} 
    }
    if tools:
        payload["tools"] = tools

    # Request
    with requests.post(url, headers=headers, params=params, json=payload, stream=True) as resp:
        for line in resp.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
                if decoded_line.startswith("data:"):
                    json_str = decoded_line[5:].strip()
                    try:
                        chunk = json.loads(json_str)
                        cand = chunk.get("candidates", [{}])[0]
                        content = cand.get("content", {}).get("parts", [{}])[0].get("text", "")
                        
                        # Handle Text
                        if content: yield content
                        
                        # Handle Grounding Metadata (Source Links)
                        grounding = cand.get("groundingMetadata", {})
                        chunks = grounding.get("groundingChunks", [])
                        if chunks:
                            links_md = "\n\n**Verified Sources:**\n"
                            found_links = False
                            for c in chunks:
                                web = c.get("web", {})
                                if web:
                                    title = web.get("title", "Source")
                                    uri = web.get("uri") or web.get("url") # Try both keys
                                    if uri and uri.startswith("http"):
                                        links_md += f"- [{title}]({uri})\n"
                                        found_links = True
                            if found_links:
                                # Yield formatted source block
                                yield "\n\n**Verified Sources:**\n" + links_md.replace("- [", "- ").replace("](", ": ").replace(")", "")
                    except Exception as e:
                        pass

# --- GROQ HELPERS ---

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def convert_doc_to_images(doc_path):
    """Converts PDF to images. Returns list of image paths."""
    if not PDF_SUPPORT:
        raise Exception("System Configuration Error: 'poppler' is not installed or not in PATH. PDF conversion for non-native models (like Groq) requires Poppler. Please install Poppler or use Gemini (native PDF support).")
    
    try:
        images = convert_from_path(doc_path)
    except Exception as e:
         if "poppler" in str(e).lower() or "not in path" in str(e).lower():
             raise Exception("System Error: Poppler not found. Please install Poppler to process PDFs with this model, or switch to Gemini.")
         raise e

    img_paths = []
    base = os.path.splitext(doc_path)[0]
    for i, img in enumerate(images):
        path = f"{base}_page_{i}.jpg"
        img.save(path, 'JPEG')
        img_paths.append(path)
        if i >= 4: break # Limit to first 5 pages for API limits
    return img_paths

def stream_groq(prompt, model, file_path=None, mime_type=None):
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    messages = []
    content_list = [{"type": "text", "text": prompt}]
    
    if file_path and mime_type:
        # Check if model supports vision (managed by frontend selection normally, but backend check is good)
        # Assuming frontend passes correct model.
        if mime_type.startswith("image/"):
            b64_img = encode_image(file_path)
            content_list.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{b64_img}"}
            })
        elif mime_type == "application/pdf":
            try:
                img_paths = convert_doc_to_images(file_path)
                for path in img_paths:
                    b64 = encode_image(path)
                    content_list.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                    })
            except Exception as e:
                yield f"[System Error: PDF Conversion failed - {str(e)}]"
                return
    
    messages.append({"role": "user", "content": content_list})
    
    data = {
        "model": model, 
        "messages": messages, 
        "stream": True,
        "temperature": 0.2
    }
    
    with requests.post(f"{GROQ_BASE_URL}/chat/completions", headers=headers, json=data, stream=True) as resp:
        for line in resp.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
                if decoded_line.startswith("data:"):
                    json_str = decoded_line[5:].strip()
                    if json_str == "[DONE]": break
                    try:
                        chunk = json.loads(json_str)
                        content = chunk["choices"][0]["delta"].get("content", "")
                        if content: yield content
                    except:
                        pass

# --- CEREBRAS HELPERS ---

def stream_cerebras(prompt, model):
    headers = {
        "Authorization": f"Bearer {CEREBRAS_API_KEY}",
        "Content-Type": "application/json"
    }
    data = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "temperature": 0.2
    }
    
    with requests.post(f"{CEREBRAS_BASE_URL}/chat/completions", headers=headers, json=data, stream=True) as resp:
        for line in resp.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
                if decoded_line.startswith("data:"):
                    json_str = decoded_line[5:].strip()
                    if json_str == "[DONE]": break
                    try:
                        chunk = json.loads(json_str)
                        content = chunk["choices"][0]["delta"].get("content", "")
                        if content: yield content
                    except:
                        pass


# --- ROUTES ---

@app.route("/")
def home(): return render_template("home.html")

@app.route("/check")
def check(): return render_template("check.html")

@app.route("/extension")
def extension_page(): return render_template("extension.html")

@app.route('/about')
def about_page(): return render_template('about.html')

@app.route('/contact')
def contact_page(): return render_template('contact.html')

@app.route('/guide')
def guide_page(): return render_template('guide.html')

@app.route("/api/models", methods=["GET"])
def get_models():
    """Fetch available models with capabilities."""
    models = {"gemini": [], "groq": [], "cerebras": []}
    
    # 1. Gemini
    try:
        url = f"{GEMINI_BASE_URL}/models"
        params = {"key": GEMINI_API_KEY}
        resp = requests.get(url, params=params)
        if resp.status_code == 200:
            data = resp.json()
            for m in data.get("models", []):
                if "generateContent" in m.get("supportedGenerationMethods", []):
                    name = m["name"].replace("models/", "")
                    models["gemini"].append({
                        "id": name,
                        "capabilities": ["text", "image", "web_search"] # Gemini 1.5+ generally supports all
                    })
    except Exception as e:
        print(f"Error fetching Gemini models: {e}", file=sys.stderr)
        models["gemini"] = [
            {"id": "gemini-2.0-flash", "capabilities": ["text", "image", "web_search"]},
            {"id": "gemini-1.5-flash", "capabilities": ["text", "image", "web_search"]},
            {"id": "gemini-1.5-pro", "capabilities": ["text", "image", "web_search"]}
        ]

    # 2. Groq (Hardcoded as per user request for specific model set)
    models["groq"] = [
        # TEXT + IMAGE
        {"id": "meta-llama/llama-guard-4-12b", "capabilities": ["text", "image"]},
        {"id": "meta-llama/llama-4-maverick-17b-128e-instruct", "capabilities": ["text", "image"]},
        {"id": "meta-llama/llama-4-scout-17b-16e-instruct", "capabilities": ["text", "image"]},
        # TEXT + WEB SEARCH (Compound & OSS)
        {"id": "openai/gpt-oss-120b", "capabilities": ["text", "web_search"]},
        {"id": "openai/gpt-oss-20b", "capabilities": ["text", "web_search"]},
        {"id": "groq/compound", "capabilities": ["text", "web_search"]},
        {"id": "groq/compound-mini", "capabilities": ["text", "web_search"]},
        {"id": "openai/gpt-oss-safeguard-20b", "capabilities": ["text", "web_search"]}
    ]

    # 3. Cerebras (Live Fetch)
    try:
        url = f"{CEREBRAS_BASE_URL}/models"
        headers = {"Authorization": f"Bearer {CEREBRAS_API_KEY}"}
        resp = requests.get(url, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            # Cerebras API response format: {"data": [{"id": "..."}, ...]}
            for m in data.get("data", []):
                models["cerebras"].append({
                    "id": m["id"],
                    "capabilities": ["text"] # Assume text-only for inference endpoints
                })
    except Exception as e:
        print(f"Error fetching Cerebras models: {e}", file=sys.stderr)
        # Fallback if fetch fails
        models["cerebras"] = [
            {"id": "llama3.1-8b", "capabilities": ["text"]},
            {"id": "llama3.1-70b", "capabilities": ["text"]}
        ]
    
    return jsonify(models)


@app.route("/process", methods=["POST"])
def process():
    try:
        user_input = request.form.get("user_input", "").strip()
        provider = request.form.get("provider", "gemini")
        model = request.form.get("model", "")
        web_search = request.form.get("web_search") == "true"
        
        # Files
        file = request.files.get("file")
        file_path = None
        mime_type = None
        
        if file and file.filename:
            filename = secure_filename(file.filename)
            file_path = os.path.join(UPLOAD_FOLDER, filename)
            file.save(file_path)
            mime_type = file.mimetype or "application/octet-stream"
            if filename.lower().endswith(".pdf"): mime_type = "application/pdf"
            if filename.lower().endswith(".jpg") or filename.lower().endswith(".jpeg"): mime_type = "image/jpeg"
            if filename.lower().endswith(".png"): mime_type = "image/png"

        if not model:
            if provider == "gemini": model = "gemini-2.0-flash"
            elif provider == "groq": model = "llama3-70b-8192"
            else: model = "llama3.1-70b"

        # DETAILED SYSTEM PROMPT
        sys_prompt = (
            "You are Vectora, an elite fact-checking AI Agent. "
            "Your mission is to analyze the provided input (text, image, or document) "
            "and verify its truthfulness with high precision.\n\n"
            "## OUTPUT PROTOCOL:\n"
            "1. **VERDICT**: [TRUE / FALSE / MISLEADING / SATIRE / UNVERIFIED]\n"
            "2. **RISK SCORE**: [0-100%] (Probability of Misinformation)\n"
            "3. **ANALYSIS**: Provide a crisp, evidence-based explanation. "
            "Cite known facts and point out logical fallacies or manipulation tactics.\n"
            "4. **SOURCES**: List credible sources with their direct **URL links** to verify your claims. \n"
            "   - **FORMAT**: Use the format `- Source Name: https://full.url.here` (Do NOT use markdown links like `[text](url)`). \n"
            "   - **CRITICAL**: Only list sources if you have a VALID, non-empty URL. \n"
            "   - **VERIFICATION**: Ensure every link provided is a valid, accessible URL.\n\n"
            "Maintain an objective, professional, and authoritative tone."
        )
        
        if user_input:
            prompt = f"{sys_prompt}\n\n[USER INPUT]: {user_input}"
        else:
            prompt = f"{sys_prompt}\n\n(No text input. Analyze the attached file)"

        def generate():
            try:
                if provider == "gemini":
                    file_uri = None
                    if file_path:
                        yield f"// Uploading {os.path.basename(file_path)} to Google Vault...\n"
                        file_uri = upload_to_gemini(file_path, mime_type)
                    
                    yield from stream_gemini(prompt, model, file_uri, mime_type, web_search)
                
                elif provider == "groq":
                    if file_path:
                        yield f"// Processing Image Data for Groq...\n"
                    yield from stream_groq(prompt, model, file_path, mime_type)
                    
                elif provider == "cerebras":
                    # Cerebras is Text-Only currently for standard inference
                    if file_path:
                        yield f"// WARNING: Cerebras provider supports TEXT ONLY. File ignored.\n"
                    yield from stream_cerebras(prompt, model)
                
            except Exception as e:
                yield f"\n[SYSTEM ERROR: {str(e)}]"
            finally:
                pass

        return Response(stream_with_context(generate()), content_type='text/plain')

    except Exception as e:
        print("Flask exception in /process:", e, file=sys.stderr)
        return jsonify({"reply": f"System Error: {e}"}), 500


@app.route('/ai-check', methods=['POST'])
def ai_check():
    """
    Endpoint for the extension to check AI authenticity.
    Accepts: { "text": "...", "image_url": "...", "video_url": "..." }
    Returns: { "ai_percent": 0-100, "message": "..." }
    """
    try:
        data = request.get_json() or {}
        text_content = data.get('text', '').strip()
        image_url = data.get('image_url', '').strip()
        video_url = data.get('video_url', '').strip()
        
        if not (text_content or image_url or video_url):
            return jsonify({"error": "No content provided"}), 400
        
        # Build prompt for AI detection
        sys_prompt = (
            "You are an AI detector. Analyze the provided content and determine "
            "the percentage likelihood it was generated by AI (0-100%). "
            "Respond ONLY with a JSON object like: {\"ai_percent\": 75, \"message\": \"Likely AI-generated\"}"
        )
        
        if text_content:
            prompt = f"{sys_prompt}\n\nAnalyze this text:\n{text_content}"
        elif image_url:
            prompt = f"{sys_prompt}\n\nAnalyze this image from URL: {image_url}"
        else:
            prompt = f"{sys_prompt}\n\nAnalyze this video from URL: {video_url}"
        
        # Call Gemini API
        if not GEMINI_API_KEY:
            return jsonify({"error": "API key not configured"}), 500
        
        url = f"{GEMINI_BASE_URL}/models/gemini-2.0-flash:generateContent"
        params = {"key": GEMINI_API_KEY}
        headers = {"Content-Type": "application/json"}
        
        parts = [{"text": prompt}]
        
        # Add image if URL provided
        if image_url:
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": image_url}})
        
        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {"temperature": 0.1}
        }
        
        resp = requests.post(url, headers=headers, params=params, json=payload, timeout=10)
        
        if resp.status_code != 200:
            return jsonify({"ai_percent": 50, "message": "Unable to analyze (local mode)"}), 200
        
        result = resp.json()
        text_response = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        
        # Try to extract JSON from response
        try:
            import re
            json_match = re.search(r'\{.*\}', text_response, re.DOTALL)
            if json_match:
                analysis = json.loads(json_match.group())
                ai_percent = analysis.get("ai_percent", 50)
                message = analysis.get("message", "Analysis complete")
            else:
                # Fallback: extract percentage from text
                percent_match = re.search(r'(\d{1,3})%', text_response)
                ai_percent = int(percent_match.group(1)) if percent_match else 50
                message = text_response[:100]
        except:
            ai_percent = 50
            message = "Analysis complete"
        
        return jsonify({"ai_percent": min(100, max(0, ai_percent)), "message": message}), 200
    
    except Exception as e:
        return jsonify({"ai_percent": 50, "message": f"Error: {str(e)[:50]}"}), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(debug=True, port=port)
