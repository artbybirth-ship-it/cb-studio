/**
 * A short chime when an export finishes (two rising notes) or fails (two falling ones). Made with
 * Web Audio, no sound file. Browsers only allow sound after a click, so unlockChime() runs on the
 * Export click and the chime can play minutes later when the export is done.
 */
let context: AudioContext | null = null;

export function unlockChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    context = context || new AudioContextClass();
    if (context.state === "suspended") void context.resume();
  } catch { /* no sound on this browser */ }
}

export function playChime(kind: "done" | "error" = "done") {
  if (!context) return;
  const notes = kind === "done" ? [880, 1318.5] : [392, 261.6];
  const start = context.currentTime + 0.02;
  notes.forEach((frequency, index) => {
    const at = start + index * 0.16;
    const oscillator = context!.createOscillator();
    const gain = context!.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    oscillator.connect(gain).connect(context!.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.5);
  });
}
