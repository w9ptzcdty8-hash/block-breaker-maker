const NOTES = [261.63, 329.63, 392, 523.25];

export class AudioManager {
  constructor(settings) {
    this.bgmEnabled = settings.bgm;
    this.seEnabled = settings.se;
    this.context = null;
    this.bgmTimer = null;
    this.noteIndex = 0;
  }

  ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      this.context = new AudioContextClass();
    }
    if (this.context.state === "suspended") this.context.resume().catch(() => {});
    return this.context;
  }

  setBgmEnabled(enabled) {
    this.bgmEnabled = enabled;
    if (!enabled) this.stopBgm();
  }

  setSeEnabled(enabled) {
    this.seEnabled = enabled;
  }

  tone(frequency, duration = 0.08, volume = 0.05, type = "sine", delay = 0) {
    const context = this.ensureContext();
    if (!context) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  playSe(name) {
    if (!this.seEnabled) return;
    const sounds = {
      launch: [420, 0.08, 0.045, "square"],
      paddle: [250, 0.045, 0.035, "sine"],
      hit: [500, 0.04, 0.03, "square"],
      break: [700, 0.06, 0.035, "triangle"],
      explosion: [95, 0.18, 0.07, "sawtooth"],
      item: [880, 0.12, 0.05, "sine"],
      life: [1046.5, 0.18, 0.055, "sine"],
      miss: [150, 0.28, 0.05, "triangle"],
      gameover: [110, 0.55, 0.06, "sawtooth"],
    };
    const sound = sounds[name] || sounds.hit;
    this.tone(...sound);
  }

  playClear() {
    if (!this.seEnabled) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
      this.tone(note, 0.18, 0.05, "sine", index * 0.1);
    });
  }

  startBgm() {
    if (!this.bgmEnabled || this.bgmTimer) return;
    this.ensureContext();
    const playNote = () => {
      if (this.bgmEnabled) {
        this.tone(NOTES[this.noteIndex % NOTES.length], 0.16, 0.012, "triangle");
        this.noteIndex += 1;
      }
    };
    playNote();
    this.bgmTimer = window.setInterval(playNote, 460);
  }

  stopBgm() {
    if (this.bgmTimer) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }
}
