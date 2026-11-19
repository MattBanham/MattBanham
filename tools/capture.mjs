// Render the portfolio page's sections to PNG frames in ONE headless-Chromium session,
// stepping virtual time so animations advance smoothly and deterministically.
// usage: node capture.mjs <theme light|dark> <outdir>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const [theme = 'light', OUT = './out'] = process.argv.slice(2);
const CH = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const URL = 'http://127.0.0.1:8765/';
const W = 1000, DSF = 2, PORT = 9300 + (theme === 'dark' ? 1 : 0);
mkdirSync(OUT, { recursive: true });

const proc = spawn(CH, [`--remote-debugging-port=${PORT}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver;
for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(100); } }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const waiters = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  else if (m.method) for (const w of [...waiters]) if (w.method === m.method) { waiters.splice(waiters.indexOf(w), 1); w.res(m.params); }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const once = (method) => new Promise((res) => waiters.push({ method, res }));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
const s = (m, p) => send(m, p, S);
await s('Page.enable'); await s('Runtime.enable');
await s('Emulation.setDeviceMetricsOverride', { width: W, height: 7000, deviceScaleFactor: DSF, mobile: false });
await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
await s('Page.addScriptToEvaluateOnNewDocument', { source: `
  document.documentElement.dataset.theme = ${JSON.stringify(theme)};
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = clearTimeout;
  let seed = 7; Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
` });
await s('Page.navigate', { url: URL });
await once('Page.loadEventFired');
await s('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
await s('Runtime.evaluate', { expression: `(() => { const st = document.createElement('style');
  st.textContent = '.nav,.hint,.skip{display:none!important} .reveal{opacity:1!important;transform:none!important} *{transition:none!important} .feature-lg{grid-template-columns:.82fr 1.18fr!important} .feature-flip{grid-template-columns:1.18fr .82fr!important}';
  document.head.append(st); })()` });
await sleep(800);

// Resize viewport to the full page so every section counts as on-screen (demos pause when hidden).
const H = (await s('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })).result.value;
await s('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DSF, mobile: false });
// Start the lab's Biosphere so its frame shows a living world.
await s('Runtime.evaluate', { expression: "document.querySelector('#stageLoad').click()" });
await sleep(4000);

const seg = (await s('Runtime.evaluate', { returnByValue: true, expression: `(() => {
  const r = (q) => document.querySelector(q).getBoundingClientRect();
  const y = (v) => Math.round(v + scrollY);
  const arc = r('.feature-lg:not(.feature-flip)'), vs = r('.feature-flip'), grid = r('.feature-grid'),
        work = r('#work'), lab = r('#lab'), foot = r('.foot'), hero = r('.hero');
  return [
    { name: 'hero',  y0: y(hero.top),       y1: y(work.top),        frames: 48, step: 140 },
    { name: 'work',  y0: y(work.top),       y1: y(arc.top) - 10 },
    { name: 'arc',   y0: y(arc.top) - 10,   y1: y(arc.bottom) + 10, frames: 165, step: 100 },
    { name: 'voicescript', y0: y(vs.top) - 10, y1: y(vs.bottom) + 10, frames: 210, step: 100 },
    { name: 'orqara', y0: y(vs.bottom) + 10, y1: y(grid.bottom) },
    { name: 'lab',   y0: y(grid.bottom),    y1: y(lab.bottom) },
    { name: 'more',  y0: y(lab.bottom),     y1: y(foot.bottom) },
  ];
})()` })).result.value;
writeFileSync(`${OUT}/segments.json`, JSON.stringify(seg, null, 2));

const shot = async (sg, file) => {
  const { data } = await s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: sg.y0, width: W, height: sg.y1 - sg.y0, scale: 1 } });
  writeFileSync(file, Buffer.from(data, 'base64'));
};
for (const sg of seg.filter((x) => !x.frames)) await shot(sg, `${OUT}/${sg.name}.png`);

// Animated segments: pause virtual time, then advance it one frame-step at a time.
await s('Emulation.setVirtualTimePolicy', { policy: 'pause' });
for (const sg of seg.filter((x) => x.frames)) {
  mkdirSync(`${OUT}/${sg.name}`, { recursive: true });
  for (let i = 0; i < sg.frames; i++) {
    const done = once('Emulation.virtualTimeBudgetExpired');
    await s('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: sg.step });
    await done;
    await shot(sg, `${OUT}/${sg.name}/f${String(i).padStart(4, '0')}.png`);
  }
}
ws.close(); proc.kill();
console.log(theme, 'done', seg.map((x) => `${x.name}:${x.y1 - x.y0}`).join(' '));
