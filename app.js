/* ════════════════════════════════════════════════════════════
   GoldFlow Studio — логика студии
   Сценарий → Кадры → Озвучка → Сборка → Плеер/Экспорт
   Один API: Base URL + токен. Всё хранится в localStorage.
   ════════════════════════════════════════════════════════════ */
'use strict';

/* ────────── утилиты ────────── */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function toast(msg, type = 'ok', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
}
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function download(href, name) {
  const a = document.createElement('a');
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* переполнение — игнорируем */ } }
function loadJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }

/* ────────── настройки: ОДИН URL + ОДИН ТОКЕН ────────── */
const LS_KEY = 'goldflow_api_v2';

const DEFAULTS = {
  base: 'https://api.openai.com/v1',
  key: '',
  textModel: 'gpt-4o-mini',
  imgModel: 'gpt-image-1',
  voiceModel: 'gpt-4o-mini-tts',
  voice: 'alloy'
};

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];

const SCENE_COUNT = { 15: 3, 30: 5, 60: 9 };

const STYLE_EN = {
  'Кинематографично': 'cinematic film still, dramatic volumetric lighting, shallow depth of field',
  'Аниме': 'vibrant detailed anime illustration, studio quality',
  '3D-рендер': 'polished 3D render, octane, soft studio lighting',
  'Фотореализм': 'photorealistic, ultra detailed, natural light, 50mm photo',
  'Киберпанк': 'cyberpunk neon aesthetics, rain, glowing signs, high contrast',
  'Акварель': 'soft watercolor painting, paper texture, delicate palette',
  'Комикс': 'bold comic book art, ink outlines, halftone shading',
  'Ретро-постер': 'retro print poster, grainy texture, limited vintage palette',
  'Минимализм': 'clean minimal composition, lots of negative space, subtle tones',
  'Фэнтези-арт': 'epic fantasy concept art, dramatic scale, magical atmosphere',
  'Нуар': 'high contrast black and white noir, hard shadows, smoke',
  'Пиксель-арт': 'detailed pixel art, 16-bit palette, crisp pixels'
};

let settings = Object.assign({}, DEFAULTS, loadJSON(LS_KEY, {}));
let project = null;   // текущий проект
let running = false;  // идёт генерация

/* ────────── состояние шагов ────────── */
const STEP_DEFAULTS = {
  stepScript: 'AI-сценарист: хук, сцены, SEO-название',
  stepImages: 'Генерация вертикальных картинок под каждую сцену',
  stepVoice:  'Реалистичный голос нейросети',
  stepBuild:  'Таймлайн, субтитры, плеер и экспорт'
};
function setStep(id, state, info) {
  const el = $('#' + id);
  el.className = 'step ' + state;
  const label = { idle: '', run: '…', ok: '✓', err: '✗', skip: '—' }[state] || '';
  el.querySelector('.step-state').textContent = label;
  el.querySelector('.step-info').textContent = info != null ? info : STEP_DEFAULTS[id];
}
function resetSteps() {
  Object.keys(STEP_DEFAULTS).forEach(id => setStep(id, 'idle'));
}

/* ════════════════════════════════════════════════
   API-СЛОЙ — всё через один base + один токен
   ════════════════════════════════════════════════ */

function authHeaders() {
  return { 'Authorization': 'Bearer ' + settings.key, 'Content-Type': 'application/json' };
}

function apiError(status, body) {
  const msg = (body && body.error && (body.error.message || body.error.code)) ||
              (body && body.detail && (body.detail.message || body.detail)) || '';
  if (status === 401) return new Error('Токен не принят (401). Проверь API-ключ. ' + msg);
  if (status === 403) return new Error('Доступ запрещён (403). Возможно, у токена нет прав или нужна верификация аккаунта. ' + msg);
  if (status === 404) return new Error('Не найдено (404). Проверь Base URL и названия моделей. ' + msg);
  if (status === 429) return new Error('Лимит запросов исчерпан (429). Подожди немного или пополни баланс. ' + msg);
  return new Error('Ошибка API ' + status + '. ' + msg);
}
function networkError(e) {
  return new Error('Не удалось связаться с API (' + ((e && e.message) || 'network') + '). Проверь Base URL, интернет и что сервис разрешает запросы из браузера (CORS). Если открыл сайт двойным кликом (file://) и видишь эту ошибку — запусти папку локальным сервером: python -m http.server');
}

/* умный запрос: работает с любым провайдером; если адрес дали без /v1 — дописывает сам */
async function smartFetch(path, opts = {}, baseUrlOverride) {
  const b = (baseUrlOverride || base()).trim().replace(/\/+$/, '');
  const candidates = [b + path];
  if (!/\/v\d+[a-z]*$/.test(b)) candidates.push(b + '/v1' + path);
  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    let res;
    try {
      res = await fetch(candidates[i], opts);
    } catch (e) {
      lastErr = networkError(e);
      continue;
    }
    if (res.ok) {
      if (i > 0) {
        const fixed = candidates[i].slice(0, -path.length);
        if (baseUrlOverride && $('#apiBase')) $('#apiBase').value = fixed;
        else { settings.base = fixed; saveJSON(LS_KEY, settings); }
        toast('Base URL автоматически поправлен: ' + fixed, 'ok', 4000);
      }
      return res;
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* не json */ }
    const err = apiError(res.status, body);
    if (res.status === 404 && i < candidates.length - 1) { lastErr = err; continue; }
    throw err;
  }
  throw lastErr || new Error('Не удалось связаться с API.');
}

function base() { return (settings.base || '').trim().replace(/\/+$/, ''); }

/* JSON из ответа модели — модели любят оборачивать в ```json */
function extractJSON(text) {
  if (!text) throw new Error('Пустой ответ модели.');
  const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* дальше */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* дальше */ }
  }
  throw new Error('Модель вернула не-JSON. Попробуй ещё раз или смени текстовую модель в настройках.');
}

/* ── 1. сценарий: POST /chat/completions ── */
async function generateScript(brief) {
  const sys = 'Ты — сценарист вирусных вертикальных видео (YouTube Shorts, TikTok, Reels). Отвечаешь ТОЛЬКО валидным JSON-объектом без markdown-разметки и пояснений.';
  const user =
    'Сделай сценарий ролика на языке «' + brief.lang + '» длительностью ~' + brief.dur + ' секунд, ровно ' + brief.n + ' сцен.\n' +
    'Тема: ' + brief.topic + '\n' +
    'Визуальный стиль: ' + brief.style + '.\n\n' +
    'Верни JSON строго такой структуры:\n' +
    '{"title":"цепляющее название до 60 знаков на ' + brief.lang + '",' +
    '"description":"описание для YouTube в 1-2 предложениях на ' + brief.lang + '",' +
    '"tags":["8 релевантных тегов"],' +
    '"scenes":[' +
    '{"narration":"реплика диктора, 1-2 предложения на ' + brief.lang + ', разговорный темп",' +
    '"imagePrompt":"детальный промпт картинки ТОЛЬКО НА АНГЛИЙСКОМ, вертикальная композиция 9:16, единые персонажи/палитра/стиль на все сцены: ' + (STYLE_EN[brief.style] || 'cinematic') + '",' +
    '"onScreen":"короткая фраза 2-5 слов на ' + brief.lang + ' для крупного текста на экране"}]}\n' +
    'Требования: первая сцена — мощный хук с первых слов; последняя — призыв к действию; реплики сцен не должны повторяться.';

  const res = await smartFetch('/chat/completions', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: settings.textModel,
      temperature: 0.85,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
    })
  });
  const data = await res.json();
  const content = data && data.choices && data.choices[0] &&
                  (data.choices[0].message && data.choices[0].message.content || data.choices[0].text);
  const j = extractJSON(content);
  if (!Array.isArray(j.scenes) || !j.scenes.length) throw new Error('В сценарии нет сцен — попробуй ещё раз.');
  j.scenes = j.scenes.slice(0, brief.n);
  return j;
}

/* ── 2. кадры: POST /images/generations (размер подбирается под провайдера) ── */
async function generateImage(prompt) {
  const isDalle = /^dall-e/.test(settings.imgModel);
  const sizes = isDalle ? ['1024x1792', '1024x1024'] : ['1024x1536', '1024x1024', 'auto'];
  let lastErr = null;
  for (const size of sizes) {
    const body = { model: settings.imgModel, prompt, n: 1, size };
    if (isDalle) body.response_format = 'b64_json';
    let res;
    try {
      res = await smartFetch('/images/generations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
    } catch (e) {
      lastErr = e;
      if (/API 400\./.test(e.message)) continue; /* размер не подошёл — пробуем следующий */
      throw e;
    }
    const data = await res.json();
    const item = data && data.data && data.data[0];
    if (!item) throw new Error('Пустой ответ генерации картинок.');
    if (item.b64_json) return { src: 'data:image/png;base64,' + item.b64_json, remote: false };
    if (item.url) {
      try {
        const r = await fetch(item.url);
        const blob = await r.blob();
        return { src: URL.createObjectURL(blob), remote: false };
      } catch (e) {
        return { src: item.url, remote: true }; /* canvas будет «tainted» — экспорт может не сработать */
      }
    }
    throw new Error('В ответе нет ни b64_json, ни url.');
  }
  throw lastErr || new Error('Картинка не сгенерировалась.');
}

/* ── 3. озвучка: POST /audio/speech ── */
async function generateSpeech(text) {
  const res = await smartFetch('/audio/speech', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: settings.voiceModel,
      input: text,
      voice: settings.voice || 'alloy',
      response_format: 'mp3'
    })
  });
  const blob = await res.blob();
  if (!blob || blob.size < 200) throw new Error('TTS вернул пустой файл.');
  if ((blob.type || '').includes('json')) {
    const txt = await blob.text();
    throw new Error('TTS вернул ошибку: ' + txt.slice(0, 200));
  }
  return blob;
}

/* ── аудио-контекст ── */
let actx = null, master = null;
function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = 1;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

/* ════════════════════════════════════════════════
   КОНВЕЙЕР ГЕНЕРАЦИИ
   ════════════════════════════════════════════════ */

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx], idx); } catch (e) { /* ошибка сохранена внутри fn */ }
    }
  });
  await Promise.all(workers);
}

function renderSceneCards() {
  const wrap = $('#scenes');
  wrap.hidden = false;
  wrap.innerHTML = '';
  project.scenes.forEach((sc, i) => {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.id = 'scene' + i;
    card.innerHTML =
      '<div class="scene-thumb">' +
        '<div class="ph">кадр ' + (i + 1) + '…</div>' +
        '<span class="scene-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="scene-audio-dot" data-audio></span>' +
        '<div class="scene-tools">' +
          '<button type="button" title="Перегенерировать кадр" data-ri="' + i + '">🎨</button>' +
          '<button type="button" title="Перегенерировать озвучку" data-ra="' + i + '">🔊</button>' +
        '</div>' +
      '</div>' +
      '<p>' + (sc.narration || '').replace(/</g, '&lt;') + '</p>';
    wrap.appendChild(card);
  });
  wrap.querySelectorAll('[data-ri]').forEach(b => b.addEventListener('click', () => retrySceneImage(+b.dataset.ri)));
  wrap.querySelectorAll('[data-ra]').forEach(b => b.addEventListener('click', () => retrySceneAudio(+b.dataset.ra)));
}

function updateSceneCard(i) {
  const sc = project.scenes[i];
  const card = $('#scene' + i);
  if (!card) return;
  const thumb = card.querySelector('.scene-thumb');
  if (sc.imgSrc) {
    let img = thumb.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = 'кадр ' + (i + 1);
      thumb.prepend(img);
    }
    img.src = sc.imgSrc;
    thumb.querySelector('.ph').style.display = 'none';
  } else if (sc.imgError) {
    thumb.querySelector('.ph').textContent = 'ошибка';
  }
  const dot = card.querySelector('[data-audio]');
  if (sc.audioBlob) { dot.textContent = '🔊'; dot.title = 'озвучка готова'; }
  else if (sc.audioError) { dot.textContent = '🔇'; dot.title = sc.audioError; }
  card.classList.toggle('done', !!sc.imgSrc && (!!sc.audioBlob || !project.wantVoice));
  card.classList.toggle('error', !!sc.imgError || (!!sc.audioError && project.wantVoice));
}

async function sceneImageTask(i) {
  const sc = project.scenes[i];
  sc.imgError = null;
  try {
    const r = await generateImage(sc.imagePrompt);
    sc.imgSrc = r.src; sc.imgRemote = r.remote;
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = sc.imgSrc; });
    sc.imgEl = img;
  } catch (e) {
    sc.imgError = e.message;
  }
  updateSceneCard(i);
  const done = project.scenes.filter(s => s.imgSrc).length;
  const left = project.scenes.filter(s => !s.imgSrc && !s.imgError).length;
  if (left) setStep('stepImages', 'run', 'Кадр готов: ' + done + '/' + project.scenes.length + '…');
  else setStep('stepImages', done ? 'ok' : 'err', done + '/' + project.scenes.length + ' кадров' + (done < project.scenes.length ? ' · кнопкой 🎨 можно перегенерировать' : ''));
}

async function sceneAudioTask(i) {
  const sc = project.scenes[i];
  sc.audioError = null;
  try {
    const blob = await generateSpeech(sc.narration);
    sc.audioBlob = blob;
    const ab = await blob.arrayBuffer();
    sc.audioBuffer = await ensureAudio().decodeAudioData(ab);
  } catch (e) {
    sc.audioError = e.message;
  }
  updateSceneCard(i);
  const have = project.scenes.filter(s => s.audioBlob).length;
  const left = project.scenes.filter(s => !s.audioBlob && !s.audioError).length;
  if (left) setStep('stepVoice', 'run', 'Озвучка готова: ' + have + '/' + project.scenes.length + '…');
  else setStep('stepVoice', have ? 'ok' : (project.wantVoice ? 'err' : 'skip'), have + '/' + project.scenes.length + ' озвучек' + (have < project.scenes.length ? ' · кнопкой 🔊 можно повторить' : ''));
}

async function retrySceneImage(i) {
  if (running) return toast('Дождись окончания текущей генерации.', 'err');
  if (!settings.key) return openSettings();
  const card = $('#scene' + i);
  card.classList.remove('error');
  const ph = card.querySelector('.ph'); ph.style.display = ''; ph.textContent = 'кадр ' + (i + 1) + '…';
  await sceneImageTask(i);
  rebuildAfterRetry();
  const sc = project.scenes[i];
  toast(sc.imgSrc ? 'Кадр ' + (i + 1) + ' обновлён.' : 'Не вышло: ' + (sc.imgError || 'ошибка'), sc.imgSrc ? 'ok' : 'err', 3000);
}
async function retrySceneAudio(i) {
  if (running) return toast('Дождись окончания текущей генерации.', 'err');
  if (!settings.key) return openSettings();
  await sceneAudioTask(i);
  rebuildAfterRetry();
  const sc = project.scenes[i];
  toast(sc.audioBlob ? 'Озвучка сцены ' + (i + 1) + ' обновлена.' : 'Не вышло: ' + (sc.audioError || 'ошибка'), sc.audioBlob ? 'ok' : 'err', 3000);
}

function rebuildAfterRetry() {
  buildTimeline();
  drawFrame(playerT());
  renderDownloads();
}

/* ── главный запуск ── */
async function onGenerate(e) {
  e.preventDefault();
  if (running) return;
  const topic = $('#topic').value.trim();
  if (topic.length < 3) { toast('Сначала впиши тему ролика.', 'err'); $('#topic').focus(); return; }
  if (!settings.key || !base()) {
    openSettings();
    toast('Сначала вставь Base URL и токен своего API в настройках.', 'err');
    return;
  }

  stopPlayback();
  running = true;
  const btn = $('#generate');
  btn.disabled = true; btn.textContent = '⏳ Генерация…';
  $('#result').hidden = true; $('#emptyState').style.display = 'none';
  resetSteps();

  const brief = {
    topic,
    dur: +$('#dur').value,
    style: $('#style').value,
    lang: $('#lang').value,
    n: SCENE_COUNT[+$('#dur').value] || 5
  };
  project = {
    brief, wantVoice: $('#wantVoice').checked,
    wantSubs: $('#wantSubs').checked,
    title: '', description: '', tags: [],
    scenes: []
  };

  try {
    /* 1. сценарий */
    setStep('stepScript', 'run', 'Пишу сценарий…');
    const j = await generateScript(brief);
    project.title = j.title || 'Без названия';
    project.description = j.description || '';
    project.tags = Array.isArray(j.tags) ? j.tags : [];
    project.scenes = j.scenes.map(s => ({
      narration: s.narration || '', imagePrompt: s.imagePrompt || s.narration || brief.topic,
      onScreen: s.onScreen || '', imgSrc: null, imgEl: null, imgRemote: false, imgError: null,
      audioBlob: null, audioBuffer: null, audioError: null, duration: 0, start: 0, subs: []
    }));
    setStep('stepScript', 'ok', 'Сцен: ' + project.scenes.length + ' · «' + project.title.slice(0, 40) + '»');
    renderSceneCards();

    /* 2. кадры */
    setStep('stepImages', 'run', 'Кадр 0/' + project.scenes.length + '…');
    await pool(project.scenes, 2, (_, i) => sceneImageTask(i));
    const okImg = project.scenes.filter(s => s.imgSrc).length;
    if (!okImg) {
      setStep('stepImages', 'err', 'Все кадры упали: ' + (project.scenes[0].imgError || ''));
      throw new Error('Кадры не сгенерировались: ' + (project.scenes[0].imgError || 'проверь токен и модель картинок в настройках'));
    }

    /* 3. озвучка */
    if (project.wantVoice) {
      setStep('stepVoice', 'run', 'Озвучка 0/' + project.scenes.length + '…');
      await pool(project.scenes, 2, (_, i) => sceneAudioTask(i));
    } else {
      setStep('stepVoice', 'skip', 'Озвучка отключена — ролик будет тихим с субтитрами');
    }

    /* 4. сборка */
    setStep('stepBuild', 'run', 'Собираю таймлайн и субтитры…');
    buildTimeline();
    await document.fonts.ready;
    showResult();
    setStep('stepBuild', 'ok', 'Готово! Длина ролика ' + fmtTime(project.total));

    toast('Ролик собран: ' + fmtTime(project.total) + '. Жми ▶ для просмотра или «Записать видео».', 'ok', 6000);
  } catch (err) {
    toast(err.message, 'err', 7000);
  } finally {
    running = false;
    btn.disabled = false; btn.textContent = '⚡ Сгенерировать ролик';
  }
}

/* ════════════════════════════════════════════════
   ТАЙМЛАЙН / СУБТИТРЫ
   ════════════════════════════════════════════════ */

function splitSubs(text) {
  const chunks = [];
  const parts = String(text || '').split(/(?<=[.!?…])\s+/).flatMap(s => s.trim() ? [s.trim()] : []);
  for (const p of parts) {
    if (p.length <= 44) { chunks.push(p); continue; }
    let cur = '';
    for (const w of p.split(/\s+/)) {
      if ((cur + ' ' + w).trim().length > 44) { if (cur) chunks.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
    }
    if (cur) chunks.push(cur);
  }
  return chunks.length ? chunks : [''];
}

function buildTimeline() {
  if (!project) return;
  let t = 0;
  project.scenes.forEach(sc => {
    if (sc.audioBuffer) sc.duration = sc.audioBuffer.duration + 0.45;
    else {
      const words = (sc.narration || '').split(/\s+/).filter(Boolean).length;
      sc.duration = Math.min(7.5, Math.max(2.6, words / 2.4));
    }
    sc.start = t;
    const subs = splitSubs(sc.narration);
    const seg = sc.duration / Math.max(1, subs.length);
    sc.subs = subs.map((s, k) => ({ text: s, t0: k * seg, t1: (k + 1) * seg }));
    t += sc.duration;
  });
  project.total = t || 1;
  updateTimeLabel(0);
}

/* ════════════════════════════════════════════════
   ПЛЕР (canvas + WebAudio)
   ════════════════════════════════════════════════ */

const canvas = $('#stage');
const g = canvas.getContext('2d');
let sources = [], rafId = 0, playing = false, playT0 = 0, pausedAt = 0, recording = false, recorder = null, recChunks = [];

function playerT() {
  if (!project) return 0;
  if (playing && actx) return Math.min(project.total, actx.currentTime - playT0);
  return pausedAt;
}

function drawCoverImg(img, scale, dx, dy) {
  const W = canvas.width, H = canvas.height;
  const k = Math.max(W / img.width, H / img.height) * scale;
  const w = img.width * k, h = img.height * k;
  g.drawImage(img, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
}

function wrapText(text, maxW, font) {
  g.font = font;
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawFrame(t) {
  if (!project) return;
  const W = canvas.width, H = canvas.height;
  const scenes = project.scenes;
  let i = 0;
  for (let k = 0; k < scenes.length; k++) if (t >= scenes[k].start) i = k;
  const sc = scenes[i];
  const local = Math.min(sc.duration, Math.max(0, t - sc.start));
  const p = sc.duration ? local / sc.duration : 0;

  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);

  if (sc.imgEl) {
    drawCoverImg(sc.imgEl, 1.06 + 0.10 * p, (i % 2 ? -1 : 1) * 18 * p, 10 * p);
  } else {
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#221C12'); grad.addColorStop(1, '#0B0908');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(232,193,90,.5)'; g.font = '600 30px "Geist Mono", monospace';
    g.textAlign = 'center'; g.fillText('кадр ' + (i + 1), W / 2, H / 2);
  }

  /* затемнение снизу под субтитры */
  const ov = g.createLinearGradient(0, H * 0.55, 0, H);
  ov.addColorStop(0, 'rgba(0,0,0,0)'); ov.addColorStop(1, 'rgba(0,0,0,.72)');
  g.fillStyle = ov; g.fillRect(0, H * 0.55, W, H * 0.45);

  /* крупный onScreen текст сверху сцены */
  if (sc.onScreen && p < 0.75) {
    const pop = Math.min(1, p * 6);
    const a = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.15;
    g.save();
    g.globalAlpha = Math.max(0, a);
    const fs = Math.round(52 * (0.92 + 0.08 * pop));
    const lines = wrapText(sc.onScreen.toUpperCase(), W - 120, '900 ' + fs + 'px Onest, sans-serif');
    let y = 210 - (lines.length - 1) * fs * 0.6;
    g.textAlign = 'center';
    for (const ln of lines) {
      g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineJoin = 'round';
      g.font = '900 ' + fs + 'px Onest, sans-serif';
      g.strokeText(ln, W / 2, y);
      const grad = g.createLinearGradient(0, y - fs, 0, y);
      grad.addColorStop(0, '#F6E27A'); grad.addColorStop(1, '#D4AF37');
      g.fillStyle = grad;
      g.fillText(ln, W / 2, y);
      y += fs * 1.18;
    }
    g.restore();
  }

  /* субтитры */
  if (project.wantSubs) {
    const cur = sc.subs.find(s => local >= s.t0 && local < s.t1) || (local >= sc.duration ? sc.subs[sc.subs.length - 1] : null);
    if (cur && cur.text) {
      const fs = 40;
      const lines = wrapText(cur.text, W - 100, '800 ' + fs + 'px Onest, sans-serif');
      let y = H - 170 - (lines.length - 1) * fs * 0.62;
      g.textAlign = 'center';
      for (const ln of lines) {
        g.font = '800 ' + fs + 'px Onest, sans-serif';
        g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineJoin = 'round';
        g.strokeText(ln, W / 2, y);
        g.fillStyle = '#FFFFFF';
        g.fillText(ln, W / 2, y);
        y += fs * 1.22;
      }
    }
  }

  /* бренд + прогресс */
  g.textAlign = 'left';
  g.font = '500 22px "Geist Mono", monospace';
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.fillText('◆ GOLDFLOW', 28, 52);

  g.fillStyle = 'rgba(255,255,255,.18)';
  g.fillRect(24, H - 30, W - 48, 5);
  const grad = g.createLinearGradient(24, 0, W - 24, 0);
  grad.addColorStop(0, '#F6E27A'); grad.addColorStop(1, '#D4AF37');
  g.fillStyle = grad;
  g.fillRect(24, H - 30, (W - 48) * Math.min(1, t / project.total), 5);

  updateTimeLabel(t);
}

function updateTimeLabel(t) {
  if (!project) return;
  $('#timeLabel').textContent = fmtTime(t) + ' / ' + fmtTime(project.total);
}

function scheduleAudio(fromT) {
  stopSources();
  const now = actx.currentTime + 0.03;
  project.scenes.forEach(sc => {
    if (!sc.audioBuffer) return;
    const when = now + (sc.start - fromT);
    if (when < now - 0.02) return; /* сцена уже прошла */
    const src = actx.createBufferSource();
    src.buffer = sc.audioBuffer;
    src.connect(master);
    src.start(Math.max(now, when));
    sources.push(src);
  });
}
function stopSources() {
  sources.forEach(s => { try { s.stop(); s.disconnect(); } catch (e) {} });
  sources = [];
}

function startLoop() {
  cancelAnimationFrame(rafId);
  const loop = () => {
    if (!playing) return;
    const t = actx.currentTime - playT0;
    drawFrame(Math.min(t, project.total));
    if (t >= project.total) { onEnded(); return; }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function playFrom(t) {
  ensureAudio();
  playT0 = actx.currentTime - t;
  pausedAt = 0;
  playing = true;
  $('#playBtn').classList.add('hidden');
  scheduleAudio(t);
  startLoop();
}
function pausePlayback() {
  if (!playing) return;
  pausedAt = actx.currentTime - playT0;
  playing = false;
  cancelAnimationFrame(rafId);
  if (actx) actx.suspend();
  stopSources();
  $('#playBtn').classList.remove('hidden');
}
function stopPlayback() {
  playing = false; pausedAt = 0;
  cancelAnimationFrame(rafId);
  stopSources();
  if (actx && actx.state === 'suspended') actx.resume();
  $('#playBtn').classList.remove('hidden');
  if (project) { drawFrame(0); updateTimeLabel(0); }
}
function onEnded() {
  playing = false; pausedAt = 0;
  cancelAnimationFrame(rafId);
  stopSources();
  $('#playBtn').classList.remove('hidden');
  drawFrame(project.total);
  updateTimeLabel(project.total);
  if (recording) finishRecording(300);
}

$('#playBtn').addEventListener('click', () => {
  if (!project || !project.scenes.length) return;
  if (playing) pausePlayback();
  else if (pausedAt) { if (actx) actx.resume(); playFrom(pausedAt); }
  else playFrom(0);
});

/* ════════════════════════════════════════════════
   ЭКСПОРТ ВИДЕО (MediaRecorder)
   ════════════════════════════════════════════════ */

function pickMime() {
  const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of list) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

function exportVideo() {
  if (!project || recording) return;
  if (!window.MediaRecorder || !canvas.captureStream) {
    toast('Браузер не поддерживает запись видео. Скачай кадры и озвучку по отдельности.', 'err');
    return;
  }
  if (project.scenes.some(s => s.imgRemote)) {
    toast('Некоторые кадры пришли прямыми ссылками с чужого домена — браузер блокирует запись. Перегенерируй их кнопкой 🎨.', 'err', 6000);
    return;
  }
  const mime = pickMime();
  if (!mime) { toast('WebM-запись не поддерживается этим браузером.', 'err'); return; }

  ensureAudio();
  let stream;
  try {
    stream = canvas.captureStream(30);
  } catch (e) {
    toast('Запись заблокирована из-за внешних картинок в canvas.', 'err');
    return;
  }
  const dest = actx.createMediaStreamDestination();
  master.connect(dest);
  dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));

  recChunks = [];
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
  recorder.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    try { master.disconnect(dest); } catch (e) {}
    const blob = new Blob(recChunks, { type: mime });
    const url = URL.createObjectURL(blob);
    project.videoURL = url;
    download(url, slug(project.title) + '.webm');
    renderDownloads();
    toast('Видео записано: ' + (blob.size / 1048576).toFixed(1) + ' МБ. Если нужен MP4 — прогони файл через конвертер.', 'ok', 6000);
  };

  recording = true;
  $('#exportBtn').disabled = true;
  $('#exportBtn').textContent = '⏺ Идёт запись…';
  stopPlayback();
  recorder.start(250);
  playFrom(0);
}
function finishRecording(extraMs) {
  if (!recording || !recorder) return;
  setTimeout(() => {
    try { recorder.stop(); } catch (e) {}
    recording = false;
    $('#exportBtn').disabled = false;
    $('#exportBtn').textContent = '⬇ Записать видео (WebM)';
  }, extraMs || 0);
}
$('#exportBtn').addEventListener('click', exportVideo);

function slug(s) {
  return String(s || 'goldflow').toLowerCase().replace(/[^\wа-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'goldflow';
}

/* ════════════════════════════════════════════════
   ОБЛОЖКА + СКАЧИВАНИЕ МАТЕРИАЛОВ
   ════════════════════════════════════════════════ */

function downloadCover() {
  if (!project) return;
  const sc0 = project.scenes.find(s => s.imgEl) || project.scenes[0];
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1920;
  const cg = c.getContext('2d');
  cg.fillStyle = '#000'; cg.fillRect(0, 0, 1080, 1920);
  if (sc0 && sc0.imgEl) {
    const img = sc0.imgEl;
    const k = Math.max(1080 / img.width, 1920 / img.height);
    const w = img.width * k, h = img.height * k;
    cg.drawImage(img, (1080 - w) / 2, (1920 - h) / 2, w, h);
  } else {
    const grad = cg.createLinearGradient(0, 0, 1080, 1920);
    grad.addColorStop(0, '#2A2416'); grad.addColorStop(1, '#0A0908');
    cg.fillStyle = grad; cg.fillRect(0, 0, 1080, 1920);
  }
  const ov = cg.createLinearGradient(0, 700, 0, 1920);
  ov.addColorStop(0, 'rgba(0,0,0,0)'); ov.addColorStop(1, 'rgba(0,0,0,.82)');
  cg.fillStyle = ov; cg.fillRect(0, 700, 1080, 1220);

  /* кнопка play */
  cg.save();
  cg.beginPath(); cg.arc(540, 830, 110, 0, Math.PI * 2);
  cg.fillStyle = 'rgba(212,175,55,.95)'; cg.fill();
  cg.beginPath();
  cg.moveTo(510, 775); cg.lineTo(600, 830); cg.lineTo(510, 885); cg.closePath();
  cg.fillStyle = '#221803'; cg.fill();
  cg.restore();

  /* бейдж */
  const badge = 'SHORTS';
  cg.font = '700 34px "Geist Mono", monospace';
  const bw = cg.measureText(badge).width + 64;
  cg.fillStyle = '#D4AF37';
  cg.beginPath();
  if (cg.roundRect) cg.roundRect((1080 - bw) / 2, 1180, bw, 64, 32);
  else cg.rect((1080 - bw) / 2, 1180, bw, 64);
  cg.fill();
  cg.fillStyle = '#221803'; cg.textAlign = 'center'; cg.textBaseline = 'middle';
  cg.fillText(badge, 540, 1213);

  /* заголовок */
  cg.textAlign = 'center'; cg.textBaseline = 'middle';
  const words = String(project.title).toUpperCase().split(/\s+/);
  const lines = []; let cur = '';
  cg.font = '900 88px Onest, sans-serif';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (cg.measureText(test).width > 940 && cur) { lines.push(cur); cur = w; }
    else cur = test;
    if (lines.length === 3) break;
  }
  if (cur && lines.length < 4) lines.push(cur);
  let y = 1370 - (lines.length - 1) * 55;
  for (const ln of lines) {
    cg.lineWidth = 14; cg.strokeStyle = 'rgba(0,0,0,.7)'; cg.lineJoin = 'round';
    cg.strokeText(ln, 540, y);
    cg.fillStyle = '#F6E27A';
    cg.fillText(ln, 540, y);
    y += 110;
  }

  c.toBlob(b => {
    if (!b) return toast('Не удалось собрать обложку.', 'err');
    const url = URL.createObjectURL(b);
    download(url, slug(project.title) + '-cover.png');
    toast('Обложка 1080×1920 скачана.', 'ok');
  }, 'image/png');
}
$('#coverBtn').addEventListener('click', downloadCover);

function renderDownloads() {
  if (!project) return;
  const list = $('#downloads');
  list.innerHTML = '';

  const row = (label, btnText, fn, disabled) => {
    const d = document.createElement('div');
    d.className = 'dl-row';
    const s = document.createElement('span'); s.textContent = label;
    const b = document.createElement('button');
    b.className = 'btn btn-ghost btn-sm'; b.textContent = btnText;
    b.disabled = !!disabled;
    b.addEventListener('click', fn);
    d.append(s, b);
    list.appendChild(d);
  };

  row('📄 Сценарий + название + описание + теги', 'Скачать', () => {
    const txt =
      project.title + '\n\n' + project.description + '\n\nТЕГИ: ' + project.tags.join(', ') + '\n\n' +
      '─'.repeat(40) + '\n\n' +
      project.scenes.map((s, i) =>
        'СЦЕНА ' + (i + 1) + ' [' + s.duration.toFixed(1) + ' c]\n' +
        'Диктор: ' + s.narration + '\n' +
        'На экране: ' + s.onScreen + '\n' +
        'Промпт кадра: ' + s.imagePrompt + '\n'
      ).join('\n');
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    download(url, slug(project.title) + '-script.txt');
  });

  row('🖼 Обложка 1080×1920 с заголовком', 'Скачать', downloadCover);

  project.scenes.forEach((s, i) => {
    if (s.imgSrc) row('🎨 Кадр ' + (i + 1) + ' — вертикальная картинка', 'Скачать', () => {
      fetch(s.imgSrc)
        .then(r => r.blob())
        .then(b => download(URL.createObjectURL(b), slug(project.title) + '-frame-' + (i + 1) + '.png'))
        .catch(() => window.open(s.imgSrc, '_blank'));
    });
  });
  project.scenes.forEach((s, i) => {
    if (s.audioBlob) row('🔊 Озвучка сцены ' + (i + 1) + ' (mp3)', 'Скачать', () => {
      download(URL.createObjectURL(s.audioBlob), slug(project.title) + '-voice-' + (i + 1) + '.mp3');
    });
  });

  if (project.videoURL) row('🎬 Готовое видео (webm, со звуком)', 'Скачать', () => download(project.videoURL, slug(project.title) + '.webm'));
  else {
    const d = document.createElement('div');
    d.className = 'dl-row';
    const s = document.createElement('span'); s.textContent = '🎬 Готовое видео (webm, со звуком)';
    const b = document.createElement('span'); b.className = 'hint'; b.textContent = 'нажми «Записать видео» выше';
    d.append(s, b); list.appendChild(d);
  }
}

function showResult() {
  $('#emptyState').style.display = 'none';
  $('#result').hidden = false;
  const seo = $('#seoBlock');
  seo.innerHTML =
    '<div class="seo-title"></div>' +
    '<div class="seo-desc"></div>' +
    '<div class="seo-tags">' + project.tags.map(() => '<span></span>').join('') + '</div>';
  seo.querySelector('.seo-title').textContent = project.title;
  seo.querySelector('.seo-desc').textContent = project.description;
  seo.querySelectorAll('.seo-tags span').forEach((el, i) => el.textContent = project.tags[i]);
  drawFrame(0);
  renderDownloads();
}

/* ════════════════════════════════════════════════
   НАСТРОЙКИ: один URL + один токен
   ════════════════════════════════════════════════ */

function openSettings() {
  fillSettingsForm();
  $('#settingsModal').hidden = false;
  setTimeout(() => $('#apiKey').focus(), 60);
}
function closeSettings() { $('#settingsModal').hidden = true; }

function fillSettingsForm() {
  $('#apiBase').value = settings.base;
  $('#apiKey').value = settings.key;
  $('#textModel').value = settings.textModel;
  $('#imgModel').value = settings.imgModel;
  $('#voiceModel').value = settings.voiceModel;
  syncBaseChips();
}

function updateApiStatus() {
  const pill = $('#apiStatus');
  pill.classList.remove('ok', 'warn');
  if (settings.key && base()) {
    pill.classList.add('ok');
    pill.querySelector('.api-pill-text').textContent = 'API подключён — можно генерировать';
  } else {
    pill.classList.add('warn');
    pill.querySelector('.api-pill-text').textContent = 'Вставь URL и токен API в настройках';
  }
}

function populateVoiceSelect() {
  const sel = $('#voiceName');
  sel.innerHTML = '';
  OPENAI_VOICES.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
  sel.value = OPENAI_VOICES.includes(settings.voice) ? settings.voice : OPENAI_VOICES[0];
  settings.voice = sel.value;
}

async function testKey() {
  const out = $('#keyTest');
  out.className = 'test-result'; out.textContent = 'проверяю…';
  const url = $('#apiBase').value.trim();
  const key = $('#apiKey').value.trim();
  if (!url || !key) { out.className = 'test-result err'; out.textContent = 'заполни оба поля'; return; }
  try {
    /* проверяем коротким запросом к текстовой модели — это работает у всех провайдеров */
    const res = await smartFetch('/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: $('#textModel').value.trim() || DEFAULTS.textModel,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }]
      })
    }, url);
    await res.json();
    out.className = 'test-result ok';
    out.textContent = '✓ Подключение работает — модель отвечает';
  } catch (e) {
    out.className = 'test-result err';
    out.textContent = '✗ ' + e.message.slice(0, 160);
  }
}

/* быстрые кнопки популярных провайдеров + подсказка моделей под каждого */
const PRESET_MODELS = {
  'https://api.openai.com/v1': ['gpt-4o-mini', 'gpt-image-1', 'gpt-4o-mini-tts'],
  'https://api.z.ai/api/paas/v4': ['glm-5.3', 'cogview-4', 'cogtts'],
  'https://open.bigmodel.cn/api/paas/v4': ['glm-5.3', 'cogview-4', 'cogtts'],
  'https://openrouter.ai/api/v1': ['openai/gpt-4o-mini', 'google/gemini-2.5-flash-image', 'openai/gpt-4o-mini-tts'],
  'https://api.proxyapi.ru/v1': ['gpt-4o-mini', 'dall-e-3', 'tts-1']
};
function syncBaseChips() {
  const cur = ($('#apiBase').value || '').trim().replace(/\/+$/, '');
  $$('#baseChips [data-base]').forEach(c => c.classList.toggle('active', c.dataset.base === cur));
}
$$('#baseChips [data-base]').forEach(ch => ch.addEventListener('click', () => {
  $('#apiBase').value = ch.dataset.base;
  const m = PRESET_MODELS[ch.dataset.base];
  if (m) {
    $('#textModel').value = m[0];
    $('#imgModel').value = m[1];
    $('#voiceModel').value = m[2];
  }
  syncBaseChips();
}));
$('#apiBase').addEventListener('input', syncBaseChips);

$('#openSettings').addEventListener('click', openSettings);
$('#apiStatus').addEventListener('click', openSettings);
$('#closeSettings').addEventListener('click', closeSettings);
$('#settingsModal').addEventListener('click', e => { if (e.target === $('#settingsModal')) closeSettings(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#settingsModal').hidden) closeSettings(); });

$('#testKeyBtn').addEventListener('click', testKey);

$$('.eye').forEach(b => b.addEventListener('click', () => {
  const inp = $('#' + b.dataset.eye);
  inp.type = inp.type === 'password' ? 'text' : 'password';
}));

$('#saveSettings').addEventListener('click', () => {
  settings.base = $('#apiBase').value.trim() || DEFAULTS.base;
  settings.key = $('#apiKey').value.trim();
  settings.textModel = $('#textModel').value.trim() || DEFAULTS.textModel;
  settings.imgModel = $('#imgModel').value.trim() || DEFAULTS.imgModel;
  settings.voiceModel = $('#voiceModel').value.trim() || DEFAULTS.voiceModel;
  settings.voice = $('#voiceName').value || settings.voice;
  saveJSON(LS_KEY, settings);
  updateApiStatus();
  closeSettings();
  toast('Сохранено. Токен лежит только в этом браузере.', 'ok');
});
$('#clearSettings').addEventListener('click', () => {
  settings = Object.assign({}, DEFAULTS);
  localStorage.removeItem(LS_KEY);
  fillSettingsForm();
  updateApiStatus();
  toast('Токен удалён из браузера.', 'ok');
});

/* ════════════════════════════════════════════════
   ЛЕНДИНГ
   ════════════════════════════════════════════════ */

$('#brief').addEventListener('submit', onGenerate);

$$('#voiceName').forEach(() => {});
$('#voiceName').addEventListener('change', () => { settings.voice = $('#voiceName').value; saveJSON(LS_KEY, settings); });

$$('.tile').forEach(t => t.addEventListener('click', () => {
  const v = t.dataset.style;
  const sel = $('#style');
  if ([...sel.options].some(o => o.value === v)) sel.value = v;
  $('#studio').scrollIntoView({ behavior: 'smooth' });
  toast('Стиль «' + v + '» подставлен в бриф.', 'ok', 2600);
}));

$$('.price-btn').forEach(b => b.addEventListener('click', e => {
  e.preventDefault();
  toast('Здесь подставь ссылку на твоего Telegram-бота (атрибут href в index.html).', 'ok', 5000);
}));

$('#year').textContent = new Date().getFullYear();

/* первый запуск */
populateVoiceSelect();
updateApiStatus();
resetSteps();
if (!settings.key) {
  setTimeout(() => {
    openSettings();
    toast('Вставь Base URL и токен своего API — и можно генерировать.', 'ok', 6000);
  }, 900);
}
