import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";

const MODEL = "claude-opus-5-5";
const STORE_KEY = "life-agent:conversation";
const KEY_KEY = "life-agent:api-key";
const NAME_KEY = "life-agent:name";

const log = document.getElementById("log");
const empty = document.getElementById("empty");
const errorLine = document.getElementById("error");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendButton = document.getElementById("send");
const settings = document.getElementById("settings");
const keyField = document.getElementById("api-key");
const nameField = document.getElementById("agent-name");

// Browser storage can throw (private mode, blocked site data); the page still works without it.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

function systemPrompt(name) {
  return [
    "You are the user's life agent: a warm, thoughtful companion they talk to about their life —",
    "their day, goals, habits, relationships, work, decisions, worries and wins.",
    "",
    "Talk like a real person in a normal conversation, not like a report:",
    "- Keep replies short, usually two to five sentences, unless they ask for more.",
    "- Write in plain prose. No headings, no bullet lists, no bold text.",
    "- Ask at most one question at a time, and only when it moves the conversation forward.",
    "- Listen first. Reflect back what you heard before offering advice, and offer advice only when it's wanted.",
    "- Be honest and kind. Don't flatter, don't lecture.",
    "- Always reply in the language the user writes in (for example, French if they write in French).",
    "- Remember what they told you earlier in this conversation and build on it.",
    "- If they describe a crisis or danger to themselves or others, respond with care and encourage them to contact local emergency services or a crisis line.",
    name ? `\nThe user's name is ${name}.` : "",
  ].join("\n");
}

// A conversation is the exact message history sent to the API, plus the system prompt it began with.
// Both are kept byte-for-byte so earlier turns stay valid when replayed.
let conversation = load();
let busy = false;

function load() {
  try {
    const saved = JSON.parse(store.get(STORE_KEY));
    if (saved && Array.isArray(saved.messages) && typeof saved.system === "string") return saved;
  } catch {}
  return fresh();
}

function fresh() {
  return { system: systemPrompt(store.get(NAME_KEY) || ""), messages: [] };
}

function save() {
  store.set(STORE_KEY, JSON.stringify(conversation));
}

function textOf(content) {
  if (typeof content === "string") return content;
  return content.filter((block) => block.type === "text").map((block) => block.text).join("");
}

function addBubble(role, text) {
  empty.hidden = true;
  const el = document.createElement("div");
  el.className = `msg msg--${role}`;
  el.textContent = text;
  log.append(el);
  scrollDown();
  return el;
}

function scrollDown() {
  log.scrollTop = log.scrollHeight;
}

function render() {
  log.querySelectorAll(".msg").forEach((el) => el.remove());
  empty.hidden = conversation.messages.length > 0;
  for (const message of conversation.messages) {
    addBubble(message.role === "user" ? "user" : "agent", textOf(message.content));
  }
}

function showError(text) {
  errorLine.textContent = text;
  errorLine.hidden = !text;
}

function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
}

function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 2}px`;
}

function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Your API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use this model.";
  if (err instanceof Anthropic.RateLimitError) return "Too many messages at once. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your connection and try again.";
  if (err instanceof Anthropic.APIError) return `Something went wrong (${err.status ?? "error"}). Please try again.`;
  return "Something went wrong. Please try again.";
}

async function send(text) {
  const apiKey = store.get(KEY_KEY);
  if (!apiKey) {
    openSettings();
    return;
  }

  showError("");
  setBusy(true);
  const userMessage = { role: "user", content: text };
  addBubble("user", text);
  const bubble = addBubble("agent", "");
  bubble.classList.add("is-waiting");

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      system: conversation.system,
      messages: [...conversation.messages, userMessage],
      output_config: { effort: "medium" },
      // If the model declines, Anthropic re-runs the turn on a recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    let shown = "";
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "fallback") {
        // The first model stopped partway; the fallback model starts the reply over.
        shown = "";
        bubble.textContent = "";
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        shown += event.delta.text;
        bubble.classList.remove("is-waiting");
        bubble.textContent = shown;
        scrollDown();
      }
    }

    const reply = await stream.finalMessage();
    bubble.classList.remove("is-waiting");

    if (reply.stop_reason === "refusal") {
      bubble.remove();
      log.lastElementChild?.remove();
      input.value = text;
      autoGrow();
      showError("Your agent couldn't answer that one. Try putting it another way.");
      return;
    }

    bubble.textContent = textOf(reply.content);
    // Keep the full reply (not just its text) so the next turn replays it unchanged.
    conversation.messages.push(userMessage, { role: "assistant", content: reply.content });
    save();
  } catch (err) {
    bubble.remove();
    log.lastElementChild?.remove();
    if (!conversation.messages.length) empty.hidden = false;
    input.value = text;
    autoGrow();
    showError(describe(err));
  } finally {
    setBusy(false);
    input.focus();
  }
}

function openSettings() {
  keyField.value = store.get(KEY_KEY) || "";
  nameField.value = store.get(NAME_KEY) || "";
  settings.showModal();
}

settings.addEventListener("close", () => {
  if (settings.returnValue !== "save") return;
  const key = keyField.value.trim();
  const name = nameField.value.trim();
  if (key) store.set(KEY_KEY, key); else store.remove(KEY_KEY);
  const nameChanged = name !== (store.get(NAME_KEY) || "");
  if (name) store.set(NAME_KEY, name); else store.remove(NAME_KEY);
  // The system prompt is fixed for a conversation; a new name applies right away only before it starts.
  if (nameChanged && !conversation.messages.length) {
    conversation = fresh();
    save();
  }
  showError("");
  input.focus();
});

document.getElementById("open-settings").addEventListener("click", openSettings);

document.getElementById("new-chat").addEventListener("click", () => {
  if (busy) return;
  if (conversation.messages.length && !confirm("Start a new conversation? This one will be cleared.")) return;
  conversation = fresh();
  save();
  render();
  showError("");
  input.focus();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  autoGrow();
  send(text);
});

input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

render();
if (!store.get(KEY_KEY)) openSettings(); else input.focus();
