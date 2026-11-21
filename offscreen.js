chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'copy') return false;
  const ta = document.getElementById('buffer');
  ta.value = msg.text;
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.value = '';
  sendResponse(ok);
  return false;
});
