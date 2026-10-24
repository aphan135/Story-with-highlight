function note(ctx: AudioContext, frequency: number, offset: number, duration: number, volume: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + offset;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.008);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(start);
  oscillator.stop(start + duration);
}

export function yourTurn(ctx: AudioContext) {
  note(ctx, 660, 0, 0.09, 0.08);
  note(ctx, 880, 0.09, 0.09, 0.08);
}

export function heard(ctx: AudioContext) { note(ctx, 520, 0, 0.05, 0.05); }
