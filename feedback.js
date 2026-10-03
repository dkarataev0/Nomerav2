/** Local generated audio. No files, network, continuous timers, or autoplay. */
export class Feedback {
  constructor() {
    this.settings = {soundEnabled: true, hapticsEnabled: true, reducedEffects: false};
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.voices = new Set();
  }

  configure(settings) {
    const wasEnabled = this.settings.soundEnabled;
    this.settings = {...this.settings, ...settings};
    if (wasEnabled && !this.settings.soundEnabled) this.stop();
    if (!this.settings.hapticsEnabled) this.#vibrate(0);
  }

  /** Invoke directly in a trusted pointer/click handler, before awaiting anything. */
  async unlock() {
    if (!this.settings.soundEnabled) return false;
    try {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AudioContextClass) return false;
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContextClass({latencyHint: 'interactive'});
        this.master = this.context.createGain();
        this.master.gain.value = 0.44;
        this.master.connect(this.context.destination);
        this.noiseBuffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.16), this.context.sampleRate);
        const samples = this.noiseBuffer.getChannelData(0);
        for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') await this.context.resume();
      return this.context.state === 'running';
    } catch {
      // Audio restrictions and unsupported hardware never interrupt the game.
      return false;
    }
  }

  play(event) {
    if (!this.settings.soundEnabled || !this.context || this.context.state !== 'running') return;
    const time = this.context.currentTime + 0.002;
    try {
      switch (event) {
        case 'rollTick':
          this.#tone(850, 620, time, 0.024, 0.065, 'triangle');
          this.#noise(time, 0.018, 0.035, 3600);
          break;
        case 'rollStop':
          this.#tone(180, 105, time, 0.16, 0.16);
          this.#tone(880, 560, time + 0.018, 0.1, 0.052, 'triangle');
          this.#noise(time, 0.07, 0.09, 1800);
          break;
        case 'commonReveal': this.#chime([330, 495], time, 0.16, 0.045); break;
        case 'uncommonReveal': this.#chime([392, 587], time, 0.23, 0.058); break;
        case 'rareReveal': this.#chime([523, 659, 784], time, 0.35, 0.06); break;
        case 'epicReveal':
          this.#chime([440, 660, 880, 1320], time, 0.48, 0.055);
          this.#tone(110, 82, time, 0.4, 0.11);
          break;
        case 'legendaryReveal':
          this.#tone(98, 49, time, 0.66, 0.23);
          this.#chime([392, 587, 784, 1175], time + 0.055, 0.88, 0.062);
          this.#noise(time, 0.12, 0.05, 1150);
          break;
        case 'moneyCounter': this.#tone(740, 1110, time, 0.09, 0.028, 'triangle'); break;
        case 'newTrait': this.#chime([620, 830], time, 0.14, 0.047); break;
        case 'record':
          this.#chime([523, 659, 784, 1046], time, 0.62, 0.072);
          this.#tone(131, 65, time, 0.38, 0.13);
          break;
        case 'buttonTap': this.#tone(480, 340, time, 0.045, 0.062, 'triangle'); break;
      }
    } catch {
      // An interrupted AudioContext can be unlocked by the next user gesture.
    }
  }

  haptic(event, rarity = 'common') {
    if (!this.settings.hapticsEnabled) return;
    const aliases = {tick: 'rollTick', stop: 'rollStop', trait: 'newTrait', tap: 'buttonTap'};
    const resolved = event === 'reveal' ? `${rarity}Reveal` : (aliases[event] ?? event);
    const patterns = {
      rollTick: 5, rollStop: 20, buttonTap: 7, newTrait: 9, moneyCounter: 4,
      commonReveal: 7, uncommonReveal: 12, rareReveal: [12, 28, 20],
      epicReveal: [18, 32, 26], legendaryReveal: [24, 38, 42, 50, 68],
      record: [24, 35, 24, 35, 45],
    };
    if (patterns[resolved] !== undefined) this.#vibrate(patterns[resolved]);
  }

  stop() {
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch { /* Already stopped. */ }
      for (const node of voice.nodes) {
        try { node.disconnect(); } catch { /* Already disconnected. */ }
      }
    }
    this.voices.clear();
    this.#vibrate(0);
  }

  #vibrate(pattern) {
    try {
      // Safari on iPhone has no Web Vibration API; the game works normally.
      if (globalThis.navigator?.userActivation && !globalThis.navigator.userActivation.hasBeenActive) return;
      globalThis.navigator?.vibrate?.(pattern);
    } catch { /* Optional device capability. */ }
  }

  #register(source, nodes) {
    const voice = {source, nodes};
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* Device was interrupted. */ }
      }
    };
  }

  #envelope(gain, time, duration, volume) {
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), time + Math.min(0.008, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  }

  #tone(frequency, destination, time, duration, volume, type = 'sine') {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(destination, time + duration);
    this.#envelope(gain, time, duration, volume);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.#register(oscillator, [oscillator, gain]);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.01);
  }

  #chime(frequencies, time, duration, volume) {
    frequencies.forEach((frequency, index) => {
      const delay = index * Math.min(0.065, duration * 0.16);
      this.#tone(frequency, frequency * 0.998, time + delay, duration, volume);
      if (duration >= 0.35) this.#tone(frequency, frequency, time + delay + 0.12, duration * 0.7, volume * 0.2);
    });
  }

  #noise(time, duration, volume, cutoff) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.6;
    this.#envelope(gain, time, duration, volume);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    this.#register(source, [source, filter, gain]);
    source.start(time);
    source.stop(time + duration + 0.005);
  }
}
