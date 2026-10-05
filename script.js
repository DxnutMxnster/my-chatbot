// =====================================================
//  KINETIX LOGIC
//  You don't need to edit this file.
// =====================================================

// ---------- Grab the page elements ----------
const messagesEl = document.getElementById("messages");
const startersEl = document.getElementById("starters");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");
const apiKeyBtn = document.getElementById("apiKeyBtn");
const keyModal = document.getElementById("keyModal");
const keyInput = document.getElementById("keyInput");
const rememberBox = document.getElementById("rememberBox");
const keyStatus = document.getElementById("keyStatus");
const keySave = document.getElementById("keySave");
const keyCancel = document.getElementById("keyCancel");
const keyClear = document.getElementById("keyClear");

// The conversation so far, in the format Gemini expects
let history = [];
let isBusy = false;

// ---------- Set up the page from config.js ----------
document.documentElement.style.setProperty("--accent", BOT_CONFIG.themeColor);
document.title = BOT_CONFIG.name;
document.getElementById("botName").textContent = BOT_CONFIG.name;
document.getElementById("botEmoji").textContent = BOT_CONFIG.emoji;
document.getElementById("botTagline").textContent = BOT_CONFIG.tagline;

// ---------- API key storage (safe, never in the code) ----------
function getKey() {
  try {
    const sessionKey = sessionStorage.getItem("gemini_api_key");
    if (sessionKey) return sessionKey;
  } catch (e) { /* storage blocked, ignore */ }
  try {
    const savedKey = localStorage.getItem("gemini_api_key");
    if (savedKey) return savedKey;
  } catch (e) { /* storage blocked, ignore */ }
  return "";
}

function saveKey(key, remember) {
  let ok = true;
  try { sessionStorage.setItem("gemini_api_key", key); } catch (e) { ok = false; }
  try {
    if (remember) localStorage.setItem("gemini_api_key", key);
    else localStorage.removeItem("gemini_api_key");
  } catch (e) { if (remember) ok = false; }
  return ok;
}

function removeKey() {
  try { sessionStorage.removeItem("gemini_api_key"); } catch (e) {}
  try { localStorage.removeItem("gemini_api_key"); } catch (e) {}
}

function openKeyModal(message) {
  keyInput.value = getKey();
  let remembered = false;
  try { remembered = !!localStorage.getItem("gemini_api_key"); } catch (e) {}
  rememberBox.checked = remembered;
  keyStatus.textContent = message || "";
  keyModal.classList.remove("hidden");
  keyInput.focus();
}

function closeKeyModal() {
  keyModal.classList.add("hidden");
}

apiKeyBtn.addEventListener("click", () => openKeyModal());
keyCancel.addEventListener("click", closeKeyModal);
keyModal.addEventListener("click", (e) => { if (e.target === keyModal) closeKeyModal(); });

keySave.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "Please paste your key first.";
    return;
  }
  const ok = saveKey(key, rememberBox.checked);
  if (!ok) {
    keyStatus.textContent = "Your browser blocked saving. The key will work until you close this page.";
  }
  closeKeyModal();
});

keyClear.addEventListener("click", () => {
  removeKey();
  keyInput.value = "";
  keyStatus.textContent = "Key removed.";
});

// ---------- Safe text formatting (bold + bullet lists) ----------
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInline(escapedText) {
  return escapedText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function formatText(text) {
  const safe = escapeHtml(text); // escape FIRST so nothing can inject HTML
  const lines = safe.split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    const bullet = line.match(/^\s*[*\-•]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + formatInline(bullet[1]) + "</li>";
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim() !== "") html += "<p>" + formatInline(line) + "</p>";
    }
  }
  if (inList) html += "</ul>";
  return html;
}

// ---------- Chat bubbles ----------
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addBubble(type, text) {
  const div = document.createElement("div");
  div.className = "bubble " + type;
  if (type === "user" || type === "error") {
    div.textContent = text; // plain text, always safe
  } else {
    div.innerHTML = formatText(text);
  }
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function showThinking() {
  const div = document.createElement("div");
  div.className = "bubble bot thinking";
  div.id = "thinkingBubble";
  div.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(div);
  scrollToBottom();
}

function hideThinking() {
  const el = document.getElementById("thinkingBubble");
  if (el) el.remove();
}

// ---------- Friendly error messages ----------
function friendlyError(status) {
  if (status === 400 || status === 403) {
    return "Your API key doesn't seem to work. Click the \"API key\" button and check that you pasted it correctly.";
  }
  if (status === 404) {
    return "I couldn't find that AI model. Check the model name in config.js.";
  }
  if (status === 429) {
    return "Too many requests right now. Please wait a minute and try again.";
  }
  if (status >= 500) {
    return "Google's AI service is having problems. Please try again in a little while.";
  }
  return "Something went wrong (error " + status + "). Please try again.";
}

// ---------- Talking to Gemini ----------
async function askGemini() {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(BOT_CONFIG.model) + ":generateContent";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getKey()
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: BOT_CONFIG.systemInstructions }] },
      contents: history
    })
  });

  if (!response.ok) {
    const err = new Error("HTTP error");
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const parts = (data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts) || [];

  // Join the text parts, skipping the model's private "thought" parts
  const text = parts
    .filter((p) => p.text && p.thought !== true)
    .map((p) => p.text)
    .join("");

  return text;
}

// ---------- Sending a message ----------
// shownText = what appears in your bubble
// sentText  = what is actually sent to the AI (usually the same)
async function sendMessage(shownText, sentText) {
  if (isBusy) return;
  const shown = (shownText || "").trim();
  if (!shown) return;

  if (!getKey()) {
    openKeyModal("Please paste your Gemini API key to start chatting.");
    return;
  }

  isBusy = true;
  sendBtn.disabled = true;
  startersEl.classList.add("hidden");

  addBubble("user", shown);
  history.push({ role: "user", parts: [{ text: sentText || shown }] });
  showThinking();

  try {
    const reply = await askGemini();
    hideThinking();
    if (!reply) {
      history.pop();
      addBubble("error", "I didn't get an answer that time. Please try sending your message again.");
    } else {
      history.push({ role: "model", parts: [{ text: reply }] });
      addBubble("bot", reply);
    }
  } catch (err) {
    hideThinking();
    history.pop(); // remove the failed message so you can retry cleanly
    if (err.status) {
      addBubble("error", friendlyError(err.status));
    } else {
      addBubble("error", "I can't reach the internet. Check your connection and try again.");
    }
  }

  isBusy = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

// ---------- Input box behavior ----------
function sendFromInput() {
  const text = inputEl.value;
  inputEl.value = "";
  autoGrow();
  sendMessage(text);
}

function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
}

inputEl.addEventListener("input", autoGrow);
inputEl.addEventListener("keydown", (e) => {
  // Enter sends. Shift+Enter makes a new line.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendFromInput();
  }
});
sendBtn.addEventListener("click", sendFromInput);

// ---------- Starter buttons ----------
function buildStarters() {
  startersEl.innerHTML = "";
  BOT_CONFIG.starterQuestions.forEach((question) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "starter-btn";
    btn.textContent = question;
    btn.addEventListener("click", () => {
      sendMessage(
        question,
        "Please ask me this question in your own encouraging words, then wait for my answer: " + question
      );
    });
    startersEl.appendChild(btn);
  });
}

// ---------- New chat ----------
function startNewChat() {
  history = [];
  isBusy = false;
  sendBtn.disabled = false;
  messagesEl.innerHTML = "";
  addBubble("bot", BOT_CONFIG.welcomeMessage);
  buildStarters();
  startersEl.classList.remove("hidden");
}

newChatBtn.addEventListener("click", startNewChat);

// ---------- Start ----------
startNewChat();
