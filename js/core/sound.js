// Optional sounds and spoken prompts, both off until switched on in the menu.
// Clicks are a short synthesised "tock" (no audio files); prompts use the phone's own voice.

import * as store from "./store.js";

export const soundSettings = () => ({ clicks: false, voice: false, ...store.read(store.KEYS.sound, {}) });
export const setSound = (change) => store.write(store.KEYS.sound, { ...soundSettings(), ...change });
export const canSpeak = () => "speechSynthesis" in window;

let audio = null;

/** Feedback for a tap: a little vibration, and a click if sounds are on. */
export function tap() {
  navigator.vibrate?.(8);
  if (!soundSettings().clicks) return;
  try {
    audio ||= new AudioContext();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.05);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch {}
}

let lastSaid = "";

/** Say what's next, once per change (repeating the same line would get old fast). */
export function say(text) {
  if (!text || text === lastSaid) return;
  lastSaid = text;
  if (!soundSettings().voice || !canSpeak()) return;
  try {
    speechSynthesis.cancel();
    const line = new SpeechSynthesisUtterance(text);
    line.lang = navigator.language || "en-GB";
    line.rate = 1.02;
    speechSynthesis.speak(line);
  } catch {}
}

/** Say something now even if it was the last thing said (e.g. testing the voice). */
export function sayNow(text) {
  lastSaid = "";
  say(text);
}
