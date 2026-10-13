chrome.runtime.onMessage.addListener((msg, sender) => {
  // The sound endpoint must not accept requests from Teams content scripts.
  // Only trusted extension-origin contexts may trigger alerts, never a Teams tab.
  // Service workers may not expose a stable sender.url across Chrome versions.
  const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
  const senderOrigin = sender?.url ? (() => { try { return new URL(sender.url).origin; } catch { return ''; } })() : extensionOrigin;
  if (msg?.action !== 'PLAY_ALERT_SOUND' ||
      sender?.id !== chrome.runtime.id || sender?.tab ||
      senderOrigin !== extensionOrigin) return;
  // Generates sound locally; does not load any external media.
  try {
    const context = new AudioContext();
    const start = context.currentTime;
    for (let i = 0; i < 2; i++) {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = i ? 640 : 850;
      volume.gain.setValueAtTime(0.0001, start + i * 0.22);
      volume.gain.exponentialRampToValueAtTime(0.15, start + i * 0.22 + 0.025);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.22 + 0.19);
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(start + i * 0.22);
      oscillator.stop(start + i * 0.22 + 0.20);
    }
    setTimeout(() => context.close().catch(() => {}), 850);
  } catch (err) { console.warn('音频播放失败', err); }
});
