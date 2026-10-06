// Speech in and out for the Life Agent, built on the browser's Web Speech API.
// Nothing here talks to a server of ours: recognition and voices come from the browser.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = Boolean(Recognition);
export const canSpeak = "speechSynthesis" in window;

// Reads a reply aloud sentence by sentence while it is still being written.
export class Speaker {
  constructor() {
    this.lang = "en-US";
    this.buffer = "";
    this.pending = 0;
    this.finished = false;
    this.onDone = null;
    this.generation = 0;
    this.active = false;
  }

  // Browsers on phones only speak after a tap; call this from one.
  unlock() {
    if (!canSpeak) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  start(lang, onDone) {
    this.stop();
    this.lang = lang;
    this.onDone = onDone;
    this.active = true;
  }

  // Feed newly written text; whole sentences are spoken as soon as they're complete.
  push(delta) {
    if (!this.active) return;
    this.buffer += delta;
    const re = /[^.!?…\n]*[.!?…]+["»”)]*\s+|[^\n]*\n+/g;
    let match;
    let used = 0;
    while ((match = re.exec(this.buffer)) && match.index === used) {
      used = re.lastIndex;
      this.say(match[0]);
    }
    this.buffer = this.buffer.slice(used);
  }

  // The reply is complete: speak what's left and report when the voice falls silent.
  end() {
    if (!this.active) return;
    this.say(this.buffer);
    this.buffer = "";
    this.finished = true;
    this.check();
  }

  say(text) {
    const clean = text.replace(/[*_#`>|]/g, "").replace(/\s+/g, " ").trim();
    if (!clean || !canSpeak) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = this.lang;
    const voice = pickVoice(this.lang);
    if (voice) u.voice = voice;
    this.pending++;
    const generation = this.generation;
    const done = () => {
      // Utterances cut off by stop() report in late; they belong to an earlier reply.
      if (generation !== this.generation) return;
      this.pending--;
      this.check();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  check() {
    if (this.finished && this.pending <= 0 && this.onDone) {
      const cb = this.onDone;
      this.onDone = null;
      cb();
    }
  }

  // Fall silent now. Whoever was waiting for the voice to finish is released.
  stop() {
    const cb = this.onDone;
    this.onDone = null;
    this.active = false;
    this.buffer = "";
    this.pending = 0;
    this.finished = false;
    this.generation++;
    if (canSpeak) speechSynthesis.cancel();
    if (cb) cb();
  }
}

// Prefer a natural-sounding voice in the right language and region.
function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  const ranked = voices
    .filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(base))
    .map((v) => {
      let score = 0;
      if (v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) score += 4;
      if (/natural|neural|premium|enhanced|google/i.test(v.name)) score += 2;
      if (v.localService) score += 1;
      return { v, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.v ?? null;
}
if (canSpeak) speechSynthesis.getVoices();

// Listens for one thing said, showing words as they're heard. Resolves with the final text
// ("" if nothing was said) or rejects with the browser's error code.
export function listen(lang, onWords) {
  return new Promise((resolve, reject) => {
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    let failed = null;
    rec.onresult = (event) => {
      let interim = "";
      finalText = "";
      for (const result of event.results) {
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onWords((finalText + interim).trim());
    };
    rec.onerror = (event) => { failed = event.error; };
    rec.onend = () => {
      if (failed && failed !== "no-speech" && failed !== "aborted") reject(failed);
      else resolve(finalText.trim());
    };
    listen.current = rec;
    rec.start();
  });
}

export function stopListening() {
  listen.current?.abort();
  listen.current = null;
}
