/* ============================================================
   VocabFlow · 生词本
   纯前端 · localStorage 持久化 · SM-2 间隔重复
   ============================================================ */
(function () {
  "use strict";

  /* ==========================================================
     1. 常量 / 存储
     ========================================================== */
  const STORE_KEY = "vocabflow.v1";
  const THEME_KEY = "vocabflow.theme";
  const DAY = 86400000;
  const POS_LIST = ["n.", "v.", "adj.", "adv.", "prep.", "conj.", "phr.", "其他"];
  const SAMPLE_TAG = "示例词书";

  const DEFAULT_STATE = {
    version: 1,
    words: [],
    history: [],          // [{ id, term, grade, at, type }]
    sessions: [],         // [{ at, kind: 'review'|'quiz', total, correct }]
    settings: { newLimit: 12, reviewLimit: 80, voice: "", quizSize: 10, seeded: false, scope: "全部" },
    lastTab: "home",
    // 学习模块：与生词本 / 复习进度相互独立
    learn: { book: "CET-4", from: "A", to: "Z", size: 20, order: "seq", seen: {} },
    // 例句翻译缓存：{ [英文例句文本]: 中文翻译 }
    translationCache: {},
  };

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return clone(DEFAULT_STATE);
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      console.warn("读取本地数据失败，使用空词库", e);
      return clone(DEFAULT_STATE);
    }
  }

  function normalizeState(obj) {
    const s = clone(DEFAULT_STATE);
    if (!obj || typeof obj !== "object") return s;
    if (Array.isArray(obj.words)) s.words = obj.words.map(sanitizeWord).filter(Boolean);
    if (Array.isArray(obj.history)) s.history = obj.history.filter((h) => h && h.at);
    if (Array.isArray(obj.sessions)) s.sessions = obj.sessions.filter((x) => x && x.at);
    if (obj.settings && typeof obj.settings === "object") {
      s.settings = Object.assign(s.settings, {
        newLimit: clampInt(obj.settings.newLimit, 0, 100, 12),
        reviewLimit: clampInt(obj.settings.reviewLimit, 1, 200, 80),
        quizSize: clampInt(obj.settings.quizSize, 4, 50, 10),
        voice: typeof obj.settings.voice === "string" ? obj.settings.voice : "",
        seeded: !!obj.settings.seeded,
        scope: typeof obj.settings.scope === "string" && obj.settings.scope ? obj.settings.scope : "全部",
      });
    }
    if (obj.learn && typeof obj.learn === "object") {
      const L = obj.learn;
      s.learn = {
        book: ["CET-4", "CET-6", "考研核心", "面试口语", "生词本"].includes(L.book) ? L.book : "CET-4",
        from: /^[A-Z]$/.test(L.from) ? L.from : "A",
        to: /^[A-Z]$/.test(L.to) ? L.to : "Z",
        size: clampInt(L.size, 5, 100, 20),
        order: ["seq", "freq", "random"].includes(L.order) ? L.order : "seq",
        seen: L.seen && typeof L.seen === "object" ? L.seen : {},
      };
    }
    if (typeof obj.lastTab === "string") s.lastTab = obj.lastTab;
    if (obj.translationCache && typeof obj.translationCache === "object") s.translationCache = obj.translationCache;
    return s;
  }

  function sanitizeWord(w) {
    if (!w || typeof w !== "object") return null;
    const term = cleanStr(w.term, 80);
    const meaning = cleanStr(w.meaning, 400);
    if (!term || !meaning) return null;
    return {
      id: cleanStr(w.id, 40) || uid(),
      term,
      phonetic: cleanStr(w.phonetic, 80),
      pos: cleanStr(w.pos, 12),
      meaning,
      example: cleanStr(exOf(w), 600),
      exampleZh: cleanStr(w.exampleZh, 400),
      level: cleanStr(w.level, 24),
      tags: normalizeTags(w.tags),
      createdAt: numOr(w.createdAt, Date.now()),
      reps: Math.max(0, numOr(w.reps, 0)),
      interval: Math.max(0, numOr(w.interval, 0)),
      ease: clampNum(numOr(w.ease, 2.5), 1.3, 3.2),
      nextReview: numOr(w.nextReview, Date.now()),
      lastReview: numOr(w.lastReview, 0),
      totalReviews: Math.max(0, numOr(w.totalReviews, 0)),
      correct: Math.max(0, numOr(w.correct, 0)),
      lapses: Math.max(0, numOr(w.lapses, 0)),
    };
  }

  function cleanStr(v, max) {
    if (v === null || v === undefined) return "";
    let s = String(v).replace(/\s+/g, " ").trim();
    if (max && s.length > max) s = s.slice(0, max);
    return s;
  }
  function numOr(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function clampNum(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function clampInt(v, lo, hi, d) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return d;
    return Math.min(hi, Math.max(lo, n));
  }
  function normalizeTags(tags) {
    let list = [];
    if (Array.isArray(tags)) list = tags;
    else if (typeof tags === "string") list = tags.split(/[,，;；\s/]+/);
    const out = [];
    list.forEach((t) => {
      const s = cleanStr(t, 24).replace(/^#/, "");
      if (s && !out.includes(s)) out.push(s);
    });
    return out.slice(0, 10);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  let state = load();

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
      catch (e) { console.error(e); toast("保存失败：浏览器存储空间不足或被禁用", "err"); }
    }, 60);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { console.error(e); }
  }

  /* ==========================================================
     2. 日期 / 统计工具
     ========================================================== */
  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function today0() { return startOfDay(Date.now()); }
  function dayKey(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }
  function fmtShort(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  function relativeDay(ts) {
    if (!ts) return "—";
    const diff = startOfDay(ts) - today0();
    if (diff <= 0) return "今天";
    const days = Math.round(diff / DAY);
    if (days === 1) return "明天";
    if (days === 2) return "后天";
    if (days < 30) return `${days} 天后`;
    return fmtDate(ts);
  }
  function isDue(w) { return w.nextReview <= Date.now(); }

  function wordStatus(w) {
    if (!w.totalReviews) return "new";
    if (w.interval >= 21) return "mastered";
    if (isDue(w)) return "due";
    return "learning";
  }
  function statusLabel(s) {
    return { new: "新词", due: "待复习", learning: "学习中", mastered: "已掌握", scheduled: "已安排" }[s] || s;
  }

  function collectTags() {
    const map = new Map();
    state.words.forEach((w) => w.tags.forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
  }

  function dueWords() {
    return scopedWords()
      .filter((w) => w.totalReviews > 0 && isDue(w))
      .sort((a, b) => a.nextReview - b.nextReview);
  }
  function newWords() {
    return scopedWords()
      .filter((w) => w.totalReviews === 0)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  function computeStats() {
    const today = today0();
    const todays = state.history.filter((h) => h.at >= today);
    const reviewedIds = new Set(todays.map((h) => h.id));
    const inScope = scopedWords();
    const mastered = inScope.filter((w) => w.interval >= 21).length;
    const learning = inScope.filter((w) => w.totalReviews > 0 && w.interval < 21).length;
    return {
      total: state.words.length,
      scoped: inScope.length,
      scope: currentScope(),
      due: dueWords().length,
      newCount: newWords().length,
      mastered,
      learning,
      todayReviews: todays.length,
      todayWords: reviewedIds.size,
      streak: computeStreak(),
      accuracy: (() => {
        const voted = state.history.filter((h) => h.grade >= 3).length;
        return state.history.length ? Math.round((voted / state.history.length) * 100) : 0;
      })(),
    };
  }

  function computeStreak() {
    const keys = new Set(state.history.map((h) => dayKey(h.at)));
    if (!keys.size) return 0;
    let streak = 0;
    let cursor = today0();
    // 今天还没学但昨天学了，从昨天开始算
    if (!keys.has(dayKey(cursor))) cursor -= DAY;
    while (keys.has(dayKey(cursor))) {
      streak += 1;
      cursor -= DAY;
    }
    return streak;
  }

  function activitySeries(days) {
    const out = [];
    const today = today0();
    for (let i = days - 1; i >= 0; i--) {
      const day = today - i * DAY;
      const next = day + DAY;
      const reviews = state.history.filter((h) => h.at >= day && h.at < next).length;
      out.push({ ts: day, reviews });
    }
    return out;
  }

  /* ---------- 学习范围（级别 / 词书） ---------- */
  const LEVELS = ["CET-4", "CET-6", "考研", "商务", "雅思", "托福", "GRE"];

  function inferLevelFromTags(tags) {
    const hit = (tags || []).find((t) => LEVELS.includes(t));
    return hit || "";
  }

  function currentScope() {
    return state.settings.scope || "全部";
  }

  function wordInScope(w, scope) {
    const sc = scope || currentScope();
    if (sc === "全部") return true;
    if ((w.level || "") === sc) return true;
    return (w.tags || []).includes(sc);
  }

  function scopedWords() {
    return state.words.filter((w) => wordInScope(w));
  }

  function scopeCount(scope) {
    return state.words.filter((w) => wordInScope(w, scope)).length;
  }

  function allLevels() {
    const set = new Set(LEVELS);
    state.words.forEach((w) => {
      if (w.level) set.add(w.level);
      w.tags.forEach((t) => { if (LEVELS.includes(t)) set.add(t); });
    });
    return [...set];
  }

  function applyScope(scope) {
    const next = scope || "全部";
    const r = ui.review;
    // 只在「复习进行中」才需要确认，欢迎页/结果页直接切换
    if (r && r.started && !r.done) {
      if (!window.confirm("切换学习范围会结束当前这一轮复习，继续吗？")) {
        render();
        return;
      }
    }
    state.settings.scope = next;
    saveNow();
    ui.review = null;
    // 切换范围后回到首页，立刻看到这个范围的任务量
    ui.tab = "home";
    location.hash = "";
    render();
    toast(next === "全部" ? "学习范围：全部词库" : `学习范围已限定为 ${next}（${scopeCount(next)} 个词）`);
  }

  function wireScopeSelects() {
    $$("select[data-scope]").forEach((sel) => {
      sel.addEventListener("change", () => applyScope(sel.value));
    });
  }

  function scopeSelectHtml(id) {
    const cur = currentScope();
    const levels = allLevels();
    return `<span class="select-wrap scope-select">
      <select id="${id}" data-scope="1" aria-label="学习范围">${["全部", ...levels].map((l) =>
        `<option value="${escAttr(l)}" ${cur === l ? "selected" : ""}>${l === "全部" ? "全部词库" : esc(l)}（${scopeCount(l)}）</option>`
      ).join("")}</select>
    </span>`;
  }

  /* ==========================================================
     3. SM-2 间隔重复
     ========================================================== */
  const GRADE_LABEL = {
    1: { name: "忘记了", hint: "< 1 天" },
    2: { name: "有点难", hint: "稍后" },
    3: { name: "记得", hint: "按计划" },
    4: { name: "很简单", hint: "拉长" },
  };

  function previewInterval(w, grade) {
    const p = schedule(w, grade, true);
    if (grade === 1) return "10 分钟后";
    const days = p.interval;
    if (days < 1) return "当天";
    if (days < 1.5) return "明天";
    return `${Math.round(days)} 天后`;
  }

  function schedule(w, grade, dryRun) {
    let ease = w.ease || 2.5;
    let reps = w.reps || 0;
    let interval = w.interval || 0;
    let next;

    if (grade === 1) {
      // 忘记：重置学习进度，10 分钟后再见
      ease = Math.max(1.3, ease - 0.2);
      reps = 0;
      interval = 0.007;
      next = Date.now() + 10 * 60 * 1000;
    } else if (grade === 2) {
      ease = Math.max(1.3, ease - 0.15);
      reps = Math.max(1, reps);
      interval = interval > 0 ? Math.max(1, interval * 1.2) : 1;
      next = Date.now() + interval * DAY;
    } else if (grade === 3) {
      ease = clampNum(ease + 0.02, 1.3, 3.2);
      const n = reps;
      reps = n + 1;
      if (n === 0) interval = 1;
      else if (n === 1) interval = 3;
      else interval = Math.max(1, interval * ease);
      next = Date.now() + interval * DAY;
    } else {
      ease = clampNum(ease + 0.12, 1.3, 3.2);
      const n = reps;
      reps = n + 1;
      if (n === 0) interval = 2;
      else if (n === 1) interval = 5;
      else interval = Math.max(interval + 1, interval * ease * 1.25);
      next = Date.now() + interval * DAY;
    }

    // 1 天以上的复习统一落在当天早上 8 点，体验更自然
    if (interval >= 1) {
      const d = new Date(Date.now() + interval * DAY);
      d.setHours(8, 0, 0, 0);
      next = d.getTime();
    }

    interval = Math.round(interval * 100) / 100;
    if (dryRun) return { ease, reps, interval, nextReview: next };

    w.ease = ease;
    w.reps = reps;
    w.interval = interval;
    w.nextReview = next;
    w.lastReview = Date.now();
    w.totalReviews = (w.totalReviews || 0) + 1;
    if (grade >= 3) w.correct = (w.correct || 0) + 1;
    if (grade === 1) w.lapses = (w.lapses || 0) + 1;
    return w;
  }

  /* ==========================================================
     4. 通用 UI 工具
     ========================================================== */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escAttr(s) { return esc(s).replace(/`/g, "&#96;"); }

  /* 例句容错：undefined / null / 空白 / 字符串 "undefined" 一律当作没有例句 */
  function exOf(w) {
    const v = w && w.example;
    if (typeof v !== "string") return "";
    const t = v.trim();
    if (!t || t === "undefined" || t === "null" || t === "NaN") return "";
    return t;
  }

  /* 取例句中文翻译：优先 word.exampleZh，其次缓存，再次学习/复习临时 map */
  function exZhOf(w) {
    if (!w) return "";
    if (w.exampleZh && w.exampleZh.trim()) return w.exampleZh.trim();
    const en = exOf(w);
    if (!en) return "";
    if (state.translationCache && state.translationCache[en]) return state.translationCache[en];
    if (ui.learn && ui.learn.exZhMap && ui.learn.exZhMap[en]) return ui.learn.exZhMap[en];
    if (ui.review && ui.review.exZhMap && ui.review.exZhMap[en]) return ui.review.exZhMap[en];
    return "";
  }

  function toast(msg, kind) {
    const wrap = $("#toastWrap");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast " + (kind === "err" ? "err" : "ok");
    el.innerHTML = `<span class="t-ico">${kind === "err" ? "!" : "✓"}</span><span>${esc(msg)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 220);
    }, 2400);
  }

  function openDialog(dlg) {
    if (typeof dlg.showModal === "function") {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
  }
  function closeDialog(dlg) {
    if (typeof dlg.close === "function" && dlg.open) dlg.close();
    else dlg.removeAttribute("open");
  }

  /* ---------- 语音朗读：Audio(有道 TTS) 优先，speechSynthesis 兜底 ----------
     手机浏览器（尤其 iOS Safari / 微信内置浏览器）对 speechSynthesis 支持差，
     改成 Audio 元素直接播放在线发音，兼容性最好；离线或失败时再退回系统语音。 */
  let _audio = null;
  let _audioFallbackTimer = null;
  let _audioReady = false;

  /* 首次用户触摸时解锁 iOS Safari 的 Audio 播放策略 */
  function unlockAudioOnce() {
    if (_audioReady) return;
    try {
      const a = new Audio();
      a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
      a.play().then(() => { _audioReady = true; try { a.pause(); } catch (_) {} }).catch(() => {});
    } catch (_) {}
    _audioReady = true;
  }
  document.addEventListener("touchstart", unlockAudioOnce, { once: true, passive: true });
  document.addEventListener("click", unlockAudioOnce, { once: true, passive: true });

  /* 用系统语音兜底（桌面端或离线时） */
  function speakWithSynthesis(text) {
    if (!("speechSynthesis" in window)) { toast("当前浏览器不支持语音朗读", "err"); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const want = state.settings.voice;
      let v = want ? voices.find((x) => x.name === want || x.voiceURI === want) : null;
      if (!v) v = voices.find((x) => /en-US/i.test(x.lang)) || voices.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.lang = (v && v.lang) || "en-US";
      u.rate = 0.92;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch (e) { console.warn(e); }
  }

  /* 主入口：优先 Audio 播放有道 TTS，失败/超时回退 speechSynthesis */
  function speak(text) {
    if (!text || !String(text).trim()) return;
    text = String(text).trim();

    /* 停掉上一次 */
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
    if (_audio) { try { _audio.pause(); } catch (_) {} _audio = null; }
    if (_audioFallbackTimer) { clearTimeout(_audioFallbackTimer); _audioFallbackTimer = null; }

    /* 单词 / 短词用美音 (type=1)；长句用 type=1 也是自然美音 */
    const url = "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(text) + "&type=1";
    try {
      const a = new Audio();
      _audio = a;
      a.src = url;
      a.preload = "auto";
      const fallback = () => {
        if (_audioFallbackTimer) { clearTimeout(_audioFallbackTimer); _audioFallbackTimer = null; }
        speakWithSynthesis(text);
      };
      /* 4 秒还没开始播放（离线 / 网络差 / 被 CORS 拦），就回退系统语音 */
      _audioFallbackTimer = setTimeout(fallback, 4000);
      a.addEventListener("playing", () => {
        if (_audioFallbackTimer) { clearTimeout(_audioFallbackTimer); _audioFallbackTimer = null; }
      }, { once: true });
      a.addEventListener("error", fallback, { once: true });
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(fallback);
    } catch (e) {
      speakWithSynthesis(text);
    }
  }

  /* 统一渲染例句块：英文例句 + 中文翻译（或翻译按钮）+ 朗读按钮；无例句时提供"补例句" */
  function exBlock(w) {
    const en = exOf(w);
    const zh = exZhOf(w);
    const id = w.id || "";
    /* 没例句：只对词库里的词显示"补例句"按钮 */
    if (!en) {
      if (!id) return "";
      return `<div class="ex-block">
        <button class="ex-translate-btn" data-action="fetch-example" data-id="${escAttr(id)}" style="margin-top:0">📖 在线补例句</button>
      </div>`;
    }
    return `
      <div class="ex-block">
        <p class="ex-en">“${esc(en)}”</p>
        ${zh
          ? `<p class="ex-zh">${esc(zh)}</p>`
          : `<button class="ex-translate-btn" data-action="translate-example-text" data-en="${escAttr(en)}" ${id ? `data-id="${escAttr(id)}"` : ""}>🌐 翻译例句</button>`}
        <button class="ex-speak-btn" data-action="speak-example-text" data-en="${escAttr(en)}" title="朗读例句" aria-label="朗读例句">🔊</button>
      </div>`;
  }

  /* 调 dictionaryapi.dev 给单词补一个例句，并自动翻译 */
  async function fetchExample(wordId) {
    const w = state.words.find((x) => x.id === wordId);
    if (!w) return;
    if (exOf(w)) { toast("这个词已经有例句了"); return; }
    const key = "f:" + w.term;
    if (_translating.has(key)) return;
    _translating.add(key);
    toast("正在获取「" + w.term + "」的例句…");
    try {
      const resp = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(w.term));
      if (!resp.ok) throw new Error("词典里没有这个词");
      const data = await resp.json();
      let example = "";
      for (const entry of (data || [])) {
        for (const m of (entry.meanings || [])) {
          for (const d of (m.definitions || [])) {
            if (d.example && String(d.example).trim()) { example = String(d.example).trim(); break; }
          }
          if (example) break;
        }
        if (example) break;
      }
      if (!example) throw new Error("词典里没有这个词的例句");
      w.example = example.slice(0, 600);
      saveNow();
      render();
      toast("已补例句，自动翻译中…");
      /* 自动翻译 */
      try {
        const tUrl = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(example) + "&langpair=en|zh-CN";
        const tResp = await fetch(tUrl);
        const tData = await tResp.json();
        if (tData && tData.responseData && tData.responseData.translatedText) {
          w.exampleZh = String(tData.responseData.translatedText).replace(/\s+/g, " ").trim().slice(0, 400);
          if (!state.translationCache) state.translationCache = {};
          state.translationCache[example] = w.exampleZh;
          saveNow(); render();
        }
      } catch (e2) { console.warn("自动翻译失败", e2); }
    } catch (e) {
      console.warn("补例句失败", e);
      toast("补例句失败：" + (e && e.message ? e.message : "网络错误"), "err");
    } finally {
      _translating.delete(key);
    }
  }

  /* 翻译任意例句文本（不依赖 wordId），结果写入缓存 + 学习/复习临时 map */
  async function translateExampleText(en, wordId) {
    en = String(en || "").trim();
    if (!en) return;
    if (state.translationCache && state.translationCache[en]) {
      render(); return;
    }
    const key = "t:" + en;
    if (_translating.has(key)) return;
    _translating.add(key);
    toast("正在翻译例句…");
    try {
      const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(en) + "&langpair=en|zh-CN";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const data = await resp.json();
      const zh = data && data.responseData && data.responseData.translatedText;
      if (!zh) throw new Error((data && data.responseDetails) || "翻译服务返回异常");
      const clean = String(zh).replace(/\s+/g, " ").trim();
      if (!clean) throw new Error("翻译结果为空");
      if (!state.translationCache) state.translationCache = {};
      state.translationCache[en] = clean;
      /* 如果是词库里的词，写回 word.exampleZh */
      if (wordId) {
        const w = state.words.find((x) => x.id === wordId);
        if (w) w.exampleZh = clean;
      }
      saveNow();
      render();
    } catch (e) {
      console.warn("翻译失败", e);
      toast("翻译失败：" + (e && e.message ? e.message : "网络错误"), "err");
    } finally {
      _translating.delete(key);
    }
  }

  /* ---------- 在线翻译例句（MyMemory 免费 API，CORS 开放） ----------
     结果写入 state.translationCache，并回写到对应 word.exampleZh，下次直接显示。 */
  const _translating = new Set();
  async function translateExample(wordId) {
    const w = state.words.find((x) => x.id === wordId);
    if (!w) return;
    const en = exOf(w);
    if (!en) { toast("这个词没有例句", "err"); return; }
    if (w.exampleZh && w.exampleZh.trim()) { toast("已有翻译：" + w.exampleZh); return; }
    if (_translating.has(wordId)) return;

    /* 缓存命中 */
    const cached = state.translationCache && state.translationCache[en];
    if (cached) {
      w.exampleZh = cached;
      saveNow(); render();
      toast("已从缓存载入翻译");
      return;
    }

    _translating.add(wordId);
    toast("正在翻译例句…");
    try {
      const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(en) + "&langpair=en|zh-CN";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const data = await resp.json();
      const zh = data && data.responseData && data.responseData.translatedText;
      const status = data && data.responseStatus;
      if (!zh || (status && Number(status) !== 200 && status !== "200")) {
        throw new Error((data && data.responseDetails) || "翻译服务返回异常");
      }
      const clean = String(zh).replace(/\s+/g, " ").trim();
      if (!clean || /^(INVALID|QUERY|LENGTH)/i.test(clean)) throw new Error("翻译结果为空");
      w.exampleZh = clean;
      if (!state.translationCache) state.translationCache = {};
      state.translationCache[en] = clean;
      saveNow();
      render();
      toast("例句翻译完成");
    } catch (e) {
      console.warn("翻译失败", e);
      toast("翻译失败：" + (e && e.message ? e.message : "网络错误") + "，可手动在编辑里填写", "err");
    } finally {
      _translating.delete(wordId);
    }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sample(arr, n) { return shuffle(arr).slice(0, n); }

  /* 每日一句（按日期轮换） */
  const DAILY_QUOTES = [
    { en: "The limits of my language mean the limits of my world.", zh: "语言的边界，即世界的边界。", by: "Wittgenstein" },
    { en: "Learning a new language is like getting a new soul.", zh: "学会一门新语言，就像获得一个新的灵魂。", by: "Carolingian proverb" },
    { en: "You live a new life for every new language you speak.", zh: "每会一门新语言，你就多活一遍人生。", by: "Czech proverb" },
    { en: "Practice makes perfect.", zh: "熟能生巧。", by: "俗语" },
    { en: "A little of every day goes a long way.", zh: "每天一点点，长久成巨变。", by: "俗语" },
    { en: "The best time to plant a tree was 20 years ago. The second best time is now.", zh: "种树最好的时间是二十年前，其次是现在。", by: "谚语" },
    { en: "Small daily improvements are the key to staggering long-term results.", zh: "每天微小的进步，是长期惊人结果的关键。", by: "Robin Sharma" },
    { en: "Language is the road map of a culture.", zh: "语言是文化的路线图。", by: "Rita Mae Brown" },
    { en: "To have another language is to possess a second soul.", zh: "掌握另一门语言，等于拥有第二个灵魂。", by: "Charlemagne" },
    { en: "One language sets you in a corridor for life. Two languages open every door along the way.", zh: "一门语言让你走上人生走廊，两门语言让沿途的每扇门都敞开。", by: "Frank Smith" },
    { en: "Never give up on a dream just because of the time it will take to accomplish it. The time will pass anyway.", zh: "别因为要花很久就放弃梦想，时间反正都会过去。", by: "Earl Nightingale" },
    { en: "It does not matter how slowly you go as long as you do not stop.", zh: "走得慢没关系，只要别停下来。", by: "Confucius" },
  ];
  function dailyQuote() {
    const day = Math.floor(Date.now() / 86400000);
    return DAILY_QUOTES[day % DAILY_QUOTES.length];
  }

  /* ==========================================================
     5. 示例词书
     ========================================================== */
  const SAMPLE_WORDS = [
    ["resilient", "/rɪˈzɪliənt/", "adj.", "有韧性的；能迅速恢复的", "Children are often more resilient than we expect.", ["CET-6"]],
    ["meticulous", "/məˈtɪkjələs/", "adj.", "一丝不苟的；极仔细的", "She kept meticulous notes of every experiment.", ["CET-6"]],
    ["pragmatic", "/præɡˈmætɪk/", "adj.", "务实的；实用主义的", "We need a pragmatic approach to the problem.", ["考研"]],
    ["ambiguous", "/æmˈbɪɡjuəs/", "adj.", "模棱两可的；含糊不清的", "The instructions were deliberately ambiguous.", ["CET-4"]],
    ["deteriorate", "/dɪˈtɪəriəreɪt/", "v.", "恶化；变坏", "Her health began to deteriorate last winter.", ["CET-6"]],
    ["substantial", "/səbˈstænʃl/", "adj.", "大量的；实质性的", "The project requires a substantial investment.", ["CET-4"]],
    ["intricate", "/ˈɪntrɪkət/", "adj.", "错综复杂的；精巧的", "The watch has an intricate mechanism.", ["考研"]],
    ["compelling", "/kəmˈpelɪŋ/", "adj.", "令人信服的；引人入胜的", "She made a compelling case for the change.", ["CET-6"]],
    ["mitigate", "/ˈmɪtɪɡeɪt/", "v.", "减轻；缓和", "Planting trees can mitigate the effects of flooding.", ["考研"]],
    ["perceive", "/pəˈsiːv/", "v.", "察觉；将…视为", "Many people perceive him as a leader.", ["CET-4"]],
    ["scrutinize", "/ˈskruːtənaɪz/", "v.", "仔细检查；细看", "The committee scrutinized every line of the budget.", ["考研"]],
    ["inevitable", "/ɪnˈevɪtəbl/", "adj.", "不可避免的；必然的", "Change is inevitable in any organization.", ["CET-4"]],
    ["outcome", "/ˈaʊtkʌm/", "n.", "结果；成果", "Nobody could predict the outcome of the trial.", ["CET-4"]],
    ["negotiate", "/nɪˈɡəʊʃieɪt/", "v.", "谈判；洽谈；越过", "We negotiated a better price with the supplier.", ["商务"]],
    ["revenue", "/ˈrevənjuː/", "n.", "收入；营业额；税收", "Annual revenue grew by twelve percent.", ["商务"]],
    ["stakeholder", "/ˈsteɪkhəʊldə/", "n.", "利益相关者", "All stakeholders were invited to the review meeting.", ["商务"]],
    ["leverage", "/ˈlevərɪdʒ/", "v.", "利用（资源）；借助", "We can leverage social media to reach new customers.", ["商务"]],
    ["allocate", "/ˈæləkeɪt/", "v.", "分配；拨给", "The manager allocated half the budget to research.", ["商务"]],
  ];

  function seedSample() {
    if (state.words.length || state.settings.seeded) return;
    const base = Date.now() - 6 * DAY;
    SAMPLE_WORDS.forEach(([term, phonetic, pos, meaning, example, tags], i) => {
      if (state.words.some((w) => w.term.toLowerCase() === term.toLowerCase())) return;
      state.words.push(sanitizeWord({
        id: uid(), term, phonetic, pos, meaning, example,
        level: inferLevelFromTags(tags),
        tags: tags.concat(SAMPLE_TAG),
        createdAt: base + i * 60000,
        nextReview: Date.now(),
      }));
    });
    state.settings.seeded = true;
    saveNow();
  }

  /* ==========================================================
     5b. 内置词书（CET-4 / CET-6 精选）
     ========================================================== */
  const BANK_CET4 = [
    ["abandon", "/əˈbændən/", "v.", "放弃；抛弃", "They had to abandon the plan because of the weather."],
    ["ability", "/əˈbɪləti/", "n.", "能力；才能", "She has the ability to learn languages quickly."],
    ["absorb", "/əbˈzɔːb/", "v.", "吸收；使全神贯注", "Plants absorb carbon dioxide from the air."],
    ["abstract", "/ˈæbstrækt/", "adj.", "抽象的；n. 摘要", "Abstract ideas are hard to explain to children."],
    ["accompany", "/əˈkʌmpəni/", "v.", "陪伴；伴随", "He was accompanied by his assistant."],
    ["accomplish", "/əˈkʌmplɪʃ/", "v.", "完成；实现", "She accomplished more in a year than most do in five."],
    ["accurate", "/ˈækjət/", "adj.", "准确的；精确的", "The report gives an accurate picture of the market."],
    ["achieve", "/əˈtʃiːv/", "v.", "达到；实现", "You can achieve your goals if you keep going."],
    ["acquire", "/əˈkwaɪə/", "v.", "获得；学到", "Children acquire language naturally."],
    ["adapt", "/əˈdæpt/", "v.", "适应；改编", "It took him a while to adapt to the new city."],
    ["adequate", "/ˈædɪkwət/", "adj.", "足够的；适当的", "The lighting in the room is adequate for reading."],
    ["adjust", "/əˈdʒʌst/", "v.", "调整；适应", "Please adjust the seat to a comfortable position."],
    ["admire", "/ədˈmaɪə/", "v.", "钦佩；欣赏", "I admire her courage."],
    ["adopt", "/əˈdɒpt/", "v.", "采用；收养", "The company adopted a new policy last month."],
    ["advantage", "/ədˈvɑːntɪdʒ/", "n.", "优势；好处", "Experience is a big advantage in this job."],
    ["affect", "/əˈfekt/", "v.", "影响；感动", "The news deeply affected everyone in the room."],
    ["afford", "/əˈfɔːd/", "v.", "负担得起；抽得出", "We can't afford a new car this year."],
    ["agriculture", "/ˈæɡrɪkʌltʃə/", "n.", "农业", "Agriculture remains important in that region."],
    ["alternative", "/ɔːlˈtɜːnətɪv/", "n.", "替代方案；adj. 可替代的", "Is there an alternative to this plan?"],
    ["analyze", "/ˈænəlaɪz/", "v.", "分析", "Researchers analyzed the data from the survey."],
    ["ancient", "/ˈeɪnʃənt/", "adj.", "古代的；古老的", "The museum displays ancient Chinese pottery."],
    ["appeal", "/əˈpiːl/", "v.", "吸引；呼吁", "The idea appeals to young people."],
    ["appreciate", "/əˈpriːʃieɪt/", "v.", "感激；欣赏；理解", "I really appreciate your help."],
    ["approach", "/əˈprəʊtʃ/", "n.", "方法；接近；v. 接近", "We need a new approach to the problem."],
    ["arrange", "/əˈreɪndʒ/", "v.", "安排；整理", "She arranged a meeting for Friday."],
    ["aspect", "/ˈæspekt/", "n.", "方面；外观", "Consider every aspect of the plan."],
    ["assess", "/əˈses/", "v.", "评估；估价", "Teachers assess students' progress each term."],
    ["assume", "/əˈsjuːm/", "v.", "假定；承担", "Don't assume that everyone agrees with you."],
    ["attempt", "/əˈtempt/", "v.", "尝试；n. 企图", "He attempted to fix the machine himself."],
    ["attitude", "/ˈætɪtjuːd/", "n.", "态度；看法", "Her positive attitude impressed the interviewer."],
    ["avoid", "/əˈvɔɪd/", "v.", "避免；躲开", "Try to avoid making the same mistake."],
    ["balance", "/ˈbæləns/", "n.", "平衡；余额；v. 平衡", "It's hard to balance work and family life."],
    ["barrier", "/ˈbæriə/", "n.", "障碍；屏障", "Language can be a barrier to communication."],
    ["benefit", "/ˈbenɪfɪt/", "n.", "好处；福利；v. 受益", "Regular exercise benefits both body and mind."],
    ["brief", "/briːf/", "adj.", "简短的；v. 简要介绍", "He gave a brief account of what happened."],
    ["budget", "/ˈbʌdʒɪt/", "n.", "预算", "The project went over budget."],
    ["campaign", "/kæmˈpeɪn/", "n.", "运动；活动；v. 参加活动", "They launched a campaign to save the library."],
    ["capable", "/ˈkeɪpəbl/", "adj.", "有能力的；能够的", "She is capable of handling the job alone."],
    ["capacity", "/kəˈpæsəti/", "n.", "容量；能力", "The stadium has a capacity of 60,000."],
    ["career", "/kəˈrɪə/", "n.", "职业；事业", "He has built a successful career in design."],
    ["challenge", "/ˈtʃælɪndʒ/", "n.", "挑战；v. 向…挑战", "The new job is a real challenge."],
    ["climate", "/ˈklaɪmət/", "n.", "气候；氛围", "Climate change affects farming worldwide."],
    ["combine", "/kəmˈbaɪn/", "v.", "结合；联合", "The course combines theory with practice."],
    ["comment", "/ˈkɒment/", "n.", "评论；v. 发表评论", "The teacher added a comment in the margin."],
    ["commit", "/kəˈmɪt/", "v.", "承诺；犯（罪）；投入", "She committed herself to the project."],
    ["compare", "/kəmˈpeə/", "v.", "比较；对比", "Compare the two offers before you decide."],
    ["compete", "/kəmˈpiːt/", "v.", "竞争；比赛", "Small shops find it hard to compete with chains."],
    ["complex", "/ˈkɒmpleks/", "adj.", "复杂的；n. 综合体", "The issue is more complex than it looks."],
    ["concentrate", "/ˈkɒnsntreɪt/", "v.", "集中；专心", "I can't concentrate with the TV on."],
    ["concept", "/ˈkɒnsept/", "n.", "概念；观念", "The concept is easy to grasp with an example."],
    ["concern", "/kənˈsɜːn/", "n.", "担忧；关心；v. 涉及", "There is growing concern about air quality."],
    ["conclude", "/kənˈkluːd/", "v.", "得出结论；结束", "The study concluded that sleep improves memory."],
    ["conduct", "/kənˈdʌkt/", "v.", "进行；指挥", "They conducted a survey of local residents."],
    ["confirm", "/kənˈfɜːm/", "v.", "确认；证实", "Please confirm your booking by email."],
    ["conflict", "/ˈkɒnflɪkt/", "n.", "冲突；矛盾", "There is a conflict between the two reports."],
    ["consequence", "/ˈkɒnsɪkwəns/", "n.", "后果；结果", "He had to live with the consequences of his choice."],
    ["consider", "/kənˈsɪdə/", "v.", "考虑；认为", "We are considering moving to another city."],
    ["consist", "/kənˈsɪst/", "v.", "由…组成；在于", "The team consists of eight members."],
    ["constant", "/ˈkɒnstənt/", "adj.", "持续的；不变的", "The machine needs constant attention."],
    ["consume", "/kənˈsjuːm/", "v.", "消耗；消费", "The factory consumes a lot of electricity."],
    ["contribute", "/kənˈtrɪbjuːt/", "v.", "贡献；促成", "Everyone contributed to the success of the event."],
    ["convenient", "/kənˈviːniənt/", "adj.", "方便的；近便的", "Would Friday be convenient for you?"],
    ["convince", "/kənˈvɪns/", "v.", "说服；使确信", "Nothing could convince him to change his mind."],
    ["create", "/kriˈeɪt/", "v.", "创造；造成", "The policy created new opportunities."],
    ["crisis", "/ˈkraɪsɪs/", "n.", "危机；关键时刻", "The company survived the financial crisis."],
    ["culture", "/ˈkʌltʃə/", "n.", "文化；栽培", "Food is an important part of local culture."],
    ["damage", "/ˈdæmɪdʒ/", "n.", "损害；v. 破坏", "The storm caused serious damage to the roof."],
    ["decline", "/dɪˈklaɪn/", "v.", "下降；拒绝；n. 衰退", "Sales declined sharply last quarter."],
    ["define", "/dɪˈfaɪn/", "v.", "定义；界定", "It is hard to define success in one sentence."],
    ["delay", "/dɪˈleɪ/", "v.", "推迟；n. 延误", "The flight was delayed by two hours."],
    ["demand", "/dɪˈmɑːnd/", "n.", "需求；v. 要求", "Demand for electric cars keeps rising."],
    ["demonstrate", "/ˈdemənstreɪt/", "v.", "证明；演示", "The experiment demonstrates how pressure works."],
    ["deny", "/dɪˈnaɪ/", "v.", "否认；拒绝给予", "He denied any involvement in the case."],
    ["depend", "/dɪˈpend/", "v.", "依靠；取决于", "The result depends on how hard you work."],
    ["describe", "/dɪˈskraɪb/", "v.", "描述；形容", "Can you describe what the man looked like?"],
    ["deserve", "/dɪˈzɜːv/", "v.", "值得；应得", "You deserve a break after all that work."],
    ["despite", "/dɪˈspaɪt/", "prep.", "尽管；不管", "Despite the rain, the match went on."],
    ["determine", "/dɪˈtɜːmɪn/", "v.", "决定；确定", "Your attitude determines your altitude."],
    ["device", "/dɪˈvaɪs/", "n.", "装置；设备", "The device can measure air quality."],
    ["distinguish", "/dɪˈstɪŋɡwɪʃ/", "v.", "区分；辨别", "Can you distinguish between the two species?"],
    ["domestic", "/dəˈmestɪk/", "adj.", "国内的；家庭的", "Domestic flights were delayed by fog."],
    ["efficient", "/ɪˈfɪʃnt/", "adj.", "高效的；效率高的", "The new system is far more efficient."],
    ["eliminate", "/ɪˈlɪmɪneɪt/", "v.", "消除；淘汰", "We must eliminate waste wherever possible."],
    ["emerge", "/ɪˈmɜːdʒ/", "v.", "出现；显露", "New evidence emerged during the trial."],
    ["emphasize", "/ˈemfəsaɪz/", "v.", "强调；着重", "He emphasized the importance of teamwork."],
    ["enable", "/ɪˈneɪbl/", "v.", "使能够；启用", "The app enables users to track their progress."],
    ["encounter", "/ɪnˈkaʊntə/", "v.", "遇到；n. 遭遇", "We encountered several problems on the way."],
    ["ensure", "/ɪnˈʃʊə/", "v.", "确保；保证", "Please ensure that the door is locked."],
    ["environment", "/ɪnˈvaɪrənmənt/", "n.", "环境；周围状况", "We should protect the environment."],
    ["establish", "/ɪˈstæblɪʃ/", "v.", "建立；确立", "The school was established in 1920."],
    ["evaluate", "/ɪˈvæljueɪt/", "v.", "评估；评价", "The committee will evaluate all applications."],
    ["evidence", "/ˈevɪdəns/", "n.", "证据；迹象", "There is no evidence to support that claim."],
    ["expand", "/ɪkˈspænd/", "v.", "扩大；膨胀", "The company plans to expand into Asia."],
    ["expect", "/ɪkˈspekt/", "v.", "期望；预料", "We expect the results next week."],
    ["explore", "/ɪkˈsplɔː/", "v.", "探索；探讨", "The book explores the idea of happiness."],
    ["expose", "/ɪkˈspəʊz/", "v.", "暴露；使接触", "Children should be exposed to different cultures."],
    ["feature", "/ˈfiːtʃə/", "n.", "特征；特色；v. 以…为特色", "The phone's best feature is its battery life."],
    ["flexible", "/ˈfleksəbl/", "adj.", "灵活的；可弯曲的", "We offer flexible working hours."],
    ["focus", "/ˈfəʊkəs/", "v.", "集中；n. 焦点", "Let's focus on the main issue first."],
    ["frequent", "/ˈfriːkwənt/", "adj.", "频繁的；经常的", "He is a frequent visitor to the museum."],
    ["fundamental", "/ˌfʌndəˈmentl/", "adj.", "根本的；基础的", "Trust is fundamental to any relationship."],
    ["generate", "/ˈdʒenəreɪt/", "v.", "产生；生成", "Solar panels generate clean electricity."],
    ["guarantee", "/ˌɡærənˈtiː/", "v.", "保证；n. 保修", "Hard work does not guarantee success."],
    ["identify", "/aɪˈdentɪfaɪ/", "v.", "识别；确认", "Can you identify the man in this photo?"],
    ["ignore", "/ɪɡˈnɔː/", "v.", "忽视；不理会", "Don't ignore the warning signs."],
    ["impact", "/ˈɪmpækt/", "n.", "影响；冲击", "The policy had a huge impact on farmers."],
    ["implement", "/ˈɪmplɪment/", "v.", "实施；执行", "The new rules will be implemented in May."],
    ["improve", "/ɪmˈpruːv/", "v.", "改进；提高", "Practice will improve your pronunciation."],
    ["include", "/ɪnˈkluːd/", "v.", "包括；包含", "The price includes breakfast."],
    ["increase", "/ɪnˈkriːs/", "v.", "增加；n. 增长", "Sales increased by 20 percent."],
    ["independent", "/ˌɪndɪˈpendənt/", "adj.", "独立的；自主的", "She became financially independent at 22."],
    ["influence", "/ˈɪnfluəns/", "n.", "影响；v. 影响", "Peer pressure can influence teenagers."],
    ["inform", "/ɪnˈfɔːm/", "v.", "通知；告知", "Please inform us of any changes."],
    ["initial", "/ɪˈnɪʃl/", "adj.", "最初的；n. 首字母", "My initial reaction was surprise."],
    ["innovative", "/ˈɪnəveɪtɪv/", "adj.", "创新的；新颖的", "They came up with an innovative solution."],
    ["inspect", "/ɪnˈspekt/", "v.", "检查；视察", "Officials inspected the factory last week."],
    ["install", "/ɪnˈstɔːl/", "v.", "安装；安置", "We installed a new heating system."],
    ["institution", "/ˌɪnstɪˈtjuːʃn/", "n.", "机构；制度", "The university is a respected institution."],
    ["instruct", "/ɪnˈstrʌkt/", "v.", "指示；教授", "The teacher instructed us to read the chapter."],
    ["insurance", "/ɪnˈʃʊərəns/", "n.", "保险", "Do you have travel insurance?"],
    ["intend", "/ɪnˈtend/", "v.", "打算；意图", "I intend to finish the report today."],
    ["investigate", "/ɪnˈvestɪɡeɪt/", "v.", "调查；研究", "Police are investigating the accident."],
    ["involve", "/ɪnˈvɒlv/", "v.", "涉及；使参与", "The job involves a lot of travel."],
    ["issue", "/ˈɪʃuː/", "n.", "问题；期号；v. 发布", "Housing is a major issue in the city."],
    ["maintain", "/meɪnˈteɪn/", "v.", "维持；维修；坚持", "It is important to maintain a healthy diet."],
    ["major", "/ˈmeɪdʒə/", "adj.", "主要的；n. 专业", "Tourism is a major source of income."],
    ["manage", "/ˈmænɪdʒ/", "v.", "管理；设法做到", "She manages a team of ten people."],
    ["measure", "/ˈmeʒə/", "v.", "测量；n. 措施", "The government took measures to reduce pollution."],
    ["method", "/ˈmeθəd/", "n.", "方法；条理", "This method works better for beginners."],
    ["motivate", "/ˈməʊtɪveɪt/", "v.", "激励；促使", "Good teachers motivate their students."],
    ["negative", "/ˈneɡətɪv/", "adj.", "负面的；否定的", "Try not to focus on negative thoughts."],
    ["obtain", "/əbˈteɪn/", "v.", "获得；得到", "You must obtain permission before entering."],
    ["obvious", "/ˈɒbviəs/", "adj.", "明显的；显而易见的", "The answer is obvious once you see it."],
    ["occur", "/əˈkɜː/", "v.", "发生；出现", "The accident occurred at midnight."],
    ["opportunity", "/ˌɒpəˈtjuːnəti/", "n.", "机会；时机", "This is a great opportunity to learn."],
    ["oppose", "/əˈpəʊz/", "v.", "反对；抵制", "Many residents oppose the new road."],
    ["participate", "/pɑːˈtɪsɪpeɪt/", "v.", "参加；参与", "Everyone is welcome to participate."],
    ["particular", "/pəˈtɪkjələ/", "adj.", "特定的；特别的", "Is there a particular reason you chose this?"],
    ["perform", "/pəˈfɔːm/", "v.", "执行；表演；表现", "The team performed well under pressure."],
    ["persuade", "/pəˈsweɪd/", "v.", "说服；劝说", "She persuaded him to see a doctor."],
    ["policy", "/ˈpɒləsi/", "n.", "政策；方针；保单", "The company has a strict no-smoking policy."],
    ["potential", "/pəˈtenʃl/", "adj.", "潜在的；n. 潜力", "The market has huge potential."],
    ["predict", "/prɪˈdɪkt/", "v.", "预测；预言", "It is hard to predict what will happen."],
    ["prevent", "/prɪˈvent/", "v.", "阻止；预防", "Vaccines prevent serious illness."],
    ["previous", "/ˈpriːviəs/", "adj.", "以前的；先前的", "He referred to his previous experience."],
    ["principle", "/ˈprɪnsəpl/", "n.", "原则；原理", "Honesty is one of his basic principles."],
    ["process", "/ˈprəʊses/", "n.", "过程；v. 处理", "Learning a language is a slow process."],
    ["produce", "/prəˈdjuːs/", "v.", "生产；产生", "The factory produces 500 cars a day."],
    ["promote", "/prəˈməʊt/", "v.", "促进；晋升；推广", "Exercise promotes good health."],
    ["propose", "/prəˈpəʊz/", "v.", "提议；求婚", "She proposed a new way to save energy."],
    ["protect", "/prəˈtekt/", "v.", "保护；防护", "Wear a helmet to protect your head."],
    ["provide", "/prəˈvaɪd/", "v.", "提供；规定", "The school provides free lunches."],
    ["purchase", "/ˈpɜːtʃəs/", "v.", "购买；n. 采购", "They purchased the house last year."],
    ["pursue", "/pəˈsjuː/", "v.", "追求；从事", "He decided to pursue a career in medicine."],
    ["react", "/riˈækt/", "v.", "反应；回应", "How did she react to the news?"],
    ["recognize", "/ˈrekəɡnaɪz/", "v.", "认出；承认", "I didn't recognize you with short hair."],
    ["recommend", "/ˌrekəˈmend/", "v.", "推荐；建议", "Can you recommend a good restaurant?"],
    ["reduce", "/rɪˈdjuːs/", "v.", "减少；降低", "We should reduce our use of plastic."],
    ["reflect", "/rɪˈflekt/", "v.", "反映；反射；反思", "The results reflect the students' hard work."],
    ["reject", "/rɪˈdʒekt/", "v.", "拒绝；驳回", "His application was rejected."],
    ["relate", "/rɪˈleɪt/", "v.", "有关；理解", "The two events are closely related."],
    ["relieve", "/rɪˈliːv/", "v.", "减轻；解除", "The medicine relieved her headache."],
    ["rely", "/rɪˈlaɪ/", "v.", "依靠；信赖", "You can rely on him to keep a promise."],
    ["require", "/rɪˈkwaɪə/", "v.", "需要；要求", "The job requires excellent English."],
    ["resist", "/rɪˈzɪst/", "v.", "抵抗；忍住", "I couldn't resist the smell of fresh bread."],
    ["respond", "/rɪˈspɒnd/", "v.", "回应；反应", "She responded to the email immediately."],
    ["restrict", "/rɪˈstrɪkt/", "v.", "限制；约束", "The rules restrict the use of phones."],
    ["reveal", "/rɪˈviːl/", "v.", "揭示；透露", "The survey revealed some surprising facts."],
    ["risk", "/rɪsk/", "n.", "风险；v. 冒…的风险", "Smoking increases the risk of heart disease."],
    ["role", "/rəʊl/", "n.", "角色；作用", "Parents play a key role in education."],
    ["route", "/ruːt/", "n.", "路线；途径", "We took the shortest route home."],
    ["satisfy", "/ˈsætɪsfaɪ/", "v.", "使满意；满足", "The answer did not satisfy the judge."],
    ["significant", "/sɪɡˈnɪfɪkənt/", "adj.", "重要的；显著的", "There was a significant rise in prices."],
    ["similar", "/ˈsɪmələ/", "adj.", "相似的；类似的", "These two designs are very similar."],
    ["solve", "/sɒlv/", "v.", "解决；解答", "Together they solved the problem."],
    ["specific", "/spəˈsɪfɪk/", "adj.", "具体的；特定的", "Can you be more specific about the date?"],
    ["standard", "/ˈstændəd/", "n.", "标准；adj. 标准的", "The food meets high safety standards."],
    ["strategy", "/ˈstrætədʒi/", "n.", "策略；战略", "We need a clear strategy for growth."],
    ["structure", "/ˈstrʌktʃə/", "n.", "结构；v. 组织", "The essay has a clear structure."],
    ["succeed", "/səkˈsiːd/", "v.", "成功；继承", "She succeeded in passing the exam."],
    ["suitable", "/ˈsuːtəbl/", "adj.", "合适的；适宜的", "The film is suitable for children."],
    ["supply", "/səˈplaɪ/", "n.", "供应；v. 供给", "The town's water supply was cut off."],
    ["support", "/səˈpɔːt/", "v.", "支持；n. 支持", "Many people supported the campaign."],
    ["suppose", "/səˈpəʊz/", "v.", "假设；认为", "I suppose you are right."],
    ["survive", "/səˈvaɪv/", "v.", "幸存；挺过", "Only one tree survived the storm."],
    ["tend", "/tend/", "v.", "倾向于；照料", "People tend to eat more in winter."],
    ["theory", "/ˈθɪəri/", "n.", "理论；学说", "In theory the plan sounds simple."],
    ["threat", "/θret/", "n.", "威胁；恐吓", "Pollution is a threat to public health."],
    ["transfer", "/trænsˈfɜː/", "v.", "转移；调动；n. 转让", "He transferred to another department."],
    ["transport", "/ˈtrænspɔːt/", "n.", "交通；运输；v. 运输", "Public transport in the city is cheap."],
    ["trend", "/trend/", "n.", "趋势；潮流", "There is a trend toward smaller cars."],
    ["typical", "/ˈtɪpɪkl/", "adj.", "典型的；一贯的", "This is a typical example of his work."],
    ["understand", "/ˌʌndəˈstænd/", "v.", "理解；了解", "I understand how you feel."],
    ["unique", "/juˈniːk/", "adj.", "独特的；唯一的", "Every fingerprint is unique."],
    ["urgent", "/ˈɜːdʒənt/", "adj.", "紧急的；急迫的", "The letter is marked urgent."],
    ["various", "/ˈveəriəs/", "adj.", "各种各样的；不同的", "The shop sells various kinds of tea."],
    ["victim", "/ˈvɪktɪm/", "n.", "受害者；牺牲品", "The victims were taken to hospital."],
    ["volunteer", "/ˌvɒlənˈtɪə/", "n.", "志愿者；v. 自愿", "Dozens of volunteers helped clean the park."],
    ["warn", "/wɔːn/", "v.", "警告；提醒", "The guide warned us about the strong current."],
    ["welfare", "/ˈwelfeə/", "n.", "福利；幸福", "The charity works for animal welfare."],
    ["witness", "/ˈwɪtnəs/", "n.", "目击者；v. 目睹", "Several witnesses saw the car leave."],
    ["worth", "/wɜːθ/", "adj.", "值得的；n. 价值", "The museum is well worth a visit."],
  ];

  const BANK_CET6 = [
    ["abundant", "/əˈbʌndənt/", "adj.", "丰富的；充裕的", "The region has abundant natural resources."],
    ["accelerate", "/əkˈseləreɪt/", "v.", "加速；促进", "The government hopes to accelerate economic growth."],
    ["accessible", "/əkˈsesəbl/", "adj.", "可到达的；易理解的", "The building is accessible to wheelchair users."],
    ["accommodate", "/əˈkɒmədeɪt/", "v.", "容纳；适应；提供住处", "The hall can accommodate 300 people."],
    ["accumulate", "/əˈkjuːmjəleɪt/", "v.", "积累；积聚", "Dust had accumulated on the shelves."],
    ["acknowledge", "/əkˈnɒlɪdʒ/", "v.", "承认；致谢", "He acknowledged that he had made a mistake."],
    ["advocate", "/ˈædvəkeɪt/", "v.", "提倡；n. 拥护者", "She advocates a healthier lifestyle."],
    ["aesthetic", "/iːsˈθetɪk/", "adj.", "审美的；美学的", "The building has great aesthetic appeal."],
    ["allege", "/əˈledʒ/", "v.", "声称；指控", "The report alleges that the firm broke the law."],
    ["allocate", "/ˈæləkeɪt/", "v.", "分配；拨出", "The council allocated funds for new schools."],
    ["ambiguous", "/æmˈbɪɡjuəs/", "adj.", "模棱两可的；含糊的", "His answer was deliberately ambiguous."],
    ["anticipate", "/ænˈtɪsɪpeɪt/", "v.", "预料；期望", "We anticipate a rise in demand."],
    ["apparent", "/əˈpærənt/", "adj.", "明显的；表面的", "It soon became apparent that he was lying."],
    ["arbitrary", "/ˈɑːbɪtrəri/", "adj.", "任意的；武断的", "The decision seemed completely arbitrary."],
    ["articulate", "/ɑːˈtɪkjuleɪt/", "v.", "清楚表达；adj. 口齿清楚的", "She articulated her concerns clearly."],
    ["aspire", "/əˈspaɪə/", "v.", "渴望；追求", "He aspires to become a doctor."],
    ["assert", "/əˈsɜːt/", "v.", "断言；维护", "She asserted that the report was inaccurate."],
    ["assumption", "/əˈsʌmpʃn/", "n.", "假设；假定", "The plan rests on a shaky assumption."],
    ["attribute", "/əˈtrɪbjuːt/", "v.", "把…归因于；n. 属性", "She attributes her success to hard work."],
    ["authentic", "/ɔːˈθentɪk/", "adj.", "真正的；可信的", "The restaurant serves authentic Sichuan food."],
    ["autonomous", "/ɔːˈtɒnəməs/", "adj.", "自治的；自主的", "The region is largely autonomous."],
    ["beneficial", "/ˌbenɪˈfɪʃl/", "adj.", "有益的；有利的", "Regular exercise is beneficial to health."],
    ["bias", "/ˈbaɪəs/", "n.", "偏见；偏向", "The study was criticized for bias."],
    ["boost", "/buːst/", "v.", "促进；提高；n. 推动", "The tax cut should boost consumer spending."],
    ["compel", "/kəmˈpel/", "v.", "强迫；迫使", "Bad weather compelled us to stay indoors."],
    ["compensate", "/ˈkɒmpenseɪt/", "v.", "补偿；弥补", "Nothing can compensate for the loss of a friend."],
    ["competent", "/ˈkɒmpɪtənt/", "adj.", "有能力的；胜任的", "She is a competent and reliable manager."],
    ["comprehensive", "/ˌkɒmprɪˈhensɪv/", "adj.", "全面的；综合的", "The report gives a comprehensive overview."],
    ["compromise", "/ˈkɒmprəmaɪz/", "n.", "妥协；v. 妥协；损害", "Both sides had to compromise."],
    ["conceive", "/kənˈsiːv/", "v.", "构想；想象；怀孕", "It is hard to conceive of life without the internet."],
    ["condemn", "/kənˈdem/", "v.", "谴责；判刑", "The attack was condemned by world leaders."],
    ["confront", "/kənˈfrʌnt/", "v.", "面对；对抗", "She had to confront her fears."],
    ["consensus", "/kənˈsensəs/", "n.", "共识；一致意见", "The team reached a consensus on the plan."],
    ["conserve", "/kənˈsɜːv/", "v.", "保护；节约", "We must conserve water in summer."],
    ["conspicuous", "/kənˈspɪkjuəs/", "adj.", "显眼的；显著的", "His red coat made him conspicuous."],
    ["constitute", "/ˈkɒnstɪtjuːt/", "v.", "构成；组成", "Women constitute half of the workforce."],
    ["controversial", "/ˌkɒntrəˈvɜːʃl/", "adj.", "有争议的", "The decision proved highly controversial."],
    ["convey", "/kənˈveɪ/", "v.", "传达；运送", "Poetry can convey feelings that words alone cannot."],
    ["cope", "/kəʊp/", "v.", "应对；处理", "She found it hard to cope with the pressure."],
    ["crucial", "/ˈkruːʃl/", "adj.", "至关重要的；关键的", "The next few weeks will be crucial."],
    ["debate", "/dɪˈbeɪt/", "n.", "辩论；v. 争论", "There is still debate about the causes."],
    ["deficit", "/ˈdefɪsɪt/", "n.", "赤字；不足", "The country is running a trade deficit."],
    ["deliberate", "/dɪˈlɪbərət/", "adj.", "故意的；审慎的", "The damage was clearly deliberate."],
    ["denote", "/dɪˈnəʊt/", "v.", "表示；意味着", "In this chart, red denotes danger."],
    ["depict", "/dɪˈpɪkt/", "v.", "描绘；刻画", "The painting depicts a quiet village."],
    ["deprive", "/dɪˈpraɪv/", "v.", "剥夺；使丧失", "No child should be deprived of education."],
    ["derive", "/dɪˈraɪv/", "v.", "源自；获得", "The word derives from Latin."],
    ["diminish", "/dɪˈmɪnɪʃ/", "v.", "减少；削弱", "His influence has diminished over the years."],
    ["discriminate", "/dɪˈskrɪmɪneɪt/", "v.", "歧视；区分", "It is illegal to discriminate on the basis of age."],
    ["dismiss", "/dɪsˈmɪs/", "v.", "解雇；不予考虑", "The idea was dismissed as impractical."],
    ["dispose", "/dɪˈspəʊz/", "v.", "处理；丢弃", "Please dispose of your rubbish properly."],
    ["distort", "/dɪˈstɔːt/", "v.", "扭曲；歪曲", "The media distorted what she had said."],
    ["diverse", "/daɪˈvɜːs/", "adj.", "多样的；不同的", "The city has a diverse population."],
    ["dominate", "/ˈdɒmɪneɪt/", "v.", "支配；占主导", "A few firms dominate the market."],
    ["dramatic", "/drəˈmætɪk/", "adj.", "戏剧性的；巨大的", "There has been a dramatic change in policy."],
    ["elaborate", "/ɪˈlæbərət/", "adj.", "精心制作的；v. 详细说明", "Could you elaborate on your proposal?"],
    ["embrace", "/ɪmˈbreɪs/", "v.", "拥抱；欣然接受", "The company embraced new technology."],
    ["empirical", "/ɪmˈpɪrɪkl/", "adj.", "经验的；实证的", "The theory lacks empirical support."],
    ["endure", "/ɪnˈdjʊə/", "v.", "忍受；持续", "The pain was almost too much to endure."],
    ["enhance", "/ɪnˈhɑːns/", "v.", "增强；提高", "Good lighting can enhance a room."],
    ["entail", "/ɪnˈteɪl/", "v.", "涉及；需要", "The job entails a lot of responsibility."],
    ["equivalent", "/ɪˈkwɪvələnt/", "adj.", "相等的；n. 等价物", "One kilometre is equivalent to 1,000 metres."],
    ["essence", "/ˈesns/", "n.", "本质；精髓", "The essence of the argument is simple."],
    ["evoke", "/ɪˈvəʊk/", "v.", "唤起；引起", "The song evokes memories of childhood."],
    ["exaggerate", "/ɪɡˈzædʒəreɪt/", "v.", "夸大；夸张", "He tends to exaggerate his achievements."],
    ["exceed", "/ɪkˈsiːd/", "v.", "超过；超越", "The cost must not exceed the budget."],
    ["exclusive", "/ɪkˈskluːsɪv/", "adj.", "独有的；排他的", "The club is exclusive and expensive."],
    ["exempt", "/ɪɡˈzempt/", "adj.", "被免除的；v. 免除", "Students are exempt from the fee."],
    ["exert", "/ɪɡˈzɜːt/", "v.", "施加；运用", "The pressure group exerted influence on policy."],
    ["exhaust", "/ɪɡˈzɔːst/", "v.", "使精疲力尽；耗尽", "The long journey exhausted us all."],
    ["exploit", "/ɪkˈsplɔɪt/", "v.", "利用；剥削", "They exploited a gap in the law."],
    ["facilitate", "/fəˈsɪlɪteɪt/", "v.", "促进；使便利", "The app facilitates communication between teams."],
    ["feasible", "/ˈfiːzəbl/", "adj.", "可行的；行得通的", "Is it feasible to finish by Friday?"],
    ["fluctuate", "/ˈflʌktʃueɪt/", "v.", "波动；起伏", "Prices fluctuate with the seasons."],
    ["foster", "/ˈfɒstə/", "v.", "培养；促进；收养", "Schools should foster creativity."],
    ["fragile", "/ˈfrædʒaɪl/", "adj.", "脆弱的；易碎的", "The peace deal remains fragile."],
    ["genuine", "/ˈdʒenjuɪn/", "adj.", "真正的；真诚的", "She showed genuine interest in my work."],
    ["hypothesis", "/haɪˈpɒθəsɪs/", "n.", "假设；假说", "The data supports the hypothesis."],
    ["immerse", "/ɪˈmɜːs/", "v.", "使沉浸；浸没", "She immersed herself in the local culture."],
    ["impose", "/ɪmˈpəʊz/", "v.", "强加；征收", "The government imposed new taxes."],
    ["incentive", "/ɪnˈsentɪv/", "n.", "激励；动机", "Bonuses are an incentive to work harder."],
    ["incline", "/ɪnˈklaɪn/", "v.", "倾向；使倾斜", "I incline to agree with you."],
    ["indicate", "/ˈɪndɪkeɪt/", "v.", "表明；指示", "The results indicate a clear trend."],
    ["indispensable", "/ˌɪndɪˈspensəbl/", "adj.", "不可或缺的", "Smartphones have become indispensable."],
    ["inevitable", "/ɪnˈevɪtəbl/", "adj.", "不可避免的", "Conflict was inevitable."],
    ["infer", "/ɪnˈfɜː/", "v.", "推断；推论", "We can infer from the text that she was upset."],
    ["inherent", "/ɪnˈhɪərənt/", "adj.", "固有的；内在的", "Risk is inherent in any business."],
    ["inhibit", "/ɪnˈhɪbɪt/", "v.", "抑制；阻碍", "Fear can inhibit creativity."],
    ["initiate", "/ɪˈnɪʃieɪt/", "v.", "发起；开始", "They initiated a programme to plant trees."],
    ["integrate", "/ˈɪntɪɡreɪt/", "v.", "整合；融入", "The software integrates with existing systems."],
    ["intense", "/ɪnˈtens/", "adj.", "强烈的；紧张的", "The competition is intense."],
    ["interfere", "/ˌɪntəˈfɪə/", "v.", "干涉；妨碍", "Do not interfere with the machine."],
    ["interpret", "/ɪnˈtɜːprɪt/", "v.", "解释；口译", "How do you interpret these results?"],
    ["intuitive", "/ɪnˈtjuːɪtɪv/", "adj.", "直觉的；易懂的", "The interface is clean and intuitive."],
    ["irrational", "/ɪˈræʃənl/", "adj.", "不理性的；荒谬的", "It is irrational to worry about things you cannot control."],
    ["justify", "/ˈdʒʌstɪfaɪ/", "v.", "证明…正当；辩护", "Nothing can justify such cruelty."],
    ["legitimate", "/lɪˈdʒɪtɪmət/", "adj.", "合法的；合理的", "They have a legitimate claim to the land."],
    ["manipulate", "/məˈnɪpjuleɪt/", "v.", "操纵；操作", "He tried to manipulate public opinion."],
    ["mediate", "/ˈmiːdieɪt/", "v.", "调解；斡旋", "The UN mediated between the two sides."],
    ["notion", "/ˈnəʊʃn/", "n.", "观念；想法", "I had no notion of what she meant."],
    ["obscure", "/əbˈskjʊə/", "adj.", "模糊的；v. 遮掩", "The meaning of the poem is obscure."],
    ["optimistic", "/ˌɒptɪˈmɪstɪk/", "adj.", "乐观的", "She remains optimistic about the future."],
    ["paradox", "/ˈpærədɒks/", "n.", "悖论；矛盾现象", "It is a paradox that such a rich country has so much poverty."],
    ["persistent", "/pəˈsɪstənt/", "adj.", "持续的；坚持不懈的", "His persistent efforts finally paid off."],
    ["pessimistic", "/ˌpesɪˈmɪstɪk/", "adj.", "悲观的", "Analysts are pessimistic about growth."],
    ["plausible", "/ˈplɔːzəbl/", "adj.", "似乎合理的；可信的", "That is a plausible explanation."],
    ["premium", "/ˈpriːmiəm/", "n.", "保险费；adj. 优质的", "Consumers are willing to pay a premium for quality."],
    ["prevalent", "/ˈprevələnt/", "adj.", "普遍的；流行的", "The disease is more prevalent in winter."],
    ["profound", "/prəˈfaʊnd/", "adj.", "深刻的；深远的", "The book had a profound effect on me."],
    ["prominent", "/ˈprɒmɪnənt/", "adj.", "突出的；著名的", "She is a prominent figure in the field."],
    ["provoke", "/prəˈvəʊk/", "v.", "激起；挑衅", "The decision provoked widespread anger."],
    ["radical", "/ˈrædɪkl/", "adj.", "根本的；激进的", "The company needs radical change."],
    ["reinforce", "/ˌriːɪnˈfɔːs/", "v.", "加强；强化", "The findings reinforce earlier research."],
    ["reluctant", "/rɪˈlʌktənt/", "adj.", "不情愿的；勉强的", "He was reluctant to admit he was wrong."],
    ["restore", "/rɪˈstɔː/", "v.", "恢复；修复", "The old house has been restored."],
    ["rigid", "/ˈrɪdʒɪd/", "adj.", "僵硬的；死板的", "The rules are too rigid."],
    ["sceptical", "/ˈskeptɪkl/", "adj.", "怀疑的", "I remain sceptical about his claims."],
    ["simultaneous", "/ˌsɪmlˈteɪniəs/", "adj.", "同时发生的", "The two events were simultaneous."],
    ["sophisticated", "/səˈfɪstɪkeɪtɪd/", "adj.", "复杂精密的；老练的", "The lab uses sophisticated equipment."],
    ["speculate", "/ˈspekjuleɪt/", "v.", "推测；投机", "Reporters speculated about the reason for her resignation."],
    ["spontaneous", "/spɒnˈteɪniəs/", "adj.", "自发的；即兴的", "The audience broke into spontaneous applause."],
    ["subsequent", "/ˈsʌbsɪkwənt/", "adj.", "随后的；后来的", "Subsequent events proved him right."],
    ["subtle", "/ˈsʌtl/", "adj.", "微妙的；不易察觉的", "There is a subtle difference between the two words."],
    ["sufficient", "/səˈfɪʃnt/", "adj.", "充足的；足够的", "We have sufficient food for a week."],
    ["suppress", "/səˈpres/", "v.", "压制；抑制", "She could not suppress a smile."],
    ["sustainable", "/səˈsteɪnəbl/", "adj.", "可持续的", "We need a sustainable energy policy."],
    ["terminate", "/ˈtɜːmɪneɪt/", "v.", "终止；结束", "The contract was terminated last month."],
    ["transparent", "/trænsˈpærənt/", "adj.", "透明的；公开的", "The process should be transparent."],
    ["undermine", "/ˌʌndəˈmaɪn/", "v.", "削弱；逐渐损害", "Constant criticism undermined her confidence."],
    ["utilize", "/ˈjuːtɪlaɪz/", "v.", "利用；使用", "We should utilize every available resource."],
    ["vague", "/veɪɡ/", "adj.", "模糊的；含糊的", "He gave a vague answer to my question."],
    ["validate", "/ˈvælɪdeɪt/", "v.", "证实；使有效", "Further tests are needed to validate the theory."],
    ["versatile", "/ˈvɜːsətaɪl/", "adj.", "多才多艺的；多用途的", "She is a versatile actress."],
    ["vulnerable", "/ˈvʌlnərəbl/", "adj.", "易受伤害的；脆弱的", "Young children are especially vulnerable."],
    ["withdraw", "/wɪðˈdrɔː/", "v.", "撤回；提款；退出", "He withdrew his application."],
    ["yield", "/jiːld/", "v.", "产生；屈服；n. 产量", "The farm yields enough rice for the village."],
  ];

  /* 考研核心高频词（阅读/翻译高频，约 90 个） */
  const BANK_KAOYAN = [
    ["abstract", "/ˈæbstrækt/", "adj.", "抽象的；n. 摘要", "Abstract concepts are hard to grasp."],
    ["academy", "/əˈkædəmi/", "n.", "学院；学会", "She was admitted to the Royal Academy."],
    ["acknowledge", "/əkˈnɒlɪdʒ/", "v.", "承认；确认收到", "He acknowledged his mistake publicly."],
    ["advocate", "/ˈædvəkeɪt/", "v.", "提倡；n. 拥护者", "Many experts advocate reforming the system."],
    ["aesthetic", "/iːsˈθetɪk/", "adj.", "美学的；审美的", "The design has great aesthetic appeal."],
    ["aggregate", "/ˈæɡrɪɡət/", "n.", "总数；adj. 合计的", "The aggregate amount was surprisingly large."],
    ["allegation", "/ˌæləˈɡeɪʃn/", "n.", "指控；陈述", "The allegation was never proven."],
    ["ambiguous", "/æmˈbɪɡjuəs/", "adj.", "模棱两可的", "His answer was deliberately ambiguous."],
    ["analogy", "/əˈnælədʒi/", "n.", "类比；相似", "He drew an analogy between the brain and a computer."],
    ["anticipate", "/ænˈtɪsɪpeɪt/", "v.", "预期；期待", "We anticipate a sharp rise in demand."],
    ["arbitrary", "/ˈɑːbɪtrəri/", "adj.", "任意的；武断的", "The decision seemed arbitrary and unfair."],
    ["articulate", "/ɑːˈtɪkjuleɪt/", "v.", "清晰表达；adj. 口才好的", "She articulated her ideas clearly."],
    ["assess", "/əˈses/", "v.", "评估；估价", "We need to assess the impact of the policy."],
    ["assumption", "/əˈsʌmpʃn/", "n.", "假设；假定", "Your argument rests on a false assumption."],
    ["attribute", "/əˈtrɪbjuːt/", "v.", "归因于；n. 属性", "He attributed his success to hard work."],
    ["autonomy", "/ɔːˈtɒnəmi/", "n.", "自治；自主权", "The region was granted full autonomy."],
    ["benign", "/bɪˈnaɪn/", "adj.", "善良的；良性的", "The tumor turned out to be benign."],
    ["bias", "/ˈbaɪəs/", "n.", "偏见；偏差", "The report was criticized for its bias."],
    ["catalyst", "/ˈkætəlɪst/", "n.", "催化剂；促进因素", "The crisis acted as a catalyst for reform."],
    ["coerce", "/kəʊˈɜːs/", "v.", "强迫；胁迫", "He was coerced into signing the contract."],
    ["cognitive", "/ˈkɒɡnətɪv/", "adj.", "认知的", "Children's cognitive abilities develop rapidly."],
    ["coincide", "/ˌkəʊɪnˈsaɪd/", "v.", "同时发生；一致", "Their views on this issue coincide."],
    ["commensurate", "/kəˈmenʃərət/", "adj.", "相称的；相当的", "Salary will be commensurate with experience."],
    ["compelling", "/kəmˈpelɪŋ/", "adj.", "令人信服的；引人入胜的", "She made a compelling case for change."],
    ["compensate", "/ˈkɒmpenseɪt/", "v.", "补偿；赔偿", "The company compensated him for the injury."],
    ["compiled", "/kəmˈpaɪld/", "v.", "编纂；汇编", "The data were compiled from various sources."],
    ["complement", "/ˈkɒmplɪment/", "v.", "补充；n. 补足物", "The wine complements the dish perfectly."],
    ["comprehensive", "/ˌkɒmprɪˈhensɪv/", "adj.", "全面的；综合的", "We need a comprehensive review of the policy."],
    ["conceive", "/kənˈsiːv/", "v.", "构想；设想", "He conceived a bold new plan."],
    ["conform", "/kənˈfɔːm/", "v.", "遵从；符合", "Products must conform to safety standards."],
    ["conspicuous", "/kənˈspɪkjuəs/", "adj.", "显眼的；显眼的", "Her red coat made her conspicuous."],
    ["contemplate", "/ˈkɒntəmpleɪt/", "v.", "深思；凝视", "He sat quietly, contemplating his future."],
    ["controversy", "/ˈkɒntrəvɜːsi/", "n.", "争议；争论", "The decision sparked widespread controversy."],
    ["convene", "/kənˈviːn/", "v.", "召集；集合", "The committee convened at noon."],
    ["correlate", "/ˈkɒrəleɪt/", "v.", "相关；关联", "Smoking correlates with lung cancer."],
    ["culpable", "/ˈkʌlpəbl/", "adj.", "该受谴责的；有罪的", "He was held culpable for the accident."],
    ["deduce", "/dɪˈdjuːs/", "v.", "推断；演绎", "We can deduce the answer from the clues."],
    ["deem", "/diːm/", "v.", "认为；视为", "He was deemed unfit for the task."],
    ["deteriorate", "/dɪˈtɪəriəreɪt/", "v.", "恶化；变坏", "His health began to deteriorate rapidly."],
    ["deviate", "/ˈdiːvieɪt/", "v.", "偏离；背离", "The plan deviated from the original."],
    ["diminish", "/dɪˈmɪnɪʃ/", "v.", "减少；缩小", "The pain gradually diminished."],
    ["disclose", "/dɪsˈkləʊz/", "v.", "透露；公开", "The company disclosed its financials."],
    ["discriminate", "/dɪˈskrɪmɪneɪt/", "v.", "歧视；区分", "It's wrong to discriminate based on age."],
    ["disposition", "/ˌdɪspəˈzɪʃn/", "n.", "性情；倾向", "She has a cheerful disposition."],
    ["disrupt", "/dɪsˈrʌpt/", "v.", "扰乱；使中断", "The strike disrupted train services."],
    ["diverse", "/daɪˈvɜːs/", "adj.", "多样的；不同的", "The college has a diverse student body."],
    ["elaborate", "/ɪˈlæbərət/", "adj.", "详尽的；v. 详细说明", "Could you elaborate on your proposal?"],
    ["eligible", "/ˈelɪdʒəbl/", "adj.", "符合条件的；合格的", "Only seniors are eligible to vote."],
    ["eliminate", "/ɪˈlɪmɪneɪt/", "v.", "消除；淘汰", "We should eliminate unnecessary costs."],
    ["empirical", "/ɪmˈpɪrɪkl/", "adj.", "经验主义的；实证的", "We need empirical evidence to support the claim."],
    ["endeavor", "/ɪnˈdevə/", "n.", "努力；尽力", "We will make every endeavor to help."],
    ["endure", "/ɪnˈdjʊə/", "v.", "忍受；持久", "She endured great hardship."],
    ["enhance", "/ɪnˈhɑːns/", "v.", "提高；增强", "Technology can enhance our learning."],
    ["enumerate", "/ɪˈnjuːməreɪt/", "v.", "列举；枚举", "He enumerated the reasons for his decision."],
    ["equilibrium", "/ˌiːkwɪˈlɪbriəm/", "n.", "平衡；均衡", "The ecosystem reached a new equilibrium."],
    ["erudite", "/ˈerudaɪt/", "adj.", "博学的", "His erudite lecture impressed everyone."],
    ["inevitable", "/ɪnˈevɪtəbl/", "adj.", "不可避免的", "Change is inevitable."],
    ["exacerbate", "/ɪɡˈzæsəbeɪt/", "v.", "使恶化；激怒", "The policy exacerbated the problem."],
    ["exemplify", "/ɪɡˈzemplɪfaɪ/", "v.", "例证；作为典范", "This painting exemplifies his style."],
    ["exploit", "/ɪkˈsplɔɪt/", "v.", "开发；剥削", "We need to exploit renewable energy."],
    ["feasible", "/ˈfiːzəbl/", "adj.", "可行的", "It's not feasible to finish in a week."],
    ["fluctuate", "/ˈflʌktʃueɪt/", "v.", "波动；起伏", "Prices fluctuate with demand."],
    ["formulate", "/ˈfɔːmjuleɪt/", "v.", "制定；系统阐述", "We need to formulate a new strategy."],
    ["foundation", "/faʊnˈdeɪʃn/", "n.", "基础；地基", "Good sleep is the foundation of health."],
    ["granted", "/ˈɡrɑːntɪd/", "adv.", "诚然；prep. 授予", "Granted, it's not perfect, but it works."],
    ["hypothesis", "/haɪˈpɒθəsɪs/", "n.", "假设；假说", "The experiment confirmed the hypothesis."],
    ["implement", "/ˈɪmplɪment/", "v.", "实施；执行", "The government will implement the reform next year."],
    ["implicit", "/ɪmˈplɪsɪt/", "adj.", "含蓄的；隐含的", "There was an implicit agreement between them."],
    ["incentive", "/ɪnˈsentɪv/", "n.", "激励；刺激", "Tax cuts provide an incentive to invest."],
    ["incorporate", "/ɪnˈkɔːpəreɪt/", "v.", "包含；合并", "The plan incorporates your suggestions."],
    ["indifferent", "/ɪnˈdɪfrənt/", "adj.", "漠不关心的", "He seemed indifferent to the result."],
    ["inevitably", "/ɪnˈevɪtəbli/", "adv.", "不可避免地", "Mistakes will inevitably happen."],
    ["inherent", "/ɪnˈhɪərənt/", "adj.", "固有的；内在的", "Risk is inherent in any investment."],
    ["initiate", "/ɪˈnɪʃieɪt/", "v.", "开始；发起", "The company initiated a new project."],
    ["integral", "/ˈɪntɪɡrəl/", "adj.", "不可或缺的；完整的", "Music is an integral part of her life."],
    ["intervene", "/ˌɪntəˈviːn/", "v.", "干预；介入", "The government intervened to stabilize prices."],
    ["intrinsic", "/ɪnˈtrɪnsɪk/", "adj.", "内在的；本质的", "The intrinsic value of art is hard to measure."],
    ["intuition", "/ˌɪntjuˈɪʃn/", "n.", "直觉", "Trust your intuition."],
    ["jeopardize", "/ˈdʒepədaɪz/", "v.", "危及；损害", "One mistake could jeopardize the deal."],
    ["legitimate", "/lɪˈdʒɪtɪmət/", "adj.", "合法的；合理的", "He had a legitimate reason for being late."],
    ["magnify", "/ˈmæɡnɪfaɪ/", "v.", "放大；夸大", "The microscope magnifies the image."],
    ["manifest", "/ˈmænɪfest/", "v.", "显示；表明", "Symptoms manifest within a few days."],
    ["mediate", "/ˈmiːdieɪt/", "v.", "调解；斡旋", "The UN mediated the peace talks."],
    ["merit", "/ˈmerɪt/", "n.", "优点；v. 值得", "The proposal has considerable merit."],
    ["modulate", "/ˈmɒdjuleɪt/", "v.", "调节；调制", "He modulated his voice to sound calm."],
    ["negligible", "/ˈneɡlɪdʒəbl/", "adj.", "可忽略的", "The cost was negligible."],
    ["notorious", "/nəʊˈtɔːriəs/", "adj.", "臭名昭著的", "The area is notorious for pickpockets."],
    ["paradigm", "/ˈpærədaɪm/", "n.", "范式；范例", "This shift represents a new paradigm."],
    ["perceive", "/pəˈsiːv/", "v.", "察觉；认为", "How do you perceive the situation?"],
    ["persuade", "/pəˈsweɪd/", "v.", "说服；劝说", "She persuaded him to join the team."],
    ["plausible", "/ˈplɔːzəbl/", "adj.", "貌似合理的", "That's a plausible explanation."],
    ["prevalent", "/ˈprevələnt/", "adj.", "流行的；普遍的", "This disease is prevalent in tropical regions."],
    ["profound", "/prəˈfaʊnd/", "adj.", "深刻的；深远的", "The book had a profound influence on me."],
    ["prohibit", "/prəˈhɪbɪt/", "v.", "禁止", "Smoking is prohibited in public places."],
    ["promote", "/prəˈməʊt/", "v.", "促进；提升", "Exercise promotes good health."],
    ["pursue", "/pəˈsjuː/", "v.", "追求；从事", "She decided to pursue a PhD."],
    ["rational", "/ˈræʃnəl/", "adj.", "理性的；合理的", "We need a rational approach to the problem."],
    ["refine", "/rɪˈfaɪn/", "v.", "改进；提炼", "Refine your argument before the debate."],
    ["reinforce", "/ˌriːɪnˈfɔːs/", "v.", "加强；加固", "The evidence reinforced our conclusion."],
    ["reluctant", "/rɪˈlʌktənt/", "adj.", "不情愿的", "He was reluctant to admit his mistake."],
    ["reside", "/rɪˈzaɪd/", "v.", "居住；存在于", "The president resides in the White House."],
    ["restrain", "/rɪˈstreɪn/", "v.", "抑制；约束", "She could barely restrain her anger."],
    ["retain", "/rɪˈteɪn/", "v.", "保留；保持", "The house retains its original charm."],
    ["reveal", "/rɪˈviːl/", "v.", "揭示；透露", "The study reveals a surprising trend."],
    ["rigorous", "/ˈrɪɡərəs/", "adj.", "严格的；严密的", "The testing process is rigorous."],
    ["scrutiny", "/ˈskruːtəni/", "n.", "仔细检查", "The policy came under public scrutiny."],
    ["simulate", "/ˈsɪmjuleɪt/", "v.", "模拟；模仿", "The software simulates real flight conditions."],
    ["stabilize", "/ˈsteɪbəlaɪz/", "v.", "稳定", "The patient's condition has stabilized."],
    ["subjective", "/səbˈdʒektɪv/", "adj.", "主观的", "Critics can be overly subjective."],
    ["subordinate", "/səˈbɔːdɪnət/", "adj.", "下级的；从属的", "In the army, privates are subordinate to officers."],
    ["substantial", "/səbˈstænʃl/", "adj.", "大量的；实质性的", "The project requires substantial funding."],
    ["supplement", "/ˈsʌplɪmənt/", "n.", "补充；v. 增补", "She takes vitamin supplements daily."],
    ["suppress", "/səˈpres/", "v.", "镇压；抑制", "The government suppressed the rebellion."],
    ["surveillance", "/sɜːˈveɪləns/", "n.", "监视", "The suspect was under police surveillance."],
    ["sustain", "/səˈsteɪn/", "v.", "维持；承受", "The economy cannot sustain this growth."],
    ["tentative", "/ˈtentətɪv/", "adj.", "试探性的；暂定的", "We made a tentative plan."],
    ["threshold", "/ˈθreʃhəʊld/", "n.", "门槛；极限", "He was on the threshold of a new career."],
    ["trigger", "/ˈtrɪɡə/", "v.", "触发；引发", "The price increase triggered protests."],
    ["underlying", "/ˌʌndəˈlaɪɪŋ/", "adj.", "潜在的；根本的", "We must address the underlying causes."],
    ["undermine", "/ˌʌndəˈmaɪn/", "v.", "破坏；削弱", "Constant criticism undermined her confidence."],
    ["utilize", "/ˈjuːtəlaɪz/", "v.", "利用", "We should utilize available resources wisely."],
    ["vigorous", "/ˈvɪɡərəs/", "adj.", "精力充沛的；剧烈的", "The proposal met with vigorous opposition."],
    ["vulnerable", "/ˈvʌlnərəbl/", "adj.", "脆弱的；易受伤害的", "Poor people are most vulnerable to disease."],
  ];

  /* 面试口语高频词（求职/保研面试常用，约 60 个） */
  const BANK_INTERVIEW = [
    ["achieve", "/əˈtʃiːv/", "v.", "实现；取得", "I achieved my goal of graduating on time."],
    ["background", "/ˈbækɡraʊnd/", "n.", "背景；经历", "Let me introduce my academic background."],
    ["challenge", "/ˈtʃælɪndʒ/", "n.", "挑战；v. 质疑", "I enjoy taking on new challenges."],
    ["collaborate", "/kəˈlæbəreɪt/", "v.", "合作", "I collaborated with a team on this project."],
    ["commitment", "/kəˈmɪtmənt/", "n.", "承诺；投入", "I have a strong commitment to research."],
    ["communicate", "/kəˈmjuːnɪkeɪt/", "v.", "沟通", "I communicate effectively with others."],
    ["competent", "/ˈkɒmpɪtənt/", "adj.", "胜任的；有能力的", "I am competent in both English and Chinese."],
    ["confident", "/ˈkɒnfɪdənt/", "adj.", "自信的", "I am confident in my abilities."],
    ["contribute", "/kənˈtrɪbjuːt/", "v.", "贡献；捐助", "I want to contribute to the team."],
    ["cooperate", "/kəʊˈɒpəreɪt/", "v.", "合作", "I always cooperate with my colleagues."],
    ["creative", "/kriˈeɪtɪv/", "adj.", "有创造力的", "I have a creative approach to problem-solving."],
    ["critical", "/ˈkrɪtɪkl/", "adj.", "批判的；关键的", "Critical thinking is essential in research."],
    ["curious", "/ˈkjʊəriəs/", "adj.", "好奇的", "I am curious about how things work."],
    ["deadline", "/ˈdedlaɪn/", "n.", "截止日期", "I always meet my deadlines."],
    ["dedicate", "/ˈdedɪkeɪt/", "v.", "奉献；致力于", "I dedicate myself to my studies."],
    ["determined", "/dɪˈtɜːmɪnd/", "adj.", "坚定的", "I am determined to succeed."],
    ["develop", "/dɪˈveləp/", "v.", "发展；开发", "I developed an interest in biology."],
    ["efficient", "/ɪˈfɪʃnt/", "adj.", "高效的", "I work efficiently under pressure."],
    ["energetic", "/ˌenəˈdʒetɪk/", "adj.", "精力充沛的", "I am energetic and proactive."],
    ["enrich", "/ɪnˈrɪtʃ/", "v.", "丰富；使富足", "Studying abroad enriches one's perspective."],
    ["experience", "/ɪkˈspɪəriəns/", "n.", "经验；经历", "I have three years of research experience."],
    ["expertise", "/ˌekspɜːˈtiːz/", "n.", "专业知识", "My expertise is in data analysis."],
    ["flexible", "/ˈfleksəbl/", "adj.", "灵活的", "I am flexible and adaptable."],
    ["focus", "/ˈfəʊkəs/", "v.", "聚焦；n. 焦点", "I focus on details."],
    ["fulfill", "/fʊlˈfɪl/", "v.", "实现；履行", "I want to fulfill my potential."],
    ["goal", "/ɡəʊl/", "n.", "目标", "My long-term goal is to become a researcher."],
    ["grow", "/ɡrəʊ/", "v.", "成长；增长", "I want to grow both personally and professionally."],
    ["improve", "/ɪmˈpruːv/", "v.", "改进；提高", "I want to improve my English."],
    ["independent", "/ˌɪndɪˈpendənt/", "adj.", "独立的", "I am an independent thinker."],
    ["initiative", "/ɪˈnɪʃətɪv/", "n.", "主动性；倡议", "I take initiative in group projects."],
    ["innovative", "/ˈɪnəveɪtɪv/", "adj.", "创新的", "I have an innovative mindset."],
    ["insight", "/ˈɪnsaɪt/", "n.", "洞察力；见解", "The research gave me new insights."],
    ["integrity", "/ɪnˈteɡrəti/", "n.", "正直；诚实", "I value integrity and honesty."],
    ["interpersonal", "/ˌɪntəˈpɜːsənl/", "adj.", "人际的", "I have strong interpersonal skills."],
    ["interview", "/ˈɪntəvjuː/", "n.", "面试；采访", "Thank you for this interview."],
    ["leadership", "/ˈliːdəʃɪp/", "n.", "领导力", "I have leadership experience as a class monitor."],
    ["learn", "/lɜːn/", "v.", "学习", "I am a quick learner."],
    ["listen", "/ˈlɪsn/", "v.", "倾听", "I listen carefully to feedback."],
    ["motivate", "/ˈməʊtɪveɪt/", "v.", "激励", "I motivate myself to keep learning."],
    ["objective", "/əbˈdʒektɪv/", "n.", "目标；adj. 客观的", "My objective is to publish a paper."],
    ["opportunity", "/ˌɒpəˈtjuːnəti/", "n.", "机会", "This is a great opportunity for me."],
    ["passion", "/ˈpæʃn/", "n.", "热情", "I have a passion for science."],
    ["patient", "/ˈpeɪʃnt/", "adj.", "耐心的；n. 病人", "I am patient with beginners."],
    ["perform", "/pəˈfɔːm/", "v.", "表现；执行", "I perform well in team settings."],
    ["personality", "/ˌpɜːsəˈnæləti/", "n.", "个性；人格", "I have a friendly personality."],
    ["potential", "/pəˈtenʃl/", "n.", "潜力", "I believe I have great potential."],
    ["prepare", "/prɪˈpeə/", "v.", "准备", "I prepared thoroughly for this interview."],
    ["priority", "/praɪˈɒrəti/", "n.", "优先事项", "I set clear priorities."],
    ["proactive", "/ˌprəʊˈæktɪv/", "adj.", "主动的", "I am proactive, not reactive."],
    ["problem-solving", "/ˈprɒbləm sɒlvɪŋ/", "n.", "解决问题", "I have strong problem-solving skills."],
    ["professional", "/prəˈfeʃənl/", "adj.", "专业的", "I maintain a professional attitude."],
    ["project", "/ˈprɒdʒekt/", "n.", "项目；工程", "I led a research project."],
    ["qualified", "/ˈkwɒlɪfaɪd/", "adj.", "合格的", "I believe I am qualified for this position."],
    ["reliability", "/rɪˌlaɪəˈbɪləti/", "n.", "可靠性", "My reliability is my strength."],
    ["responsible", "/rɪˈspɒnsəbl/", "adj.", "负责的", "I am responsible for my work."],
    ["self-motivated", "/self ˈməʊtɪveɪtɪd/", "adj.", "自我驱动的", "I am self-motivated and disciplined."],
    ["skill", "/skɪl/", "n.", "技能", "I have strong technical skills."],
    ["strength", "/streŋθ/", "n.", "优势；力量", "My greatest strength is attention to detail."],
    ["stress", "/stres/", "n.", "压力；v. 强调", "I work well under stress."],
    ["strengths", "/streŋθs/", "n.", "优势（复数）", "My strengths include communication and teamwork."],
    ["teamwork", "/ˈtiːmwɜːk/", "n.", "团队合作", "I value teamwork."],
    ["vision", "/ˈvɪʒn/", "n.", "愿景；视力", "I have a clear vision for my career."],
    ["weakness", "/ˈwiːknəs/", "n.", "弱点", "My weakness is being a perfectionist."],
    ["willing", "/ˈwɪlɪŋ/", "adj.", "乐意的", "I am willing to learn new things."],
  ];

  /* 精讲词书（带音标、例句） */
  function bankWords(level) {
    const raw = level === "CET-4" ? BANK_CET4
      : level === "CET-6" ? BANK_CET6
      : level === "考研核心" ? BANK_KAOYAN
      : level === "面试口语" ? BANK_INTERVIEW
      : [];
    return raw.map(([term, phonetic, pos, meaning, example]) => ({ term, phonetic, pos, meaning, example }));
  }

  /* 考纲词表 = 精讲词书 + wordbook-data.js（4/6 级考纲全量），按字母排序、同书内去重
     词频分在数据源里是「书内归一化」的（CET-4 0.66~1.0、CET-6 0.30~0.50），
     所以分层用书内分位数：前 30% 高频、后 30% 低频。 */
  const bankCache = new Map();
  function allBankWords(level) {
    if (bankCache.has(level)) return bankCache.get(level);
    const out = [];
    const seen = new Set();
    const dataRows = (window.WORDBOOK_DATA && window.WORDBOOK_DATA[level]) || [];
    const dataMap = new Map();
    dataRows.forEach((r) => dataMap.set(String(r[0]).toLowerCase(), r));
    const push = (w) => {
      const k = String(w.term || "").toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      let freq = typeof w.freq === "number" ? w.freq : null;
      let example = exOf(w);
      if (dataMap.has(k)) {
        const r = dataMap.get(k);
        if (typeof r[5] === "number") freq = r[5];
        if (!example && typeof r[4] === "string") example = exOf({ example: r[4] });
      }
      out.push({ term: w.term, phonetic: w.phonetic || "", pos: w.pos || "", meaning: w.meaning || "", example, freq, tier: "" });
    };
    bankWords(level).forEach(push);
    dataRows.forEach((row) => push({ term: row[0], phonetic: row[1], pos: row[2], meaning: row[3], example: row[4], freq: row[5] }));

    const vals = out.map((w) => w.freq).filter((v) => typeof v === "number").sort((a, b) => b - a);
    if (vals.length >= 30) {
      const hiCut = vals[Math.floor(vals.length * 0.3)];
      const loCut = vals[Math.floor(vals.length * 0.7)];
      out.forEach((w) => {
        if (typeof w.freq !== "number") { w.tier = ""; return; }
        w.tier = w.freq >= hiCut ? "high" : w.freq >= loCut ? "mid" : "low";
      });
    }

    out.sort((a, b) => a.term.localeCompare(b.term, "en"));
    bankCache.set(level, out);
    return out;
  }

  const BANK_BOOKS = ["CET-4", "CET-6", "考研核心", "面试口语"];
  const FREQ_LABEL = { high: "高频", mid: "中频", low: "低频" };

  function freqTier(w) {
    return w && w.tier ? w.tier : "";
  }
  function freqBadge(w) {
    const t = freqTier(w);
    return t ? `<span class="bi-freq ${t}">${FREQ_LABEL[t]}</span>` : "";
  }

  function libSet() {
    const s = new Set();
    state.words.forEach((w) => s.add(w.term.toLowerCase()));
    return s;
  }

  function inLibrary(term) {
    const k = String(term).toLowerCase();
    return state.words.some((w) => w.term.toLowerCase() === k);
  }

  function bankEntry(level, term) {
    const k = String(term).toLowerCase();
    return allBankWords(level).find((w) => w.term.toLowerCase() === k);
  }

  function bankStats(level, set) {
    const words = allBankWords(level);
    const ls = set || libSet();
    const inLib = words.filter((w) => ls.has(w.term.toLowerCase())).length;
    return { total: words.length, inLib };
  }

  /* 从词表加入一个词（保留音标/例句；自动归入级别与标签） */
  function addBankWord(level, term) {
    const e = bankEntry(level, term);
    if (!e) return false;
    if (inLibrary(term)) { toast(`「${e.term}」已在生词本里`, "err"); return false; }
    state.words.unshift(sanitizeWord({
      id: uid(), term: e.term, phonetic: e.phonetic, pos: e.pos,
      meaning: e.meaning, example: e.example,
      level, tags: [level], createdAt: Date.now(), nextReview: Date.now(),
    }));
    return true;
  }

  function addBankWordAndRefresh(level, term) {
    if (!addBankWord(level, term)) return;
    state.settings.seeded = true;
    saveNow();
    render();
    toast(`已加入生词本：${term}`);
  }

  function addBankBulk(level, terms) {
    let added = 0;
    terms.forEach((t) => { if (addBankWord(level, t)) added += 1; });
    if (!added) { toast("这些词都已经在生词本里了", "err"); return; }
    state.settings.seeded = true;
    saveNow();
    render();
    toast(`已加入 ${added} 个词`);
  }

  /* ==========================================================
     10b. 词书（考纲词表 · 快速加词）
     ========================================================== */
  function bankFiltered() {
    const b = ui.bank;
    const q = b.q.trim().toLowerCase();
    const freq = b.freq || "all";
    const sort = b.sort || "alpha";
    const list = allBankWords(b.book).filter((w) => {
      if (b.letter !== "全部" && w.term[0].toUpperCase() !== b.letter) return false;
      if (freq !== "all" && freqTier(w) !== freq) return false;
      if (b.onlyNew && inLibrary(w.term)) return false;
      if (!q) return true;
      return w.term.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q);
    });
    if (sort === "freq") {
      return list.sort((x, y) => (y.freq === null ? -1 : x.freq === null ? 1 : y.freq - x.freq) || x.term.localeCompare(y.term, "en"));
    }
    return list;
  }

  /* ==========================================================
     听力推荐：跳转到 B 站 / 公开听力资源
     ========================================================== */
  const LISTEN_LINKS = [
    {
      cat: "CET-4 / CET-6",
      desc: "四六级听力真题、技巧训练",
      items: [
        { title: "B站搜索：四级听力真题", url: "https://search.bilibili.com/all?keyword=%E5%9B%9B%E7%BA%A7%E5%90%AC%E5%8A%9B%E7%9C%9F%E9%A2%98", tag: "真题" },
        { title: "B站搜索：六级听力真题", url: "https://search.bilibili.com/all?keyword=%E5%85%AD%E7%BA%A7%E5%90%AC%E5%8A%9B%E7%9C%9F%E9%A2%98", tag: "真题" },
        { title: "B站搜索：四六级听力技巧", url: "https://search.bilibili.com/all?keyword=%E5%9B%9B%E5%85%AD%E7%BA%A7%E5%90%AC%E5%8A%9B%E6%8A%80%E5%B7%A7", tag: "技巧" },
      ],
    },
    {
      cat: "考研英语",
      desc: "考研复试听力、口语面试",
      items: [
        { title: "B站搜索：考研英语听力", url: "https://search.bilibili.com/all?keyword=%E8%80%83%E7%A0%94%E8%8B%B1%E8%AF%AD%E5%90%AC%E5%8A%9B", tag: "听力" },
        { title: "B站搜索：考研复试英语面试", url: "https://search.bilibili.com/all?keyword=%E8%80%83%E7%A0%94%E5%A4%8D%E8%AF%95%E8%8B%B1%E8%AF%AD%E9%9D%A2%E8%AF%95", tag: "面试" },
        { title: "B站搜索：保研面试英语自我介绍", url: "https://search.bilibili.com/all?keyword=%E4%BF%9D%E7%A0%94%E9%9D%A2%E8%AF%95%E8%8B%B1%E8%AF%AD%E8%87%AA%E6%88%91%E4%BB%8B%E7%BB%8D", tag: "自我介绍" },
      ],
    },
    {
      cat: "口语面试",
      desc: "求职英语面试、日常口语",
      items: [
        { title: "B站搜索：英语面试常见问题", url: "https://search.bilibili.com/all?keyword=%E8%8B%B1%E8%AF%AD%E9%9D%A2%E8%AF%95%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98", tag: "面试" },
        { title: "B站搜索：英语口语跟读训练", url: "https://search.bilibili.com/all?keyword=%E8%8B%B1%E8%AF%AD%E5%8F%A3%E8%AF%AD%E8%B7%9F%E8%AF%BB%E8%AE%AD%E7%BB%83", tag: "跟读" },
        { title: "B站搜索：商务英语对话", url: "https://search.bilibili.com/all?keyword=%E5%95%86%E5%8A%A1%E8%8B%B1%E8%AF%AD%E5%AF%B9%E8%AF%9D", tag: "商务" },
      ],
    },
    {
      cat: "常速外刊",
      desc: "BBC / VOA / 常速新闻，适合精听",
      items: [
        { title: "BBC Learning English（官网）", url: "https://www.bbc.co.uk/learningenglish", tag: "BBC" },
        { title: "VOA Learning English（官网）", url: "https://learningenglish.voanews.com/", tag: "VOA" },
        { title: "TED Talks（官网）", url: "https://www.ted.com/talks?language=zh-cn", tag: "TED" },
      ],
    },
  ];

  function listenView() {
    const groups = LISTEN_LINKS.map((g) => `
      <section class="panel">
        <div class="panel-head">
          <h3>${esc(g.cat)}</h3>
          <span class="hint" style="margin:0">${esc(g.desc)}</span>
        </div>
        <div class="book-row">
          ${g.items.map((it) => `
            <a class="book-chip listen-card" href="${escAttr(it.url)}" target="_blank" rel="noopener noreferrer">
              <b>${esc(it.title)}</b>
              <em>${esc(it.tag)} ↗</em>
            </a>`).join("")}
        </div>
      </section>`).join("");

    return `
    <div class="page-head">
      <div>
        <h1>听力训练</h1>
        <p class="sub">精选 B 站与公开英语听力资源，点开直接听。</p>
      </div>
    </div>

    <section class="daily-quote" style="margin-bottom:14px">
      <div class="dq-text">“Listening is more important than speaking when learning a language.”</div>
      <div class="dq-zh">学语言时，听比说更重要。每天 15 分钟精听，胜过一周一次泛听。</div>
      <div class="dq-by">练习建议：第一遍盲听 → 第二遍看原文 → 第三遍跟读影子练习</div>
    </section>

    ${groups}

    <section class="panel">
      <div class="panel-head"><h3>怎么练最有效</h3></div>
      <div class="due-list">
        <div class="due-item"><span class="w" style="font-family:var(--font-sans);font-size:13.5px">1 · 精听</span><span class="m">一句一句暂停，把每个词写下来，再对照原文</span></div>
        <div class="due-item"><span class="w" style="font-family:var(--font-sans);font-size:13.5px">2 · 跟读</span><span class="m">听完一句模仿语音语调，影子跟读（shadowing）</span></div>
        <div class="due-item"><span class="w" style="font-family:var(--font-sans);font-size:13.5px">3 · 结合生词</span><span class="m">听到不会的词直接回到「词库 → 添加」收进来</span></div>
      </div>
    </section>`;
  }

  function bankView() {
    const b = ui.bank;
    const ls = libSet();
    const all = allBankWords(b.book);
    const stats = bankStats(b.book, ls);
    const list = bankFiltered();
    const letters = ["全部", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];
    const present = new Set(all.map((w) => w.term[0].toUpperCase()));
    const shown = list.slice(0, 400);
    const pct = stats.total ? Math.round((stats.inLib / stats.total) * 100) : 0;

    const bookChips = BANK_BOOKS.map((lv) => {
      const st = bankStats(lv, ls);
      return `<button class="book-chip ${b.book === lv ? "is-active" : ""}" data-action="bank-book" data-book="${lv}">
        <b>${lv}</b><span>考纲词汇 ${st.total} 词</span><em>已加 ${st.inLib}</em>
      </button>`;
    }).join("");

    const rows = shown.map((w) => {
      const added = ls.has(w.term.toLowerCase());
      return `<button class="bank-item ${added ? "is-added" : ""}" data-action="bank-add" data-term="${escAttr(w.term)}" data-book="${b.book}" title="${added ? "已在生词本" : "点击加入生词本"}">
        <span class="bi-main">
          <span class="bi-term">${esc(w.term)}</span>
          <span class="bi-phon">${esc(w.phonetic)}</span>
          <span class="bi-pos">${esc(w.pos)}</span>
          ${freqBadge(w)}
          <span class="bi-meaning">${esc(w.meaning)}</span>
        </span>
        <span class="bi-act">${added ? "✓ 已加入" : "＋ 加入"}</span>
      </button>`;
    }).join("");

    const freqCount = { high: 0, mid: 0, low: 0 };
    all.forEach((w) => { const t = freqTier(w); if (t) freqCount[t] += 1; });
    const freqChips = [["all", "全部词频"], ["high", "高频"], ["mid", "中频"], ["low", "低频"]]
      .map(([k, label]) => `<button class="chip ${b.freq === k ? "is-active" : ""}" data-action="bank-freq" data-freq="${k}">${label}<span class="n">${k === "all" ? all.length : freqCount[k]}</span></button>`)
      .join("");

    return `
    <div class="page-head">
      <div>
        <p class="eyebrow">Wordbook</p>
        <h1>考纲词表</h1>
        <p class="sub">4/6 级考纲词汇全表，带词频分层：先啃高频，生僻词可以跳过。</p>
      </div>
      <button class="btn" data-action="go-add">手动添加</button>
    </div>

    <div class="book-row">${bookChips}</div>

    <section class="panel bank-progress">
      <div class="bp-top">
        <span>已加入 <b>${stats.inLib}</b> / ${stats.total} 个 ${b.book} 词</span>
        <span class="hint" style="margin:0">${pct}%</span>
      </div>
      <div class="progress"><i style="width:${Math.max(2, pct)}%"></i></div>
    </section>

    <div class="toolbar">
      <label class="search">
        ${ICO.search}
        <input id="bankSearch" type="search" placeholder="搜索单词或释义，例如 abandon / 放弃" value="${escAttr(b.q)}" autocomplete="off" />
        ${b.q ? `<button class="clear" type="button" data-action="bank-clear-q" aria-label="清空">✕</button>` : ""}
      </label>
      <button class="btn btn-sm ${b.onlyNew ? "btn-soft" : "btn-ghost"}" data-action="bank-toggle-new">${b.onlyNew ? "只看未加入 ✓" : "只看未加入"}</button>
      <button class="btn btn-sm ${b.sort === "freq" ? "btn-soft" : "btn-ghost"}" data-action="bank-sort">${b.sort === "freq" ? "按词频 ↓" : "按字母"}</button>
      <button class="btn btn-primary btn-sm" data-action="bank-add-all" ${list.length ? "" : "disabled"}>加入当前 ${list.length} 个</button>
    </div>

    <div class="tag-row">${freqChips}</div>

    <div class="letter-row">
      ${letters.map((L) => {
        const disabled = L !== "全部" && !present.has(L);
        return `<button class="letter ${b.letter === L ? "is-active" : ""}" data-action="bank-letter" data-letter="${L}" ${disabled ? "disabled" : ""}>${L}</button>`;
      }).join("")}
    </div>

    ${list.length ? `<div class="bank-list-view">${rows}</div>` : `<div class="empty">
        <div class="e-ico">🔍</div>
        <h3>没有匹配的词</h3>
        <p>换个关键词，或点「全部」字母重新看。</p>
        <button class="btn" data-action="bank-reset">重置筛选</button>
      </div>`}

    <p class="hint" style="text-align:center;margin-top:16px">
      ${list.length !== all.length ? `筛选出 ${list.length} / ${all.length} 个词` : "点任意一行即可加入生词本；已加入的词不会重复添加"}
      ${list.length > 400 ? "（只显示前 400 条，用搜索或字母缩小范围）" : ""}
    </p>`;
  }

  function wireBank() {
    const input = $("#bankSearch");
    if (input) {
      let t = null;
      input.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          ui.bank.q = input.value;
          render();
          const s2 = $("#bankSearch");
          if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
        }, 200);
      });
    }
  }

  /* 兼容旧入口：把整本书加入生词本 */
  function importBank(level) {
    const words = allBankWords(level);
    if (!words.length) { toast("这个级别还没有词表", "err"); return; }
    let added = 0;
    words.forEach((w) => { if (addBankWord(level, w.term)) added += 1; });
    state.settings.seeded = true;
    state.settings.scope = level;
    saveNow();
    render();
    toast(`已把 ${level} 词表加入生词本：新增 ${added} 个，学习范围切到 ${level}`);
  }

  function openBankDialog() {
    go("bank");
  }

  /* ==========================================================
     10c. 学习单词（逐词过词表，把不认识的收进生词本）
     ========================================================== */
  const LEARN_BOOKS = ["CET-4", "CET-6", "生词本"];
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  let learnRangeCache = { key: "", words: [] };

  function learnBookWords(book) {
    if (book === "生词本") {
      return state.words.map((w) => ({ term: w.term, phonetic: w.phonetic, pos: w.pos, meaning: w.meaning, example: w.example }));
    }
    return allBankWords(book);
  }

  function learnKey(term) {
    return state.learn.book + "::" + String(term).toLowerCase();
  }

  function learnAllInRange() {
    const L = state.learn;
    const key = L.book + "|" + L.from + L.to + "|" + (L.book === "生词本" ? state.words.length : 0);
    if (learnRangeCache.key === key) return learnRangeCache.words;
    const a = L.from.charCodeAt(0);
    const b = L.to.charCodeAt(0);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const words = learnBookWords(L.book).filter((w) => {
      const c = String(w.term || " ")[0].toUpperCase().charCodeAt(0);
      return c >= lo && c <= hi;
    });
    learnRangeCache = { key, words };
    return words;
  }

  function learnRemaining() {
    return learnAllInRange().filter((w) => !state.learn.seen[learnKey(w.term)]);
  }

  function learnProgress() {
    const all = learnAllInRange();
    const remain = learnRemaining();
    return { total: all.length, seen: all.length - remain.length, remain: remain.length };
  }

  /* ---------- 入口 ---------- */
  function learnView() {
    const s = ui.learn;
    if (s && s.done) return learnDoneView();
    if (s) return learnSessionView();
    return learnConfigView();
  }

  /* ---------- 范围设置 ---------- */
  function learnConfigView() {
    const L = state.learn;
    const p = learnProgress();
    const willStudy = Math.min(L.size, p.remain);
    const bookTotal = learnBookWords(L.book).length;
    const pct = p.total ? Math.round((p.seen / p.total) * 100) : 0;

    const bookOpts = LEARN_BOOKS.map((b) => {
      const n = b === "生词本" ? state.words.length : allBankWords(b).length;
      return `<option value="${escAttr(b)}" ${L.book === b ? "selected" : ""}>${esc(b)}（${n} 词）</option>`;
    }).join("");

    const letterOpts = (sel) =>
      LETTERS.map((c) => `<option value="${c}" ${sel === c ? "selected" : ""}>${c}</option>`).join("");

    const sizeOpts = [10, 20, 30, 50, 100]
      .map((n) => `<option value="${n}" ${L.size === n ? "selected" : ""}>${n} 个</option>`).join("");

    return `
    <div class="page-head">
      <div>
        <p class="eyebrow">Learn</p>
        <h1>学习单词</h1>
        <p class="sub">从考纲词书里逐词过一遍：认识的跳过，不认识的当场收进生词本，之后在「复习」里用间隔重复单独记。</p>
      </div>
      <button class="btn" data-action="go-library">打开生词本</button>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h3>学习范围</h3>
        <span class="hint" style="margin:0">${esc(L.book)} 共 ${bookTotal} 词</span>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>词书</span>
          <select id="learnBook">${bookOpts}</select>
        </label>
        <label class="field">
          <span>顺序</span>
          <select id="learnOrder">
            <option value="seq" ${L.order === "seq" ? "selected" : ""}>按字母顺序</option>
            <option value="freq" ${L.order === "freq" ? "selected" : ""}>按词频（高频优先）</option>
            <option value="random" ${L.order === "random" ? "selected" : ""}>随机顺序</option>
          </select>
        </label>
        <label class="field">
          <span>字母范围</span>
          <div class="letter-range">
            <select id="learnFrom" aria-label="起始字母">${letterOpts(L.from)}</select>
            <span>—</span>
            <select id="learnTo" aria-label="结束字母">${letterOpts(L.to)}</select>
          </div>
        </label>
        <label class="field">
          <span>每组词数</span>
          <select id="learnSize">${sizeOpts}</select>
        </label>
      </div>

      <div class="learn-summary">
        <span>范围内 <b>${p.total}</b> 词</span>
        <span>已学 <b>${p.seen}</b></span>
        <span>剩余 <b>${p.remain}</b></span>
        <span class="spacer"></span>
        <button class="link-btn" data-action="learn-reset">重置本词书进度</button>
      </div>
      ${L.book === "生词本"
        ? `<p class="hint" style="background:var(--sky-soft);color:var(--sky);padding:9px 12px;border-radius:10px;margin:0 0 12px">💡 从生词本抽查：只做快速筛查，判「不认识」只会把它提前排进复习，不改动 SM-2 的间隔与记忆强度。</p>`
        : ""}
      <div class="progress" style="margin-bottom:18px"><i style="width:${Math.max(2, pct)}%"></i></div>

      <button class="btn btn-primary btn-lg btn-block" data-action="learn-start" ${p.remain ? "" : "disabled"}>
        ${p.remain ? `开始学习 ${willStudy} 个词` : "这个范围已经学完了"}
      </button>
      <p class="hint" style="text-align:center;margin-top:10px">
        ${p.remain
          ? "学习中点「不认识」的词会自动加入生词本；点错了可以随时撤销。"
          : "可以换个字母范围，或点上面的「重置本词书进度」重新过一遍。"}
      </p>
    </section>

    <section class="panel" style="margin-top:14px">
      <div class="panel-head"><h3>学习是怎么走的</h3></div>
      <div class="due-list">
        <div class="due-item"><span class="w" style="font-family:var(--font-sans);font-size:13.5px">1 · 选范围</span><span class="m">词书、字母区间、每组词数，随时可调</span></div>
        <div class="due-item"><span class="w" style="font-family:var(--font-sans);font-size:13.5px">2 · 逐词判断</span><span class="m">「认识」跳过；「不认识」看释义并加入生词本；不确定可先看释义</span></div>
        <div class="due-item"><span class="w" style="font-family:var(--font-sans);font-size:13.5px">3 · 单独复习</span><span class="m">生词本用 SM-2 间隔重复，与学习进度互不影响</span></div>
      </div>
    </section>`;
  }

  /* ---------- 学习进行中 ---------- */
  function learnSessionView() {
    const s = ui.learn;
    const L = state.learn;
    const w = s.words[s.pos];
    if (!w) { s.done = true; return learnDoneView(); }
    const prog = Math.round((s.pos / s.words.length) * 100);
    const isLast = s.pos + 1 >= s.words.length;
    const front = s.mode === "front";
    const answered = s.mode === "unknown";

    const judgeBtns = `
      <div class="learn-actions">
        <button class="learn-btn known" data-action="learn-known"><b>✓ 认识</b><small>跳过</small></button>
        <button class="learn-btn unknown" data-action="learn-unknown"><b>✗ 不认识</b><small>加入生词本</small></button>
      </div>`;

    return `
    <div class="review-shell">
      <div class="review-top">
        <button class="btn btn-sm btn-ghost" data-action="learn-quit">← 结束</button>
        <div class="progress"><i style="width:${prog}%"></i></div>
        <span class="review-count">${s.pos + 1} / ${s.words.length}</span>
      </div>
      <div class="flashcard">
        <div class="fc-term">${esc(w.term)}</div>
        <div class="fc-phon">${esc(w.phonetic)}</div>
        <button class="fc-speak" data-action="learn-speak">${ICO.volume} 听发音</button>
        ${front ? `
          <p class="fc-hint">认识就直接跳过；不认识就收进生词本，之后在「复习」里再见。</p>
          ${judgeBtns}
          <button class="link-btn" data-action="learn-peek" style="margin-top:14px">先看释义</button>
          <p class="hint" style="margin-top:10px">键盘：<span class="kbd">1</span> 认识 · <span class="kbd">2</span> 不认识 · <span class="kbd">Z</span> 撤销</p>
        ` : `
          <div class="fc-answer">
            ${w.pos ? `<div class="fc-pos">${esc(w.pos)}</div>` : ""}
            <div class="fc-meaning">${esc(w.meaning)}</div>
            ${exBlock(w)}
            ${answered ? `
              ${s.lastAdded ? `<div class="learn-added">✓ 已加入生词本</div>`
                : s.lastExisted ? `<div class="learn-added warn">这个词已经在生词本里了</div>` : ""}
              <button class="btn btn-primary btn-lg" style="margin-top:20px;min-width:200px" data-action="learn-next">
                ${isLast ? "完成这组" : "下一个 →"}
              </button>
              <div style="margin-top:10px"><button class="link-btn" data-action="learn-undo">↺ 点错了，撤销</button></div>
            ` : `
              ${judgeBtns}
              <p class="hint" style="margin-top:10px">键盘：<span class="kbd">1</span> 认识 · <span class="kbd">2</span> 不认识</p>
            `}
          </div>`}
      </div>
      <div class="review-foot">
        <span class="hint">已判断 ${s.known + s.unknown} 个 · 认识 ${s.known} · 不认识 ${s.unknown}</span>
        ${s.undo.length ? `<button class="link-btn" data-action="learn-undo">↺ 撤销上一步</button>` : `<span class="hint">${esc(L.book)} · ${esc(L.from)}–${esc(L.to)}</span>`}
      </div>
    </div>`;
  }

  /* ---------- 一组学完 ---------- */
  function learnDoneView() {
    const s = ui.learn;
    const L = state.learn;
    const p = learnProgress();
    const unknownList = (s.unknownWords || []).slice(0, 12).map((u) => `
      <div class="miss-item"><b>${esc(u.term)}</b><span>${esc(u.meaning)}</span>
        <span class="badge ${u.added === "added" ? "mastered" : "scheduled"}" style="margin-left:auto">${u.added === "added" ? "已加入" : "原已在"}</span>
      </div>`).join("");

    return `
    <div class="review-shell">
      <div class="done-card">
        <div class="done-ico">📚</div>
        <h2>这组学完了</h2>
        <p style="color:var(--text-3)">「认识」的词之后不会再出现；「不认识」的已经收进生词本。</p>
        <div class="done-stats">
          <div><b>${s.words.length}</b><span>学习词数</span></div>
          <div><b>${s.known}</b><span>认识</span></div>
          <div><b>${s.unknown}</b><span>不认识</span></div>
        </div>
        ${unknownList ? `<div class="miss-list">${unknownList}</div>` : ""}
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px">
          <button class="btn btn-primary" data-action="learn-start" ${p.remain ? "" : "disabled"}>
            ${p.remain ? `继续学 ${Math.min(L.size, p.remain)} 个` : "本范围已学完"}
          </button>
          <button class="btn" data-action="go-library">去生词本</button>
          <button class="btn btn-ghost" data-action="learn-back">调整范围</button>
        </div>
        <p class="hint" style="margin-top:16px">${esc(L.book)} · ${esc(L.from)}–${esc(L.to)} 范围内还剩 ${p.remain} 个词</p>
      </div>
    </div>`;
  }

  /* ---------- 行为 ---------- */
  function startLearn() {
    const L = state.learn;
    let pool = learnRemaining();
    if (!pool.length) {
      toast("这个范围里的词都学完了，换个范围或重置进度吧", "err");
      return;
    }
    pool = L.order === "random" ? shuffle(pool) : L.order === "freq"
      ? pool.slice().sort((a, b) => (b.freq || 0) - (a.freq || 0) || a.term.localeCompare(b.term, "en"))
      : pool.slice();
    ui.learn = {
      words: pool.slice(0, Math.max(1, L.size)),
      pos: 0, known: 0, unknown: 0,
      mode: "front", done: false,
      lastAdded: false, lastExisted: false,
      undo: [], unknownWords: [], exZhMap: {},
    };
    if (ui.tab !== "learn") go("learn");
    else render();
  }

  function learnAnswer(known) {
    const s = ui.learn;
    if (!s || s.done || s.mode === "unknown") return;
    const w = s.words[s.pos];
    if (!w) return;
    const L = state.learn;
    const key = learnKey(w.term);
    const prev = L.seen[key] || 0;
    L.seen[key] = Date.now();
    s.lastAdded = false;
    s.lastExisted = false;
    const rec = { key, prev, known, pos: s.pos, term: w.term };
    s.undo.push(rec);

    if (known) {
      s.known += 1;
      learnAdvance();
      return;
    }

    s.unknown += 1;
    if (L.book === "生词本") {
      // 本就在生词本里：直接把它拉回待复习队列
      const real = state.words.find((x) => x.term.toLowerCase() === w.term.toLowerCase());
      if (real) {
        real.nextReview = Date.now();
        real.ease = Math.max(1.3, (real.ease || 2.5) - 0.08);
      }
      s.lastExisted = true;
      rec.added = "existing";
    } else if (inLibrary(w.term)) {
      s.lastExisted = true;
      rec.added = "existing";
    } else if (addBankWord(L.book, w.term)) {
      s.lastAdded = true;
      rec.added = "added";
    } else {
      // 兜底：词书里查不到（例如以后新增词书）也照样收进生词本，avoid silent failure
      state.words.unshift(sanitizeWord({
        id: uid(), term: w.term, phonetic: w.phonetic || "", pos: w.pos || "",
        meaning: w.meaning, example: exOf(w),
        level: L.book, tags: [L.book],
        createdAt: Date.now(), nextReview: Date.now(),
      }));
      s.lastAdded = true;
      rec.added = "added";
    }
    s.unknownWords.push({ term: w.term, meaning: w.meaning, added: rec.added || "" });
    s.mode = "unknown";
    saveNow();
    render();
  }

  function learnAdvance() {
    const s = ui.learn;
    if (!s) return;
    s.pos += 1;
    s.mode = "front";
    s.lastAdded = false;
    s.lastExisted = false;
    if (s.pos >= s.words.length) s.done = true;
    saveNow();
    render();
  }

  function learnPeek() {
    const s = ui.learn;
    if (!s || s.mode !== "front") return;
    s.mode = "peek";
    render();
    const w = s.words[s.pos];
    if (w) speak(w.term);
  }

  function learnUndoLast() {
    const s = ui.learn;
    if (!s || !s.undo || !s.undo.length) return;
    const rec = s.undo.pop();
    const L = state.learn;
    if (rec.prev) L.seen[rec.key] = rec.prev;
    else delete L.seen[rec.key];
    if (rec.known) s.known = Math.max(0, s.known - 1);
    else {
      s.unknown = Math.max(0, s.unknown - 1);
      const last = s.unknownWords[s.unknownWords.length - 1];
      if (last && last.term === rec.term) s.unknownWords.pop();
    }
    s.pos = rec.pos;
    s.mode = "front";
    s.done = false;
    s.lastAdded = false;
    s.lastExisted = false;
    saveNow();
    render();
    toast(rec.added === "added" ? "已撤销判定；这个词已加进生词本，可在词库删除" : "已撤销上一步");
  }

  function resetLearnProgress() {
    const L = state.learn;
    if (!window.confirm(`清空「${L.book}」的学习记录？已加入生词本的词不受影响。`)) return;
    const prefix = L.book + "::";
    Object.keys(L.seen).forEach((k) => { if (k.indexOf(prefix) === 0) delete L.seen[k]; });
    learnRangeCache = { key: "", words: [] };
    ui.learn = null;
    saveNow();
    render();
    toast(`「${L.book}」学习进度已重置`);
  }

  function wireLearn() {
    const bind = (id, key, cast) => {
      const el = $("#" + id);
      if (!el) return;
      el.addEventListener("change", () => {
        state.learn[key] = cast ? cast(el.value) : el.value;
        learnRangeCache = { key: "", words: [] };
        ui.learn = null;
        saveNow();
        render();
      });
    };
    bind("learnBook", "book");
    bind("learnOrder", "order");
    bind("learnFrom", "from");
    bind("learnTo", "to");
    bind("learnSize", "size", (v) => clampInt(v, 5, 100, 20));
  }

  function learnKeyHandler(e) {
    if (ui.tab !== "learn" || !ui.learn || ui.learn.done) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const s = ui.learn;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      learnUndoLast();
      return;
    }
    if (e.key.toLowerCase() === "z" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      learnUndoLast();
      return;
    }
    if (s.mode === "unknown") {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); learnAdvance(); }
      return;
    }
    if (s.mode === "peek") {
      if (e.key === "1" || e.key === "ArrowLeft") { e.preventDefault(); learnAnswer(true); }
      else if (e.key === "2" || e.key === "ArrowRight") { e.preventDefault(); learnAnswer(false); }
      return;
    }
    if (e.key === "1" || e.key === "ArrowLeft") { e.preventDefault(); learnAnswer(true); }
    else if (e.key === "2" || e.key === "ArrowRight") { e.preventDefault(); learnAnswer(false); }
    else if (e.key === " ") { e.preventDefault(); learnPeek(); }
  }

  /* ==========================================================
     6. 图标
     ========================================================== */
  const ICO = {
    search: `<svg class="s-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
    volume: `<svg viewBox="0 0 24 24"><path d="M4 9v6h3.5L13 20V4L7.5 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>`,
    edit: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>`,
  };

  function badge(status) {
    return `<span class="badge ${status}">${statusLabel(status)}</span>`;
  }
  function posBadge(pos) {
    return pos ? `<span class="badge pos">${esc(pos)}</span>` : "";
  }
  function tagBadges(tags, level) {
    return (tags || [])
      .filter((t) => t !== level)
      .map((t) => `<span class="badge tag">${esc(t)}</span>`).join("");
  }
  function masteryPct(w) {
    if (!w.totalReviews) return 0;
    const acc = w.totalReviews ? w.correct / w.totalReviews : 0;
    return Math.round(clampNum((w.interval >= 21 ? 1 : Math.min(w.interval / 21, 1)) * 0.7 + acc * 0.3, 0, 1) * 100);
  }
  function fmtInterval(days) {
    if (!days) return "—";
    if (days < 0.05) return "10 分钟";
    if (days < 1) return `${Math.round(days * 24 * 60)} 分钟`;
    if (days < 1.5) return "1 天";
    return `${Math.round(days)} 天`;
  }

  /* ==========================================================
     7. 渲染入口 / 路由
     ========================================================== */
  const TABS = ["home", "add", "library", "bank", "listen", "learn", "review", "quiz", "settings"];
  const ui = {
    tab: "home",
    filters: { q: "", tag: "", level: "", status: "all", sort: "newest", view: "list" },
    openId: null,
    review: null,
    quiz: null,
    importRows: [],
    importMeta: null,
    selectMode: false,
    selected: new Set(),
    bank: { book: "CET-4", q: "", letter: "全部", onlyNew: false, freq: "all", sort: "alpha" },
    learn: null,
  };

  function render() {
    const view = $("#view");
    const prevScroll = window.scrollY;
    let html = "";
    switch (ui.tab) {
      case "home": html = homeView(); break;
      case "add": html = addView(); break;
      case "library": html = libraryView(); break;
      case "bank": html = bankView(); break;
      case "listen": html = listenView(); break;
      case "learn": html = learnView(); break;
      case "review": html = reviewView(); break;
      case "quiz": html = quizView(); break;
      default: html = homeView();
    }
    view.innerHTML = html;
    view.classList.remove("view"); void view.offsetWidth; view.classList.add("view");
    $$(".nav-item").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === ui.tab));
    if (ui.tab === "home") window.scrollTo(0, 0);
    else window.scrollTo(0, Math.min(prevScroll, 120));
    if (ui.tab === "add") wireAddPage();
    if (ui.tab === "library") wireLibrary();
    if (ui.tab === "bank") wireBank();
    if (ui.tab === "learn") wireLearn();
    if (ui.tab === "review") wireReview();
    if (ui.tab === "quiz") wireQuiz();
    wireScopeSelects();
  }

  function go(tab, opts) {
    if (!TABS.includes(tab)) tab = "home";
    ui.tab = tab;
    state.lastTab = tab;
    save();
    if (tab === "library" && !(opts && opts.keepFilters)) {
      // 保持筛选条件，避免返回词库时丢失
    }
    if (tab === "learn" && ui.learn && ui.learn.done) ui.learn = null;
    if (tab !== "review") ui.review = null;
    location.hash = tab === "home" ? "" : "#" + tab;
    render();
    $("#view").focus({ preventScroll: true });
  }

  /* ==========================================================
     8. 首页
     ========================================================== */
  function homeView() {
    const s = computeStats();
    const series = activitySeries(14);
    const max = Math.max(1, ...series.map((x) => x.reviews));
    const todayLabel = fmtDate(Date.now());
    const dueQueue = dueWords();
    const fresh = newWords();

    const heroTitle = s.total === 0
      ? "从记录第一个生词开始"
      : s.due === 0 && s.todayReviews > 0
        ? "今天的任务已经清空，做得好。"
        : s.due > 0
          ? `今天有 ${s.due} 个词等你复习`
          : s.newCount > 0
            ? `今天没有到期的词，有 ${s.newCount} 个新词可以学。`
            : "今天没有到期的词，不如再添几个新词。";

    const heroSub = s.total === 0
      ? "把阅读、听力里遇到的生词收进来，VocabFlow 会用间隔重复帮你记住它们。"
      : s.scope === "全部"
        ? `词库共 <b>${s.total}</b> 个词 · 已掌握 <b>${s.mastered}</b> 个 · 今天已复习 <b>${s.todayReviews}</b> 次`
        : `当前只学 <b>${esc(s.scope)}</b> · <b>${s.scoped}</b> 个词（全库 ${s.total}）· 已掌握 <b>${s.mastered}</b> 个 · 今天已复习 <b>${s.todayReviews}</b> 次`;

    const primaryAction = s.due > 0
      ? `<button class="btn btn-lg" data-action="start-review">开始复习 →</button>`
      : `<button class="btn btn-lg" data-action="go-add">添加生词 +</button>`;
    const secondary = s.newCount > 0
      ? `<button class="btn btn-ghost-light btn-lg" data-action="start-review">学 ${Math.min(s.newCount, state.settings.newLimit)} 个新词</button>`
      : `<button class="btn btn-ghost-light btn-lg" data-action="go-quiz">来一轮测验</button>`;

    const chart = series.map((x) => {
      const h = x.reviews ? Math.max(8, Math.round((x.reviews / max) * 100)) : 3;
      return `<div class="chart-col ${x.reviews ? "has-data" : ""}" title="${fmtShort(x.ts)}：${x.reviews} 次">
        <span class="chart-tip">${fmtShort(x.ts)} · ${x.reviews} 次</span>
        <div class="chart-bar" style="height:${h}%"></div>
      </div>`;
    }).join("");

    const dueItems = dueQueue.slice(0, 5).map((w) => `
      <div class="due-item">
        <span class="w">${esc(w.term)}</span>
        <span class="m">${esc(w.meaning)}</span>
      </div>`).join("") || `<div class="empty-mini">暂无到期单词 —— 保持得很好 👏</div>`;

    return `
    <section class="hero">
      <div class="hero-body">
        <p class="eyebrow" style="color:rgba(255,255,255,.62)">${todayLabel} · 今日任务${s.scope === "全部" ? "" : " · " + esc(s.scope)}</p>
        <h2>${heroTitle}</h2>
        <p>${heroSub}</p>
        <div class="hero-actions">${primaryAction}${secondary}</div>
      </div>
    </section>

    <section class="daily-quote">
      <div class="dq-text">“${esc(dailyQuote().en)}”</div>
      <div class="dq-zh">${esc(dailyQuote().zh)}</div>
      <div class="dq-by">— ${esc(dailyQuote().by)}</div>
      <button class="dq-speak" data-action="speak-text" data-en="${escAttr(dailyQuote().en)}" title="朗读">🔊</button>
    </section>

    <section class="scope-card">
      <div class="scope-left">
        <span class="scope-icon">◎</span>
        <div>
          <div class="scope-title">学习范围</div>
          <div class="scope-desc">${s.scope === "全部"
            ? `复习和测验会用到全部 <b>${s.total}</b> 个词`
            : `只练 <b>${esc(s.scope)}</b> 的 <b>${s.scoped}</b> 个词（共 ${s.total} 个）`}</div>
        </div>
      </div>
      <div class="scope-right">
        ${scopeSelectHtml("homeScope")}
        <button class="btn btn-sm scope-bank-btn" data-action="open-bank">考纲词表</button>
      </div>
    </section>

    <section class="stats">
      <div class="stat"><div class="stat-top"><i class="stat-dot"></i>词库总量</div><div class="stat-num">${s.total}</div><div class="stat-foot">个单词 / 词组</div></div>
      <div class="stat"><div class="stat-top"><i class="stat-dot"></i>待复习</div><div class="stat-num">${s.due}<small>/ ${s.todayReviews} 已做</small></div><div class="stat-foot">${dueQueue.length ? "最早 " + relativeDay(dueQueue[0].nextReview) : "全部完成"}</div></div>
      <div class="stat"><div class="stat-top"><i class="stat-dot"></i>已掌握</div><div class="stat-num">${s.mastered}<small>/ ${s.scoped}</small></div><div class="stat-foot">间隔 ≥ 21 天</div></div>
      <div class="stat"><div class="stat-top"><i class="stat-dot"></i>连续天数</div><div class="stat-num">${s.streak}<small>天</small></div><div class="stat-foot">正确率 ${s.accuracy}%</div></div>
    </section>

    <div class="home-grid">
      <section class="panel">
        <div class="panel-head">
          <h3>最近 14 天复习量</h3>
          <span class="hint" style="margin:0">共 ${series.reduce((a, b) => a + b.reviews, 0)} 次</span>
        </div>
        <div class="chart">${chart}</div>
        <div class="chart-x"><span>${fmtShort(series[0].ts)}</span><span>今天</span></div>
        ${series.every((x) => !x.reviews) ? `<p class="hint" style="margin:12px 0 0">还没有复习记录。完成第一轮复习后，这里会显示每天的记忆量。</p>` : ""}
        <div class="stats" style="margin:18px 0 0;grid-template-columns:repeat(3,1fr);gap:9px">
          <div class="stat" style="padding:12px 13px;box-shadow:none;background:var(--surface-2);border-color:transparent"><div class="stat-top">新词</div><div class="stat-num" style="font-size:22px">${s.newCount}</div></div>
          <div class="stat" style="padding:12px 13px;box-shadow:none;background:var(--surface-2);border-color:transparent"><div class="stat-top">学习中</div><div class="stat-num" style="font-size:22px">${s.learning}</div></div>
          <div class="stat" style="padding:12px 13px;box-shadow:none;background:var(--surface-2);border-color:transparent"><div class="stat-top">今天复习</div><div class="stat-num" style="font-size:22px">${s.todayReviews}</div></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h3>接下来复习</h3>
          <button class="link-btn" data-action="go-library">全部词库 →</button>
        </div>
        <div class="due-list">${dueItems}</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
          <button class="btn btn-soft btn-block" data-action="go-add">＋ 添加生词</button>
          <button class="btn btn-soft btn-block" data-action="go-learn">▷ 学习单词</button>
          <button class="btn btn-block" data-action="start-quiz">✎ 开始测验</button>
        </div>
      </section>
    </div>
    ${s.total === 0 ? "" : `<p class="hint" style="text-align:center;margin-top:18px">小提示：一切数据只保存在这台设备的浏览器里，建议每周在「词库 → 导出」备份一次。</p>`}`;
  }

  /* ==========================================================
     9. 添加生词页
     ========================================================== */
  function addView() {
    return `
    <div class="page-head">
      <div>
        <p class="eyebrow">Capture</p>
        <h1>添加生词</h1>
        <p class="sub">手动录入一个，或者直接把笔记里的词贴进来批量添加。</p>
      </div>
      <button class="btn" data-action="go-library">查看词库</button>
    </div>

    <div class="add-grid">
      <section class="panel add-form">
        <div class="panel-head"><h3>单个添加</h3><span class="hint" style="margin:0"><span class="kbd">Ctrl</span> + <span class="kbd">Enter</span> 保存</span></div>
        <form id="addForm" novalidate>
          <div class="field-grid">
            <label class="field field-span">
              <span>单词 / 词组 <b class="req">*</b></span>
              <input id="fTerm" name="term" autocomplete="off" spellcheck="false" placeholder="例如：resilient" enterkeyhint="next" />
              <em class="field-msg" id="msgTerm"></em>
            </label>
            <label class="field">
              <span>音标</span>
              <input id="fPhonetic" name="phonetic" autocomplete="off" placeholder="/rɪˈzɪliənt/" />
            </label>
            <label class="field">
              <span>词性</span>
              <select id="fPos" name="pos">
                <option value="">未标注</option>
                ${POS_LIST.map((p) => `<option value="${p}">${p}</option>`).join("")}
              </select>
            </label>
            <label class="field field-span">
              <span>级别 / 词书</span>
              <input id="fLevel" name="level" autocomplete="off" list="levelList" placeholder="如 CET-4 / CET-6 / 考研 / 商务（留空表示不限定）" />
            </label>
            <datalist id="levelList">${LEVELS.map((l) => `<option value="${escAttr(l)}"></option>`).join("")}</datalist>
            <label class="field field-span">
              <span>释义 <b class="req">*</b></span>
              <textarea id="fMeaning" name="meaning" rows="2" placeholder="有韧性的；能迅速恢复的"></textarea>
              <em class="field-msg" id="msgMeaning"></em>
            </label>
            <label class="field field-span">
              <span>例句</span>
              <textarea id="fExample" name="example" rows="2" placeholder="Children are often more resilient than we expect."></textarea>
            </label>
            <label class="field field-span">
              <span>标签</span>
              <input id="fTags" name="tags" autocomplete="off" placeholder="空格或逗号分隔，例如：CET-6 阅读" />
            </label>
          </div>
          <div class="add-foot">
            <button class="btn btn-ghost btn-sm" type="button" data-action="voice-input" id="voiceBtn" hidden>🎙 语音输入</button>
            <span class="spacer"></span>
            <button class="btn btn-ghost" type="button" data-action="reset-add">清空</button>
            <button class="btn btn-primary" type="submit" id="saveBtn">保存单词</button>
          </div>
        </form>
      </section>

      <div>
        <section class="panel" style="margin-bottom:14px">
          <div class="preview-label">卡片预览</div>
          <div class="preview-card" id="previewCard">
            <div class="preview-word" id="pvWord"></div>
            <div class="preview-phon" id="pvPhon"></div>
            <div class="preview-meaning" id="pvMeaning"></div>
            <div class="preview-ex" id="pvEx"></div>
            <div class="preview-tags" id="pvTags"></div>
          </div>
        </section>

        <section class="panel bulk-panel">
          <div class="panel-head">
            <h3>批量导入</h3>
            <button class="link-btn" data-action="import-file">上传文件 →</button>
          </div>
          <textarea id="bulkText" placeholder="resilient&#9;有韧性的&#10;meticulous, 一丝不苟的&#10;mitigate | 减轻；缓和&#10;revenue n. 收入；营业额"></textarea>
          <div class="bulk-actions">
            <span class="count" id="bulkCount">每行一个词</span>
            <button class="btn btn-sm btn-ghost" data-action="load-sample-bulk">填入示例</button>
            <button class="btn btn-primary btn-sm" data-action="parse-bulk">解析预览</button>
          </div>
          <div class="formats">
            <div><code>word&#9;释义</code><span>Tab 分隔（从 Excel 复制）</span></div>
            <div><code>word, 释义</code><span>逗号分隔</span></div>
            <div><code>word | 释义</code><span>竖线分隔</span></div>
            <div><code>word n. 释义</code><span>自动识别词性与英式音标</span></div>
          </div>
        </section>
      </div>
    </div>`;
  }

  function wireAddPage() {
    const form = $("#addForm");
    if (!form) return;
    const term = $("#fTerm");

    const updatePreview = () => {
      const v = (id) => ($(id) ? $(id).value : "");
      const w = cleanStr(v("#fTerm"), 80);
      $("#pvWord").textContent = w;
      $("#pvPhon").textContent = v("#fPhonetic");
      const pos = v("#fPos");
      $("#pvMeaning").innerHTML = (pos ? `<span class="badge pos" style="margin-right:6px">${esc(pos)}</span>` : "") + esc(v("#fMeaning"));
      $("#pvEx").textContent = v("#fExample");
      const lv = v("#fLevel");
      $("#pvTags").innerHTML = (lv ? `<span class="badge level" style="margin-right:6px">${esc(lv)}</span>` : "") + normalizeTags(v("#fTags")).map((t) => `<span class="badge tag">${esc(t)}</span>`).join("");
      $("#previewCard").classList.toggle("live", !!w);
    };
    ["#fTerm", "#fPhonetic", "#fMeaning", "#fExample", "#fTags", "#fPos", "#fLevel"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", updatePreview);
    });
    $("#fPos").addEventListener("change", updatePreview);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveFromAddForm();
    });
    form.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        saveFromAddForm();
      }
    });
    $("#bulkText").addEventListener("input", () => {
      const n = parseBulkRaw($("#bulkText").value).length;
      $("#bulkCount").textContent = n ? `识别到 ${n} 行` : "每行一个词";
    });
    term.focus({ preventScroll: true });
    updatePreview();
  }

  function saveFromAddForm() {
    const term = cleanStr($("#fTerm").value, 80);
    const meaning = cleanStr($("#fMeaning").value, 400);
    $("#msgTerm").textContent = "";
    $("#msgMeaning").textContent = "";
    let bad = false;
    if (!term) { $("#msgTerm").textContent = "请填写单词"; bad = true; }
    if (!meaning) { $("#msgMeaning").textContent = "请填写释义"; bad = true; }
    if (bad) {
      (!term ? $("#fTerm") : $("#fMeaning")).focus();
      return;
    }
    const dup = state.words.find((w) => w.term.toLowerCase() === term.toLowerCase());
    if (dup) {
      $("#msgTerm").textContent = "词库里已经有这个词了";
      $("#fTerm").focus();
      toast(`「${term}」已在词库中`, "err");
      return;
    }
    const lvEl = $("#fLevel");
    const level = cleanStr(lvEl ? lvEl.value : "", 24);
    // 新词默认归入当前学习范围，方便「只练 CET-4」时继续加词
    const autoLevel = level || (currentScope() === "全部" ? "" : currentScope());
    state.words.unshift(sanitizeWord({
      id: uid(),
      term,
      phonetic: cleanStr($("#fPhonetic").value, 80),
      pos: $("#fPos").value,
      level: autoLevel,
      meaning,
      example: cleanStr($("#fExample").value, 600),
      tags: normalizeTags($("#fTags").value),
      createdAt: Date.now(),
      nextReview: Date.now(),
    }));
    save();
    toast(`已添加「${term}」`);
    $("#addForm").reset();
    $("#msgTerm").textContent = "";
    $("#msgMeaning").textContent = "";
    $("#pvWord").textContent = "";
    $("#pvPhon").textContent = "";
    $("#pvMeaning").textContent = "";
    $("#pvEx").textContent = "";
    $("#pvTags").innerHTML = "";
    $("#previewCard").classList.remove("live");
    $("#fTerm").focus();
    // 如果这次添加的词刚好是空词库第一个，提示可以开始复习
    if (state.words.length === 1) toast("已保存。去「复习」开始第一次学习吧", "ok");
  }

  /* ==========================================================
     10. 词库
     ========================================================== */
  function filteredWords() {
    const f = ui.filters;
    const q = f.q.trim().toLowerCase();
    let list = state.words.filter((w) => {
      if (f.level && (w.level || inferLevelFromTags(w.tags)) !== f.level) return false;
      if (f.tag && !w.tags.includes(f.tag)) return false;
      if (f.status !== "all") {
        if (f.status === "new" && w.totalReviews !== 0) return false;
        if (f.status === "due" && !(w.totalReviews > 0 && isDue(w))) return false;
        if (f.status === "mastered" && w.interval < 21) return false;
        if (f.status === "learning" && !(w.totalReviews > 0 && w.interval < 21)) return false;
      }
      if (!q) return true;
      return (
        w.term.toLowerCase().includes(q) ||
        w.meaning.toLowerCase().includes(q) ||
        (w.example || "").toLowerCase().includes(q) ||
        (w.level || "").toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      alpha: (a, b) => a.term.localeCompare(b.term, "en"),
      due: (a, b) => a.nextReview - b.nextReview,
      mastery: (a, b) => masteryPct(b) - masteryPct(a),
    };
    return list.sort(sorters[f.sort] || sorters.newest);
  }

  function libraryView() {
    const tags = collectTags();
    const list = filteredWords();
    const s = computeStats();
    const f = ui.filters;
    const activeTag = f.tag || "";
    const sel = ui.selected;

    const tagChips = [
      `<button class="chip ${!activeTag ? "is-active" : ""}" data-tag="">全部<span class="n">${state.words.length}</span></button>`,
      ...tags.map(([t, n]) => `<button class="chip ${activeTag === t ? "is-active" : ""}" data-tag="${escAttr(t)}">${esc(t)}<span class="n">${n}</span></button>`),
    ].join("");

    const cards = list.map((w) => wordCard(w, ui.openId === w.id, sel.has(w.id))).join("");
    const levelOptions = allLevels().filter((l) => state.words.some((w) => (w.level || inferLevelFromTags(w.tags)) === l));

    return `
    <div class="page-head">
      <div>
        <p class="eyebrow">Library</p>
        <h1>词库</h1>
        <p class="sub">共 ${s.total} 个词 · 待复习 ${s.due} · 新词 ${s.newCount} · 已掌握 ${s.mastered}${s.scope === "全部" ? "" : " · 学习范围 " + esc(s.scope)}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-action="open-bank">词书</button>
        <button class="btn" data-action="export-menu">导出</button>
        <button class="btn btn-primary" data-action="import-file">导入</button>
      </div>
    </div>

    <div class="toolbar">
      <label class="search">
        ${ICO.search}
        <input id="libSearch" type="search" placeholder="搜索单词、释义、例句、标签或级别…" value="${escAttr(f.q)}" autocomplete="off" />
        ${f.q ? `<button class="clear" type="button" data-action="clear-search" aria-label="清空搜索">✕</button>` : ""}
      </label>
      ${levelOptions.length ? `<span class="select-wrap">
        <select id="levelFilter" aria-label="按级别筛选">
          <option value="" ${!f.level ? "selected" : ""}>全部级别</option>
          ${levelOptions.map((l) => `<option value="${escAttr(l)}" ${f.level === l ? "selected" : ""}>${esc(l)}</option>`).join("")}
        </select>
      </span>` : ""}
      <span class="select-wrap">
        <select id="statusFilter" aria-label="按状态筛选">
          <option value="all" ${f.status === "all" ? "selected" : ""}>全部状态</option>
          <option value="new" ${f.status === "new" ? "selected" : ""}>新词</option>
          <option value="due" ${f.status === "due" ? "selected" : ""}>待复习</option>
          <option value="learning" ${f.status === "learning" ? "selected" : ""}>学习中</option>
          <option value="mastered" ${f.status === "mastered" ? "selected" : ""}>已掌握</option>
        </select>
      </span>
      <span class="select-wrap">
        <select id="sortFilter" aria-label="排序">
          <option value="newest" ${f.sort === "newest" ? "selected" : ""}>最新添加</option>
          <option value="alpha" ${f.sort === "alpha" ? "selected" : ""}>字母顺序</option>
          <option value="due" ${f.sort === "due" ? "selected" : ""}>复习时间</option>
          <option value="mastery" ${f.sort === "mastery" ? "selected" : ""}>掌握程度</option>
        </select>
      </span>
      <div class="view-toggle" role="group" aria-label="切换视图">
        <button data-view="list" class="${f.view === "list" ? "is-active" : ""}" title="列表视图">☰</button>
        <button data-view="grid" class="${f.view === "grid" ? "is-active" : ""}" title="卡片视图">▦</button>
      </div>
      <button class="btn btn-sm ${ui.selectMode ? "btn-soft" : "btn-ghost"}" data-action="toggle-select">${ui.selectMode ? "退出多选" : "多选"}</button>
    </div>

    ${tags.length ? `<div class="tag-row">${tagChips}</div>` : ""}

    ${list.length
      ? `<div class="word-list ${f.view === "grid" ? "grid-view" : ""}">${cards}</div>`
      : emptyLibrary()}

    ${s.total ? `<div class="bulk-bar ${sel.size ? "show" : ""}" id="bulkBar">
      <span class="count">已选 ${sel.size} 个词</span>
      <button class="btn" data-action="bulk-tag">加标签</button>
      <button class="btn" data-action="bulk-export">导出所选</button>
      <button class="btn del" data-action="bulk-delete">删除</button>
      <button class="btn" data-action="bulk-clear">取消</button>
    </div>` : ""}

    <p class="hint" style="text-align:center;margin-top:20px">
      ${list.length !== state.words.length ? `筛选出 ${list.length} / ${state.words.length} 个词` : "点击单词展开详细信息与复习进度"}
    </p>`;
  }

  function emptyLibrary() {
    if (!state.words.length) {
      return `<div class="empty">
        <div class="e-ico">📖</div>
        <h3>词库还是空的</h3>
        <p>添加你在阅读、听力里遇到的第一个生词，或者先导入一份示例词书试试看。</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" data-action="go-add">添加生词</button>
          <button class="btn" data-action="load-sample">载入示例词书</button>
        </div>
      </div>`;
    }
    const hasFilter = ui.filters.q || ui.filters.tag || ui.filters.status !== "all";
    return `<div class="empty">
      <div class="e-ico">🔍</div>
      <h3>没有找到匹配的词</h3>
      <p>换个关键词，或者清除筛选条件再看看。</p>
      ${hasFilter ? `<button class="btn" data-action="reset-filters">清除筛选</button>` : `<button class="btn" data-action="go-add">添加生词</button>`}
    </div>`;
  }

  function wordCard(w, open, selected) {
    const st = wordStatus(w);
    const pct = masteryPct(w);
    const acc = w.totalReviews ? Math.round((w.correct / w.totalReviews) * 100) : 0;
    const lv = w.level || inferLevelFromTags(w.tags);
    const detail = open ? `
      <div class="wc-detail">
        <div>
          ${exBlock(w)}
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">${lv ? `<button class="badge level" data-action="set-scope" data-scope-value="${escAttr(lv)}" title="只学 ${escAttr(lv)}">${esc(lv)}</button>` : ""}${tagBadges(w.tags, lv)}</div>
          <div style="margin-top:14px">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-3);margin-bottom:5px"><span>掌握程度</span><span>${pct}%</span></div>
            <div class="progress ${w.interval >= 21 ? "mint" : ""}"><i style="width:${Math.max(3, pct)}%"></i></div>
          </div>
        </div>
        <div>
          <h4>复习数据</h4>
          <div class="wc-stats">
            <div class="wc-stat">下次复习<b>${relativeDay(w.nextReview)}</b></div>
            <div class="wc-stat">当前间隔<b>${fmtInterval(w.interval)}</b></div>
            <div class="wc-stat">累计复习<b>${w.totalReviews} 次</b></div>
            <div class="wc-stat">记忆正确率<b>${acc}%</b></div>
            <div class="wc-stat">添加时间<b>${fmtDate(w.createdAt)}</b></div>
            <div class="wc-stat">遗忘次数<b>${w.lapses || 0} 次</b></div>
          </div>
        </div>
        <div class="wc-detail-foot">
          <button class="btn btn-sm" data-action="speak" data-id="${w.id}">🔊 朗读</button>
          <button class="btn btn-sm" data-action="edit" data-id="${w.id}">编辑</button>
          <button class="btn btn-sm" data-action="review-one" data-id="${w.id}">立即复习</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${w.id}">删除</button>
        </div>
      </div>` : "";

    return `<article class="word-card ${open ? "is-open" : ""}" data-id="${w.id}">
      <div class="wc-main">
        ${ui.selectMode ? `<input type="checkbox" data-action="select-one" data-id="${w.id}" ${selected ? "checked" : ""} style="margin-top:6px;width:16px;height:16px;accent-color:var(--brand)" aria-label="选择 ${escAttr(w.term)}" />` : ""}
        <div class="wc-left" data-action="toggle-open" data-id="${w.id}" role="button" tabindex="0" aria-expanded="${open}">
          <div class="wc-term-row">
            <span class="wc-term">${esc(w.term)}</span>
            <span class="wc-phon">${esc(w.phonetic)}</span>
            ${lv ? `<span class="badge level">${esc(lv)}</span>` : ""}
            ${badge(st)}
          </div>
          <div class="wc-meaning">${posBadge(w.pos)} ${esc(w.meaning)}</div>
          <div class="wc-meta">${tagBadges(w.tags, lv)}${w.totalReviews ? `<span class="badge scheduled">下次 ${relativeDay(w.nextReview)}</span>` : ""}</div>
        </div>
        <div class="wc-right">
          <button class="icon-action speak" data-action="speak" data-id="${w.id}" title="朗读" aria-label="朗读 ${escAttr(w.term)}">${ICO.volume}</button>
          <button class="icon-action" data-action="edit" data-id="${w.id}" title="编辑" aria-label="编辑">${ICO.edit}</button>
          <button class="icon-action danger" data-action="delete" data-id="${w.id}" title="删除" aria-label="删除">${ICO.trash}</button>
        </div>
      </div>
      ${detail}
    </article>`;
  }

  function wireLibrary() {
    const search = $("#libSearch");
    if (search) {
      let t = null;
      search.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          ui.filters.q = search.value;
          render();
          const s2 = $("#libSearch");
          if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
        }, 220);
      });
    }
    const st = $("#statusFilter");
    if (st) st.addEventListener("change", () => { ui.filters.status = st.value; render(); });
    const lv = $("#levelFilter");
    if (lv) lv.addEventListener("change", () => { ui.filters.level = lv.value; render(); });
    const so = $("#sortFilter");
    if (so) so.addEventListener("change", () => { ui.filters.sort = so.value; render(); });
  }

  /* ==========================================================
     11. 复习（SM-2 卡片）
     ========================================================== */
  function buildQueue() {
    const cfg = state.settings;
    const due = dueWords().slice(0, Math.max(1, cfg.reviewLimit));
    const fresh = newWords().slice(0, Math.max(0, cfg.newLimit));
    const mixed = [];
    let i = 0, j = 0;
    // 交错排列：每两个复习词插入一个新词，避免连续太枯燥
    while (i < due.length || j < fresh.length) {
      if (i < due.length) mixed.push(due[i++]);
      if (i < due.length && Math.random() > 0.4) mixed.push(due[i++]);
      if (j < fresh.length) mixed.push(fresh[j++]);
    }
    return mixed;
  }

  function reviewView() {
    const r = ui.review;
    if (!r) {
      const s = computeStats();
      const queue = buildQueue();
      const newCount = newWords().length;
      const dueCount = dueWords().length;
      const preview = queue.slice(0, 8).map((w) => `<span class="badge ${wordStatus(w)}">${esc(w.term)}</span>`).join("");
      const nothing = !state.words.length;
      return `
      <div class="review-shell">
        <div class="page-head">
          <div>
            <p class="eyebrow">Review</p>
            <h1>今日复习</h1>
            <p class="sub">按遗忘曲线安排：回忆 ← 揭晓 ← 自评，四档评分自动调整下次时间。</p>
          </div>
        </div>
        <div class="scope-bar">
          <span class="scope-label">学习范围</span>
          ${scopeSelectHtml("reviewScope")}
          ${currentScope() === "全部" ? "" : `<span class="badge level">只练 ${esc(currentScope())}</span>`}
        </div>
        ${nothing ? `<div class="empty">
            <div class="e-ico">🌱</div>
            <h3>还没有可复习的词</h3>
            <p>先添加几个生词，复习队列会自动生成。</p>
            <button class="btn btn-primary" data-action="go-add">添加生词</button>
          </div>`
        : queue.length === 0 ? `<div class="done-card">
            <div class="done-ico">✓</div>
            <h2>今天的复习都完成了</h2>
            <p style="color:var(--text-3)">${newCount + dueCount > 0 ? "还有词没轮到？检查一下设置里的每日上限。" : `范围「${esc(currentScope())}」里没有到期的词，可以换个范围或明天再来。`}</p>
            <div class="done-stats">
              <div><b>${s.todayReviews}</b><span>今天复习次数</span></div>
              <div><b>${s.streak}</b><span>连续天数</span></div>
              <div><b>${s.mastered}</b><span>已掌握</span></div>
            </div>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
              <button class="btn" data-action="go-library">回词库</button>
              <button class="btn btn-soft" data-action="start-quiz">做个小测验</button>
            </div>
          </div>`
        : `<section class="panel" style="max-width:680px;margin:0 auto">
            <div class="stats" style="grid-template-columns:1fr 1fr 1fr;background:transparent;margin-bottom:18px">
              <div><div class="stat-top">复习队列</div><div class="stat-num" style="font-size:26px">${queue.length}<small>词</small></div></div>
              <div><div class="stat-top">到期复习</div><div class="stat-num" style="font-size:26px">${Math.min(dueCount, state.settings.reviewLimit)}</div></div>
              <div><div class="stat-top">新词</div><div class="stat-num" style="font-size:26px">${Math.min(newCount, state.settings.newLimit)}</div></div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:22px">${preview}${queue.length > 8 ? `<span class="badge scheduled">+${queue.length - 8}</span>` : ""}</div>
            <button class="btn btn-primary btn-lg btn-block" data-action="start-review">开始复习 · 约 ${Math.max(1, Math.ceil(queue.length * 0.35))} 分钟</button>
            <p class="hint" style="text-align:center;margin-top:10px">键盘：<span class="kbd">Space</span> 揭晓 · <span class="kbd">1</span>~<span class="kbd">4</span> 评分</p>
          </section>`}
      </div>`;
    }

    if (r.done) return reviewDoneView();
    const w = r.queue[r.pos];
    if (!w) { r.done = true; return reviewDoneView(); }
    const prog = Math.round((r.pos / r.queue.length) * 100);
    const rateBtns = [1, 2, 3, 4].map((g) => `
      <button class="rate-btn" data-grade="${g}" data-action="grade">
        <b>${GRADE_LABEL[g].name}</b>
        <small>${previewInterval(w, g)}</small>
      </button>`).join("");
    return `
    <div class="review-shell">
      <div class="review-top">
        <button class="btn btn-sm btn-ghost" data-action="quit-review">← 结束</button>
        <div class="progress"><i style="width:${prog}%"></i></div>
        <span class="review-count">${r.pos + 1} / ${r.queue.length}</span>
      </div>
      <div class="flashcard">
        <div class="fc-term">${esc(w.term)}</div>
        <div class="fc-phon">${esc(w.phonetic)}</div>
        <button class="fc-speak" data-action="speak-current">${ICO.volume} 听发音</button>
        ${r.revealed ? `
          <div class="fc-answer">
            ${w.pos ? `<div class="fc-pos">${esc(w.pos)}</div>` : ""}
            <div class="fc-meaning">${esc(w.meaning)}</div>
            ${exBlock(w)}
            ${(w.level || w.tags.length) ? `<div class="fc-tags">${w.level ? `<span class="badge level">${esc(w.level)}</span>` : ""}${tagBadges(w.tags, w.level)}</div>` : ""}
            <div class="rate-row">${rateBtns}</div>
          </div>`
        : `<p class="fc-hint">先在心里回想中文意思，再揭晓答案</p>
           <button class="btn btn-lg btn-primary" data-action="reveal" style="margin-top:18px;min-width:200px">揭晓答案</button>
           <p class="hint" style="margin-top:12px">或按 <span class="kbd">Space</span></p>`}
      </div>
      <div class="review-foot">
        <span class="hint">${r.undo ? `<button class="link-btn" data-action="undo-grade">↺ 撤销上一次评分</button>` : `本轮已评 ${r.rated} 个 · 剩余 ${Math.max(0, r.queue.length - r.pos)} 个`}</span>
        <span class="hint">正确率 ${r.rated ? Math.round((r.good / r.rated) * 100) : 0}%</span>
      </div>
    </div>`;
  }

  function reviewDoneView() {
    const r = ui.review;
    return `
    <div class="review-shell">
      <div class="done-card">
        <div class="done-ico">🎉</div>
        <h2>本轮复习完成</h2>
        <p style="color:var(--text-3)">回忆得越费力，记得越牢。明天同一时间再来一轮。</p>
        <div class="done-stats">
          <div><b>${r.rated}</b><span>复习词数</span></div>
          <div><b>${r.rated ? Math.round((r.good / r.rated) * 100) : 0}%</b><span>记得的比例</span></div>
          <div><b>${r.left}</b><span>仍待复习</span></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" data-action="go-home">回到首页</button>
          <button class="btn" data-action="go-library">查看词库</button>
          <button class="btn btn-soft" data-action="start-quiz">做个小测验</button>
        </div>
      </div>
    </div>`;
  }

  function startReview() {
    const queue = buildQueue();
    if (!queue.length) {
      ui.review = null;
      render();
      toast(state.words.length ? "当前没有到期的词，明天再来" : "先添加几个生词吧", "err");
      return;
    }
    ui.review = { queue, pos: 0, revealed: false, rated: 0, good: 0, left: 0, done: false, undo: null, started: true, scope: currentScope(), exZhMap: {} };
    if (ui.tab !== "review") go("review");
    else render();
  }

  function gradeCurrent(grade) {
    const r = ui.review;
    if (!r || r.done) return;
    const w = r.queue[r.pos];
    if (!w) return;
    const snapshot = {
      ease: w.ease, reps: w.reps, interval: w.interval, nextReview: w.nextReview,
      lastReview: w.lastReview, totalReviews: w.totalReviews, correct: w.correct, lapses: w.lapses,
    };
    if (!r.requeuedIds) r.requeuedIds = new Set();
    schedule(w, grade);
    const requeued = grade === 1 && !r.requeuedIds.has(w.id);
    r.undo = { id: w.id, pos: r.pos, snapshot, rated: r.rated, good: r.good, requeued };
    r.rated += 1;
    if (grade >= 3) r.good += 1;
    state.history.push({ id: w.id, term: w.term, grade, at: Date.now(), type: "review" });
    if (requeued) {
      // 忘记的词放到本轮最后再过一遍（每张卡每轮最多追加一次）
      r.requeuedIds.add(w.id);
      r.queue.push(w);
    }
    r.pos += 1;
    r.revealed = false;
    if (r.pos >= r.queue.length) {
      r.done = true;
      r.left = dueWords().length;
      state.sessions.push({ at: Date.now(), kind: "review", total: r.rated, correct: r.good });
      saveNow();
    } else {
      save();
    }
    render();
  }

  function undoGrade() {
    const r = ui.review;
    if (!r || !r.undo) return;
    const w = state.words.find((x) => x.id === r.undo.id);
    if (!w) return;
    Object.assign(w, r.undo.snapshot);
    // 撤销本轮追加到队尾的重复卡片
    const last = r.queue[r.queue.length - 1];
    if (r.undo.requeued && last && last.id === w.id && r.queue.length > r.undo.pos) {
      r.queue.pop();
      if (r.requeuedIds) r.requeuedIds.delete(w.id);
    }
    r.pos = r.undo.pos;
    r.rated = r.undo.rated;
    r.good = r.undo.good;
    r.revealed = false;
    r.undo = null;
    state.history.pop();
    r.done = false;
    save();
    render();
  }

  function wireReview() {
    // 键盘事件在 boot 里统一绑定一次，这里只处理需要重新聚焦的输入
  }

  function reviewKeyHandler(e) {
    const r = ui.review;
    if (!r || r.done || ui.tab !== "review") return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === " " || e.key === "Enter") {
      if (!r.revealed) {
        e.preventDefault();
        r.revealed = true;
        render();
      } else if (e.key === " ") {
        e.preventDefault();
      }
    } else if (/^[1-4]$/.test(e.key) && r.revealed) {
      e.preventDefault();
      gradeCurrent(Number(e.key));
    } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      undoGrade();
    }
  }

  /* ==========================================================
     12. 测验
     ========================================================== */
  function buildQuiz() {
    const pool = scopedWords().slice();
    if (pool.length < 2) return [];
    const size = Math.min(state.settings.quizSize, pool.length);
    const picked = shuffle(pool).slice(0, size);
    return picked.map((w, idx) => {
      // 找出释义不同的干扰项，保证四个选项不重复
      const distinct = [];
      const seen = new Set([w.meaning]);
      shuffle(pool).forEach((x) => {
        if (x.id === w.id || seen.has(x.meaning)) return;
        seen.add(x.meaning);
        distinct.push(x);
      });
      const canChoice = distinct.length >= 3;
      const useChoice = canChoice && (idx % 2 === 0 || pool.length < 6);
      if (useChoice) {
        const options = shuffle([w, ...distinct.slice(0, 3)]).map((o) => ({ id: o.id, text: o.meaning }));
        return { wordId: w.id, type: "choice", options, correctId: w.id };
      }
      return { wordId: w.id, type: "spell" };
    }).filter((q) => q.type === "spell" || q.options.length >= 2);
  }

  function quizView() {
    const q = ui.quiz;
    if (!q) {
      const eligible = scopedWords().length;
      const ready = eligible >= 2;
      return `
      <div class="quiz-shell">
        <div class="page-head">
          <div>
            <p class="eyebrow">Quiz</p>
            <h1>测验</h1>
            <p class="sub">从词库里随机抽题，选择 + 拼写交替出现，答错的词下次更早复习。</p>
          </div>
        </div>
        <div class="scope-bar">
          <span class="scope-label">出题范围</span>
          ${scopeSelectHtml("quizScope")}
          ${currentScope() === "全部" ? "" : `<span class="badge level">只考 ${esc(currentScope())}</span>`}
        </div>
        ${ready ? `<section class="panel" style="text-align:center;padding:38px 24px">
            <div style="font-size:36px;margin-bottom:10px">✎</div>
            <h2 style="font-size:20px;margin-bottom:6px">${Math.min(state.settings.quizSize, eligible)} 道题 · 约 ${Math.max(1, Math.ceil(Math.min(state.settings.quizSize, eligible) * 0.4))} 分钟</h2>
            <p style="color:var(--text-3);font-size:13.5px;margin-bottom:22px">当前范围「${esc(currentScope())}」共 ${eligible} 个词${eligible < 4 ? "（至少 4 个词才能出选择题，现在只有拼写题）" : ""}</p>
            <button class="btn btn-primary btn-lg" data-action="start-quiz">开始测验</button>
          </section>`
        : `<div class="empty">
            <div class="e-ico">🧩</div>
            <h3>这个范围里的词还不够出题</h3>
            <p>「${esc(currentScope())}」里只有 ${eligible} 个词，至少需要 2 个；也可以切换学习范围或载入内置词书。</p>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
              <button class="btn btn-primary" data-action="go-add">去添加生词</button>
              <button class="btn" data-action="open-bank">载入词书</button>
            </div>
          </div>`}
        ${computeQuizHistory()}
      </div>`;
    }
    if (q.finished) return quizResultView();
    const item = q.items[q.idx];
    const w = state.words.find((x) => x.id === item.wordId);
    if (!w) { q.idx += 1; q.finished = q.idx >= q.items.length; return quizView(); }
    const prog = Math.round((q.idx / q.items.length) * 100);
    const submitted = q.answered;

    let body = "";
    if (item.type === "choice") {
      body = `
        <div class="q-prompt">${esc(w.term)}</div>
        <div class="q-sub">${esc(w.phonetic)} · 选择正确的中文释义</div>
        <div class="q-options">${item.options.map((o, i) => {
          let cls = "";
          let mark = "";
          if (submitted) {
            if (o.id === item.correctId) { cls = "correct"; mark = "✓"; }
            else if (o.id === q.pickedId) { cls = "wrong"; mark = "✕"; }
            else cls = "dim";
          }
          return `<button class="q-option ${cls}" data-action="pick" data-id="${o.id}" ${submitted ? "disabled" : ""}>
            <span class="letter">${mark || String.fromCharCode(65 + i)}</span><span>${esc(o.text)}</span>
          </button>`;
        }).join("")}</div>`;
    } else {
      body = `
        <div class="q-prompt small">${esc(w.meaning)}</div>
        <div class="q-sub">${w.pos ? esc(w.pos) + " · " : ""}拼写这个单词</div>
        <div class="q-input-row">
          <input id="spellInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="输入英文单词…" value="${submitted ? escAttr(q.spellInput || "") : ""}" ${submitted ? "disabled" : ""} />
          <button class="btn btn-primary" data-action="submit-spell" ${submitted ? "disabled" : ""}>确认</button>
        </div>
        ${submitted && !q.isCorrect ? `<p class="hint" style="margin-top:10px">正确拼写：<b style="font-family:var(--font-serif);font-size:16px">${esc(w.term)}</b></p>` : ""}`;
    }

    const feedback = submitted ? `
      <div class="q-feedback ${q.isCorrect ? "ok" : "no"}">
        <span>${q.isCorrect ? "✓" : "✕"}</span>
        <div class="fb-body">
          <b>${q.isCorrect ? "答对了" : "再看一眼"}</b>
          <em>${esc(w.term)} ${esc(w.phonetic)} · ${esc(w.meaning)}</em>
          ${exBlock(w)}
        </div>
      </div>` : "";

    return `
    <div class="quiz-shell">
      <div class="quiz-head">
        <button class="btn btn-sm btn-ghost" data-action="quit-quiz">← 结束</button>
        <div class="progress"><i style="width:${prog}%"></i></div>
        <span class="quiz-score">${q.idx + 1} / ${q.items.length} · 得分 ${q.score}</span>
      </div>
      <div class="q-card">
        <div class="q-type">${item.type === "choice" ? "Multiple Choice" : "Spelling"}</div>
        ${body}
        ${feedback}
        ${submitted ? `<div class="q-foot"><button class="btn btn-primary" data-action="next-question">${q.idx + 1 >= q.items.length ? "查看结果" : "下一题"} →</button></div>` : ""}
      </div>
      <p class="hint" style="text-align:center;margin-top:12px">不确定也没关系，猜错后正确答案会出现在这里。</p>
    </div>`;
  }

  function computeQuizHistory() {
    const qs = state.sessions.filter((s) => s.kind === "quiz").slice(-6).reverse();
    if (!qs.length) return "";
    return `<section class="panel" style="margin-top:14px">
      <div class="panel-head"><h3>最近的测验</h3></div>
      <div class="due-list">
        ${qs.map((s) => `<div class="due-item"><span class="w" style="font-family:var(--font-sans);font-size:13.5px">${fmtDate(s.at)}</span><span class="m">${s.total} 题 · 答对 ${s.correct}</span><span class="badge ${s.correct / s.total >= 0.8 ? "mastered" : "learning"}">${Math.round((s.correct / s.total) * 100)}%</span></div>`).join("")}
      </div>
    </section>`;
  }

  function startQuiz() {
    const items = buildQuiz();
    if (!items.length) {
      toast(state.words.length < 2 ? "至少需要 2 个词才能开始测验" : "暂时出不了题，先多添加几个词", "err");
      return;
    }
    ui.quiz = { items, idx: 0, score: 0, answered: false, pickedId: null, isCorrect: null, spellInput: "", finished: false, wrong: [] };
    if (ui.tab !== "quiz") go("quiz");
    else render();
    focusSpellInput();
  }

  function focusSpellInput() {
    setTimeout(() => {
      const el = $("#spellInput");
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }, 40);
  }

  function answerChoice(id) {
    const q = ui.quiz;
    if (!q || q.answered) return;
    const item = q.items[q.idx];
    q.pickedId = id;
    q.isCorrect = id === item.correctId;
    completeAnswer();
  }

  function submitSpell() {
    const q = ui.quiz;
    if (!q || q.answered) return;
    const el = $("#spellInput");
    const item = q.items[q.idx];
    const w = state.words.find((x) => x.id === item.wordId);
    const val = cleanStr(el ? el.value : "", 80);
    q.spellInput = val;
    q.isCorrect = normalizeAnswer(val) === normalizeAnswer(w.term);
    completeAnswer();
  }

  function normalizeAnswer(v) {
    return String(v)
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[^a-z' -]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function completeAnswer() {
    const q = ui.quiz;
    q.answered = true;
    const item = q.items[q.idx];
    const w = state.words.find((x) => x.id === item.wordId);
    if (q.isCorrect) {
      q.score += 1;
    } else {
      q.wrong.push({ term: w ? w.term : "", meaning: w ? w.meaning : "" });
      if (w) applyQuizFailure(w);
    }
    render();
  }

  function applyQuizFailure(w) {
    // 答错的词提前回到复习队列
    w.ease = Math.max(1.3, (w.ease || 2.5) - 0.1);
    if (w.totalReviews > 0) {
      w.interval = Math.min(w.interval || 1, 1);
    }
    w.nextReview = Date.now();
  }

  function nextQuestion() {
    const q = ui.quiz;
    if (!q) return;
    q.idx += 1;
    q.answered = false;
    q.pickedId = null;
    q.isCorrect = null;
    q.spellInput = "";
    if (q.idx >= q.items.length) {
      q.finished = true;
      state.sessions.push({ at: Date.now(), kind: "quiz", total: q.items.length, correct: q.score });
      saveNow();
    } else {
      save();
    }
    render();
    focusSpellInput();
  }

  function quizResultView() {
    const q = ui.quiz;
    const pct = Math.round((q.score / q.items.length) * 100);
    const title = pct >= 90 ? "几乎全对，太稳了" : pct >= 70 ? "不错，再巩固一下" : pct >= 40 ? "有进步空间" : "这些词还需要多见面";
    return `
    <div class="quiz-shell">
      <div class="result-card">
        <div class="score-ring" style="--pct:${pct}"><span>${pct}%</span></div>
        <h2>${title}</h2>
        <p>共 ${q.items.length} 题，答对 ${q.score} 题</p>
        ${q.wrong.length ? `<div class="miss-list">
          ${q.wrong.map((x) => `<div class="miss-item"><b>${esc(x.term)}</b><span>${esc(x.meaning)}</span></div>`).join("")}
        </div>` : `<p style="margin-top:14px;color:var(--mint);font-size:13.5px">全部答对，这些词已经进入更长的复习间隔。</p>`}
        <div class="result-actions">
          <button class="btn" data-action="go-library">看看词库</button>
          <button class="btn" data-action="go-home">返回首页</button>
          <button class="btn btn-primary" data-action="start-quiz">再来一轮</button>
        </div>
      </div>
      <p class="hint" style="text-align:center;margin-top:14px">答错的词已放回待复习队列，可以在「复习」里再见到它们。</p>
    </div>`;
  }

  function wireQuiz() {
    const q = ui.quiz;
    if (q && !q.finished) {
      const input = $("#spellInput");
      if (input && !input.disabled) {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); submitSpell(); }
        });
      }
    }
  }

  /* ==========================================================
     13. 批量解析 / 导入 / 导出
     ========================================================== */
  const POS_SET = ["n.", "v.", "adj.", "adv.", "prep.", "conj.", "pron.", "num.", "art.", "phr.", "vt.", "vi."];

  function splitParts(line) {
    if (line.includes("\t")) return line.split("\t");
    if (line.includes("|")) return line.split("|");
    if (line.includes("｜")) return line.split("｜");
    if (line.includes("=")) return line.split("=");
    const commaIdx = line.indexOf(",");
    if (commaIdx > 0) return [line.slice(0, commaIdx), line.slice(commaIdx + 1)];
    // 没有分隔符：按第一个中文字符切开
    const m = line.match(/^([A-Za-z][A-Za-z'’\- ]*?)\s*([^A-Za-z].*)$/);
    if (m) return [m[1], m[2]];
    return [line, ""];
  }

  function stripNotes(meaning) {
    let m = meaning.replace(/\s+/g, " ").trim();
    m = m.replace(/[\[{]([^\]}]{1,40})[\]}]/g, ""); // 去掉方括号注记
    return m.trim();
  }

  function parseLine(line) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) return null;
    const parts = splitParts(raw);
    let term = cleanStr(parts[0], 80);
    if (!term) return null;
    // 词性可能跟在单词后面，例如 "revenue n."
    let pos = "";
    const posMatch = term.match(/^(.*?)\s+(n|v|adj|adv|prep|conj|pron|phr|vt|vi)\.?$/i);
    if (posMatch && posMatch[1]) {
      term = posMatch[1].trim();
      pos = posMatch[2].toLowerCase() + ".";
      if (pos === "vt." || pos === "vi.") pos = "v.";
    }
    let phonetic = "";
    const phonMatch = term.match(/\s*[\/\[]([^\/\]]+)[\/\]]\s*$/);
    if (phonMatch) {
      phonetic = "/" + phonMatch[1].trim() + "/";
      term = term.replace(phonMatch[0], "").trim();
    }
    let rest = parts.slice(1).join(" ").trim() || "";
    if (!rest) return null;
    // rest 里也可能带音标和词性
    const ph2 = rest.match(/[\/\[]([^\/\]]{1,40})[\/\]]/);
    if (ph2 && !phonetic) {
      phonetic = "/" + ph2[1].trim() + "/";
      rest = rest.replace(ph2[0], " ");
    } else if (ph2) {
      rest = rest.replace(ph2[0], " ");
    }
    if (!pos) {
      const pm = rest.match(/^(n|v|adj|adv|prep|conj|pron|num|art|phr|vt|vi)\.\s*/i);
      if (pm) {
        pos = pm[1].toLowerCase() + ".";
        if (pos === "vt." || pos === "vi.") pos = "v.";
        rest = rest.slice(pm[0].length);
      }
    }
    const meaning = stripNotes(rest);
    if (!term || !meaning) return null;
    if (!POS_LIST.includes(pos)) pos = POS_LIST.includes(pos) ? pos : "";
    return { term, phonetic, pos, meaning, level: "" };
  }

  function parseBulkRaw(text) {
    const out = [];
    const seen = new Set();
    String(text || "").split(/\r?\n/).forEach((line) => {
      const p = parseLine(line);
      if (!p) return;
      const key = p.term.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(p);
    });
    return out;
  }

  function openImportPreview(parsed) {
    if (!parsed.length) {
      toast("没有识别到可导入的单词，检查一下格式", "err");
      return;
    }
    // 没写级别的，归入当前学习范围（「全部」时不归级）
    const fallback = currentScope() === "全部" ? "" : currentScope();
    ui.importRows = parsed.map((p) => {
      const dup = state.words.some((w) => w.term.toLowerCase() === p.term.toLowerCase());
      if (!p.level) p.level = fallback;
      return Object.assign({ checked: !dup, dup }, p);
    });
    renderImportPreview();
    openDialog($("#importDialog"));
  }

  function renderImportPreview() {
    const rows = ui.importRows;
    const usable = rows.filter((r) => !r.dup).length;
    const checked = rows.filter((r) => r.checked).length;
    $("#importSummary").textContent = `识别到 ${rows.length} 个词，其中 ${usable} 个是新词，${rows.length - usable} 个已在词库中。勾选要导入的条目：`;
    $("#importPreview").innerHTML = `
      <div class="import-row head"><span></span><span>单词</span><span>释义</span></div>
      ${rows.map((r, i) => `
        <label class="import-row ${r.dup ? "dup" : ""}">
          <input type="checkbox" data-idx="${i}" ${r.checked ? "checked" : ""} />
          <span class="t">${esc(r.term)}${r.level ? `<span class="badge level" style="margin-left:6px">${esc(r.level)}</span>` : ""}${r.dup ? " · 已存在" : ""}</span>
          <span class="m">${esc(r.meaning)}</span>
        </label>`).join("")}`;
    $("#importConfirm").textContent = `导入 ${checked} 个词`;
    $("#importConfirm").disabled = checked === 0;
  }

  function doImport() {
    const rows = ui.importRows.filter((r) => r.checked);
    if (!rows.length) return;
    let added = 0, skipped = 0, merged = 0;
    rows.forEach((r) => {
      const exist = state.words.find((w) => w.term.toLowerCase() === r.term.toLowerCase());
      if (exist) {
        skipped += 1;
        if (r.level && !exist.level) { exist.level = r.level; merged += 1; }
        return;
      }
      state.words.unshift(sanitizeWord({
        id: uid(), term: r.term, meaning: r.meaning,
        phonetic: r.phonetic || "", pos: r.pos || "", level: r.level || "",
        tags: r.tags || [], createdAt: Date.now(), nextReview: Date.now(),
      }));
      added += 1;
    });
    state.settings.seeded = true;
    if (ui.importMeta) applyImportMeta(ui.importMeta);
    ui.importMeta = null;
    saveNow();
    closeDialog($("#importDialog"));
    ui.importRows = [];
    go("library");
    toast(`导入完成：新增 ${added} 个词${merged ? `，${merged} 个补上级别` : ""}${skipped - merged > 0 ? `，跳过 ${skipped - merged} 个重复` : ""}`);
  }

  /* 导入备份时恢复学习进度与设置 */
  function applyImportMeta(meta) {
    if (meta.learn && typeof meta.learn === "object") {
      const L = meta.learn;
      if (L.book && LEARN_BOOKS.includes(L.book)) state.learn.book = L.book;
      if (/^[A-Z]$/.test(L.from || "")) state.learn.from = L.from;
      if (/^[A-Z]$/.test(L.to || "")) state.learn.to = L.to;
      if (L.size) state.learn.size = clampInt(L.size, 5, 100, 20);
      if (L.order === "random" || L.order === "seq") state.learn.order = L.order;
      if (L.seen && typeof L.seen === "object") {
        Object.keys(L.seen).forEach((k) => { if (L.seen[k]) state.learn.seen[k] = L.seen[k]; });
      }
      learnRangeCache = { key: "", words: [] };
    }
    if (meta.settings && typeof meta.settings === "object") {
      const st = meta.settings;
      if (st.scope) state.settings.scope = st.scope;
      if (st.newLimit !== undefined) state.settings.newLimit = clampInt(st.newLimit, 0, 100, 12);
      if (st.reviewLimit !== undefined) state.settings.reviewLimit = clampInt(st.reviewLimit, 1, 200, 80);
      if (st.quizSize !== undefined) state.settings.quizSize = clampInt(st.quizSize, 4, 50, 10);
    }
  }

  /* RFC4180 CSV 解析：支持引号、逗号、换行 */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    const s = String(text || "").replace(/^\ufeff/, "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((x) => x.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((x) => x.trim() !== "")) rows.push(row);
    return rows;
  }

  function headerIndex(header) {
    const find = (re) => header.findIndex((h) => re.test(h));
    const exampleZh = find(/(examplezh|example_zh|exzh|例句翻译|例句中文|例句译文)/i);
    /* 例句列要排除已经被识别为"例句翻译"的那一列，避免两个都命中同一列 */
    let example = find(/(example|sentence|例句)/i);
    if (example === exampleZh) example = header.findIndex((h, i) => i !== exampleZh && /(example|sentence|例句)/i.test(h));
    return {
      term: find(/^(word|term|单词|词汇)$/i),
      phonetic: find(/(phonetic|ipa|音标)/i),
      pos: find(/(pos|partofspeech|词性)/i),
      level: find(/(level|book|级别|词书|等级)/i),
      meaning: find(/(meaning|definition|translation|释义|中文)/i),
      example,
      exampleZh,
      tags: find(/(tags?|标签)/i),
    };
  }

  function importFromText(text, filename) {
    const name = (filename || "").toLowerCase();
    const trimmed = String(text || "").trim();
    if (!trimmed) { toast("文件是空的", "err"); return; }
    if (name.endsWith(".json") || /^[\[{]/.test(trimmed)) {
      try {
        const data = JSON.parse(trimmed);
        const arr = Array.isArray(data) ? data : (data && Array.isArray(data.words) ? data.words : null);
        if (!arr) throw new Error("JSON 里没有 words 数组");
        const parsed = arr.map((w) => {
          if (typeof w === "string") return parseLine(w);
          const term = cleanStr(w.term || w.word || w.name, 80);
          const meaning = cleanStr(w.meaning || w.definition || w.translation || w.zh, 400);
          if (!term || !meaning) return null;
          return {
            term,
            phonetic: cleanStr(w.phonetic || w.ipa || "", 80),
            pos: cleanStr(w.pos || w.partOfSpeech || "", 12),
            level: cleanStr(w.level || w.book || w.grade || "", 24),
            meaning,
            example: cleanStr(w.example || w.sentence || "", 600),
            exampleZh: cleanStr(w.exampleZh || w.example_zh || w.exZh || "", 400),
            tags: normalizeTags(w.tags || w.tag || []),
          };
        }).filter(Boolean);
        ui.importMeta = { learn: data.learn || null, settings: data.settings || null };
        openImportPreview(parsed);
        return;
      } catch (e) {
        toast("JSON 解析失败：" + e.message, "err");
        return;
      }
    }
    // CSV / 纯文本
    const table = parseCSV(trimmed);
    let parsed = [];
    const headerIdx = table.length ? headerIndex(table[0].map((h) => String(h).trim().toLowerCase())) : null;
    const hasHeader = headerIdx && headerIdx.term >= 0 && headerIdx.meaning >= 0;
    if (hasHeader) {
      parsed = table.slice(1).map((cells) => {
        const get = (i) => (i >= 0 && cells[i] !== undefined ? cleanStr(cells[i], 400) : "");
        const term = get(headerIdx.term);
        const meaning = get(headerIdx.meaning);
        if (!term || !meaning) return null;
        return {
          term,
          phonetic: get(headerIdx.phonetic),
          pos: POS_LIST.includes(get(headerIdx.pos)) ? get(headerIdx.pos) : "",
          level: get(headerIdx.level),
          meaning,
          example: get(headerIdx.example),
          exampleZh: get(headerIdx.exampleZh),
          tags: normalizeTags(get(headerIdx.tags)),
        };
      }).filter(Boolean);
    } else {
      parsed = trimmed.split(/\r?\n/).map((line) => parseLine(line)).filter(Boolean);
    }
    openImportPreview(parsed);
  }

  function csvEscape(v) {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(words) {
    const head = ["单词", "音标", "词性", "级别", "释义", "例句", "例句翻译", "标签", "添加时间", "复习次数", "正确次数", "间隔(天)", "下次复习"];
    const rows = words.map((w) => [
      w.term, w.phonetic, w.pos, w.level || "", w.meaning, w.example, w.exampleZh || "", w.tags.join(" "),
      fmtDate(w.createdAt), w.totalReviews, w.correct, w.interval, fmtDate(w.nextReview),
    ]);
    return [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
  }

  function download(filename, content, type) {
    const blob = new Blob([`\ufeff${content}`], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  function exportJSON() {
    if (!state.words.length) { toast("词库是空的，没有可导出的内容", "err"); return; }
    const payload = {
      app: "VocabFlow", version: 1, exportedAt: new Date().toISOString(),
      scope: currentScope(),
      settings: state.settings,
      learn: state.learn,
      words: state.words, sessions: state.sessions.slice(-500),
    };
    download(`vocabflow-${stamp()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    toast(`已导出 ${state.words.length} 个词（含复习进度与学习进度）`);
  }

  function exportCSV(words) {
    const list = words || state.words;
    if (!list.length) { toast("没有可导出的单词", "err"); return; }
    download(`vocabflow-${stamp()}.csv`, toCSV(list), "text/csv;charset=utf-8");
    toast(`已导出 ${list.length} 个词（CSV，可用 Excel 打开）`);
  }

  function downloadTemplate() {
    const sample = `单词,音标,词性,级别,释义,例句\nresilient,/rɪˈzɪliənt/,adj.,CET-6,有韧性的,Children are often more resilient than we expect.\nmeticulous,/məˈtɪkjələs/,adj.,CET-6,一丝不苟的,She kept meticulous notes.\nmitigate,/ˈmɪtɪɡeɪt/,v.,考研,减轻；缓和,Planting trees can mitigate flooding.`;
    download("vocabflow-template.csv", sample, "text/csv;charset=utf-8");
  }

  function pickFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.json,.txt,text/csv,application/json,text/plain";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast("文件太大了（上限 5MB）", "err"); return; }
      const reader = new FileReader();
      reader.onload = () => importFromText(String(reader.result || ""), file.name);
      reader.onerror = () => toast("读取文件失败", "err");
      reader.readAsText(file, "utf-8");
      input.value = "";
    });
    input.click();
  }

  /* ==========================================================
     14. 弹窗 / 编辑 / 删除
     ========================================================== */
  let editingId = null;

  function openEdit(id) {
    editingId = id || null;
    const dlg = $("#editDialog");
    const w = id ? state.words.find((x) => x.id === id) : null;
    $("#editTitle").textContent = w ? "编辑单词" : "添加单词";
    $("#editTerm").value = w ? w.term : "";
    $("#editPhonetic").value = w ? w.phonetic : "";
    $("#editMeaning").value = w ? w.meaning : "";
    $("#editExample").value = w ? exOf(w) : "";
    $("#editExampleZh").value = w ? (w.exampleZh || "") : "";
    $("#editTags").value = w ? w.tags.join(" ") : "";
    const lvEl = $("#editLevel");
    if (lvEl) lvEl.value = w ? (w.level || "") : "";
    $("#editPos").value = w && POS_LIST.includes(w.pos) ? w.pos : (w && w.pos ? "其他" : "");
    $$("#editForm .field-msg").forEach((el) => { el.textContent = ""; });
    openDialog(dlg);
    setTimeout(() => $("#editTerm").focus({ preventScroll: true }), 60);
  }

  function submitEdit(e) {
    e.preventDefault();
    const term = cleanStr($("#editTerm").value, 80);
    const meaning = cleanStr($("#editMeaning").value, 400);
    $$("#editForm .field-msg").forEach((el) => { el.textContent = ""; });
    if (!term) { $("#editForm [data-msg-for=term]").textContent = "请填写单词"; $("#editTerm").focus(); return; }
    if (!meaning) { $("#editForm [data-msg-for=meaning]").textContent = "请填写释义"; $("#editMeaning").focus(); return; }
    const dup = state.words.find((w) => w.id !== editingId && w.term.toLowerCase() === term.toLowerCase());
    if (dup) { $("#editForm [data-msg-for=term]").textContent = "词库里已经有这个词了"; return; }
    const data = {
      term,
      phonetic: cleanStr($("#editPhonetic").value, 80),
      pos: $("#editPos").value,
      level: cleanStr($("#editLevel") ? $("#editLevel").value : "", 24),
      meaning,
      example: cleanStr($("#editExample").value, 600),
      exampleZh: cleanStr($("#editExampleZh").value, 400),
      tags: normalizeTags($("#editTags").value),
    };
    if (editingId) {
      const w = state.words.find((x) => x.id === editingId);
      if (w) Object.assign(w, data);
      toast("已保存修改");
    } else {
      state.words.unshift(sanitizeWord(Object.assign({ id: uid(), createdAt: Date.now(), nextReview: Date.now() }, data)));
      toast(`已添加「${term}」`);
    }
    saveNow();
    closeDialog($("#editDialog"));
    render();
  }

  function deleteWord(id) {
    const w = state.words.find((x) => x.id === id);
    if (!w) return;
    if (!window.confirm(`确定删除「${w.term}」吗？复习进度也会一起删除，无法恢复。`)) return;
    state.words = state.words.filter((x) => x.id !== id);
    ui.selected.delete(id);
    if (ui.openId === id) ui.openId = null;
    saveNow();
    render();
    toast(`已删除「${w.term}」`);
  }

  function bulkDelete() {
    const n = ui.selected.size;
    if (!n) return;
    if (!window.confirm(`确定删除所选的 ${n} 个单词吗？`)) return;
    const ids = new Set(ui.selected);
    state.words = state.words.filter((w) => !ids.has(w.id));
    ui.selected.clear();
    ui.selectMode = false;
    saveNow();
    render();
    toast(`已删除 ${n} 个单词`);
  }

  function bulkTag() {
    const n = ui.selected.size;
    if (!n) return;
    const tag = window.prompt("给所选单词添加标签（多个用空格分隔）：", "");
    if (!tag) return;
    const tags = normalizeTags(tag);
    if (!tags.length) return;
    state.words.forEach((w) => {
      if (ui.selected.has(w.id)) w.tags = normalizeTags(w.tags.concat(tags));
    });
    saveNow();
    render();
    toast(`已为 ${n} 个词添加标签`);
  }

  function bulkExport() {
    const list = state.words.filter((w) => ui.selected.has(w.id));
    exportCSV(list);
  }

  /* ==========================================================
     15. 设置
     ========================================================== */
  function openSettings() {
    $("#setNewLimit").value = state.settings.newLimit;
    $("#setReviewLimit").value = state.settings.reviewLimit;
    $("#setQuizSize").value = state.settings.quizSize;
    const sc = $("#setScope");
    if (sc) {
      sc.innerHTML = ["全部", ...allLevels()].map((l) =>
        `<option value="${escAttr(l)}" ${currentScope() === l ? "selected" : ""}>${l === "全部" ? "全部词库" : esc(l)}（${scopeCount(l)}）</option>`
      ).join("");
    }
    populateVoices();
    openDialog($("#settingsDialog"));
  }

  function populateVoices() {
    const sel = $("#setVoice");
    if (!sel) return;
    const voices = ("speechSynthesis" in window) ? window.speechSynthesis.getVoices() : [];
    const en = voices.filter((v) => /^en/i.test(v.lang));
    sel.innerHTML = `<option value="">自动（系统默认美音优先）</option>` +
      en.map((v) => `<option value="${escAttr(v.name)}" ${state.settings.voice === v.name ? "selected" : ""}>${esc(v.name)} · ${esc(v.lang)}</option>`).join("");
    if (!en.length) {
      sel.innerHTML += `<option value="" disabled>系统里没有找到英语语音包</option>`;
    }
  }

  function submitSettings(e) {
    e.preventDefault();
    state.settings.newLimit = clampInt($("#setNewLimit").value, 0, 100, 12);
    state.settings.reviewLimit = clampInt($("#setReviewLimit").value, 1, 200, 80);
    state.settings.quizSize = clampInt($("#setQuizSize").value, 4, 50, 10);
    state.settings.voice = $("#setVoice").value || "";
    const sc = $("#setScope");
    if (sc && sc.value) state.settings.scope = sc.value;
    saveNow();
    closeDialog($("#settingsDialog"));
    toast("设置已保存");
    ui.review = null;
    render();
  }

  let resetArmed = 0;
  function resetAllData() {
    if (Date.now() - resetArmed > 3000) {
      resetArmed = Date.now();
      $("#resetDataBtn").textContent = "再点一次确认清空";
      toast("这会删除全部单词与复习记录，3 秒内再点一次确认", "err");
      setTimeout(() => {
        if (Date.now() - resetArmed >= 2900) $("#resetDataBtn").textContent = "清空全部数据";
      }, 3000);
      return;
    }
    resetArmed = 0;
    state = clone(DEFAULT_STATE);
    saveNow();
    closeDialog($("#settingsDialog"));
    ui.selected.clear();
    ui.selectMode = false;
    ui.review = null;
    ui.quiz = null;
    ui.openId = null;
    go("home");
    toast("数据已清空");
  }

  /* ==========================================================
     16. 事件绑定
     ========================================================== */
  document.addEventListener("click", (e) => {
    const navBtn = e.target.closest(".nav-item");
    if (navBtn) { go(navBtn.dataset.tab); return; }
    const brand = e.target.closest(".brand");
    if (brand) { e.preventDefault(); go("home"); return; }
    const viewBtn = e.target.closest("[data-view]");
    if (viewBtn) { ui.filters.view = viewBtn.dataset.view; render(); return; }
    const tagChip = e.target.closest(".chip[data-tag]");
    if (tagChip) {
      const t = tagChip.dataset.tag;
      ui.filters.tag = ui.filters.tag === t ? "" : t;
      render();
      return;
    }
    const rateBtn = e.target.closest(".rate-btn[data-grade]");
    if (rateBtn) { gradeCurrent(Number(rateBtn.dataset.grade)); return; }
    const closeBtn = e.target.closest("[data-close-dialog]");
    if (closeBtn) { const d = closeBtn.closest("dialog"); if (d) closeDialog(d); return; }

    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    switch (action) {
      case "go-add": go("add"); break;
      case "go-library": go("library"); break;
      case "go-home": go("home"); break;
      case "go-quiz": go("quiz"); break;
      case "go-learn": go("learn"); break;
      case "learn-start": startLearn(); break;
      case "learn-quit": ui.learn = null; render(); break;
      case "learn-back": ui.learn = null; render(); break;
      case "learn-known": learnAnswer(true); break;
      case "learn-unknown": learnAnswer(false); break;
      case "learn-next": learnAdvance(); break;
      case "learn-peek": learnPeek(); break;
      case "learn-undo": learnUndoLast(); break;
      case "learn-reset": resetLearnProgress(); break;
      case "learn-speak": {
        const lw = ui.learn && ui.learn.words[ui.learn.pos];
        if (lw) speak(lw.term);
        break;
      }
      case "start-review": startReview(); break;
      case "start-quiz": startQuiz(); break;
      case "reveal": if (ui.review) { ui.review.revealed = true; render(); const w = ui.review.queue[ui.review.pos]; if (w) speak(w.term); } break;
      case "grade": gradeCurrent(Number(actionEl.dataset.grade)); break;
      case "undo-grade": undoGrade(); break;
      case "quit-review": ui.review = null; render(); break;
      case "speak": speak((state.words.find((w) => w.id === id) || {}).term || ""); break;
      case "speak-current": if (ui.review) { const w = ui.review.queue[ui.review.pos]; if (w) speak(w.term); } break;
      case "speak-example-text": speak(actionEl.dataset.en || ""); break;
      case "speak-text": speak(actionEl.dataset.en || ""); break;
      case "translate-example-text": translateExampleText(actionEl.dataset.en || "", id || null); break;
      case "fetch-example": fetchExample(id); break;
      case "toggle-open": ui.openId = ui.openId === id ? null : id; render(); break;
      case "edit": openEdit(id); break;
      case "delete": deleteWord(id); break;
      case "review-one": reviewOne(id); break;
      case "select-one": break; // 由 change 事件处理
      case "toggle-select":
        ui.selectMode = !ui.selectMode;
        if (!ui.selectMode) ui.selected.clear();
        render();
        break;
      case "bulk-delete": bulkDelete(); break;
      case "bulk-tag": bulkTag(); break;
      case "bulk-export": bulkExport(); break;
      case "bulk-clear": ui.selected.clear(); ui.selectMode = false; render(); break;
      case "clear-search": ui.filters.q = ""; render(); break;
      case "reset-filters": ui.filters = { q: "", tag: "", status: "all", sort: "newest", view: ui.filters.view }; render(); break;
      case "export-menu": openExportMenu(); break;
      case "export-json": exportJSON(); break;
      case "export-csv": exportCSV(); break;
      case "export-template": downloadTemplate(); break;
      case "import-file": pickFile(); break;
      case "parse-bulk": openImportPreview(parseBulkRaw($("#bulkText").value)); break;
      case "load-sample-bulk": {
        const ta = $("#bulkText");
        ta.value = ["allocate, 分配；拨给", "compelling | 令人信服的", "deteriorate n. 恶化；变坏", "scrutinize, /ˈskruːtənaɪz/ 仔细检查"].join("\n");
        $("#bulkCount").textContent = "识别到 4 行";
        ta.focus();
        break;
      }
      case "load-sample": {
        if (state.words.some((w) => w.term === "resilient" && w.tags.includes(SAMPLE_TAG))) {
          toast("示例词书已经在词库里了", "err");
          break;
        }
        const base = Date.now();
        SAMPLE_WORDS.forEach(([term, phonetic, pos, meaning, example, tags], i) => {
          if (state.words.some((w) => w.term.toLowerCase() === term.toLowerCase())) return;
          state.words.push(sanitizeWord({
            id: uid(), term, phonetic, pos, meaning, example,
            level: inferLevelFromTags(tags),
            tags: tags.concat(SAMPLE_TAG),
            createdAt: base - i * 60000,
            nextReview: base,
          }));
        });
        state.settings.seeded = true;
        saveNow();
        render();
        toast(`已载入 ${SAMPLE_WORDS.length} 个示例单词`);
        break;
      }
      case "reset-add": $("#addForm").reset(); render(); break;
      case "voice-input": startVoiceInput(); break;
      case "open-bank": go("bank"); break;
      case "bank-book": ui.bank.book = actionEl.dataset.book; ui.bank.letter = "全部"; render(); break;
      case "bank-letter": ui.bank.letter = actionEl.dataset.letter; render(); break;
      case "bank-freq": ui.bank.freq = actionEl.dataset.freq; render(); break;
      case "bank-sort": ui.bank.sort = ui.bank.sort === "freq" ? "alpha" : "freq"; render(); break;
      case "bank-toggle-new": ui.bank.onlyNew = !ui.bank.onlyNew; render(); break;
      case "bank-clear-q": ui.bank.q = ""; render(); break;
      case "bank-reset": ui.bank = { book: ui.bank.book, q: "", letter: "全部", onlyNew: false, freq: "all", sort: "alpha" }; render(); break;
      case "bank-add": addBankWordAndRefresh(actionEl.dataset.book, actionEl.dataset.term); break;
      case "bank-add-all": {
        const list = bankFiltered();
        if (!list.length) break;
        if (!window.confirm(`把当前筛选出的 ${list.length} 个词加入生词本？（已在生词本里的会自动跳过）`)) break;
        addBankBulk(ui.bank.book, list.map((w) => w.term));
        break;
      }
      case "import-bank": importBank(actionEl.dataset.level); break;
      case "set-scope": applyScope(actionEl.dataset.scopeValue); break;
      case "pick": answerChoice(id); break;
      case "submit-spell": submitSpell(); break;
      case "next-question": nextQuestion(); break;
      case "quit-quiz": ui.quiz = null; render(); break;
      default: break;
    }
  });

  document.addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"][data-action="select-one"]');
    if (cb) {
      if (cb.checked) ui.selected.add(cb.dataset.id);
      else ui.selected.delete(cb.dataset.id);
      render();
      return;
    }
    const imp = e.target.closest('#importPreview input[type="checkbox"][data-idx]');
    if (imp) {
      const idx = Number(imp.dataset.idx);
      if (ui.importRows[idx]) ui.importRows[idx].checked = imp.checked;
      renderImportPreview();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const dlg = document.querySelector("dialog[open]");
      if (dlg) closeDialog(dlg);
    }
    if (e.key === "Enter" && e.ctrlKey && ui.tab === "add") {
      const form = $("#addForm");
      if (form && document.activeElement && form.contains(document.activeElement)) {
        e.preventDefault();
        saveFromAddForm();
      }
    }
  });

  $("#editForm").addEventListener("submit", submitEdit);
  $("#importConfirm").addEventListener("click", doImport);
  $("#settingsForm").addEventListener("submit", submitSettings);
  $("#resetDataBtn").addEventListener("click", resetAllData);
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#themeToggle").addEventListener("click", toggleTheme);

  function reviewOne(id) {
    const w = state.words.find((x) => x.id === id);
    if (!w) return;
    ui.review = { queue: [w], pos: 0, revealed: false, rated: 0, good: 0, left: 0, done: false, undo: null, exZhMap: {} };
    ui.tab = "review";
    save();
    location.hash = "review";
    render();
  }

  function openExportMenu() {
    const dlg = document.createElement("dialog");
    dlg.className = "modal";
    dlg.innerHTML = `<div class="modal-inner">
      <div class="modal-head"><h2>导出与备份</h2><button class="icon-btn" data-close-dialog aria-label="关闭">✕</button></div>
      <p class="modal-desc">建议定期导出备份。JSON 保留复习进度，CSV 适合用 Excel 查看和编辑。</p>
      <div style="display:flex;flex-direction:column;gap:9px">
        <button class="btn btn-primary btn-block" data-action="export-json">导出 JSON（含复习进度）</button>
        <button class="btn btn-block" data-action="export-csv">导出 CSV（Excel 可读）</button>
        <button class="btn btn-block" data-action="export-template">下载 CSV 导入模板</button>
        <button class="btn btn-ghost btn-block" data-close-dialog>取消</button>
      </div>
    </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    openDialog(dlg);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) closeDialog(dlg);
    });
  }

  function startVoiceInput() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("当前浏览器不支持语音输入，请手动输入", "err"); return; }
    const btn = $("#voiceBtn");
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      btn.textContent = "🎙 聆听中…";
      rec.onresult = (ev) => {
        const text = ev.results[0][0].transcript || "";
        $("#fTerm").value = text.trim();
        $("#fTerm").dispatchEvent(new Event("input"));
      };
      rec.onerror = () => toast("没有听清，再试一次", "err");
      rec.onend = () => { btn.textContent = "🎙 语音输入"; };
      rec.start();
    } catch (err) {
      toast("语音输入启动失败", "err");
    }
  }

  /* ==========================================================
     17. 主题 / 初始化
     ========================================================== */
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  }

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#14161b" : "#f7f5ef");
  }

  function initTheme() {
    let t = "";
    try { t = localStorage.getItem(THEME_KEY) || ""; } catch (e) {}
    if (!t) {
      t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(t);
  }

  function initTabsFromHash() {
    const h = (location.hash || "").replace("#", "");
    let t = TABS.includes(h) ? h : (TABS.includes(state.lastTab) ? state.lastTab : "home");
    if (t === "settings") t = "home";
    ui.tab = t;
    if (state.words.length === 0 && !state.settings.seeded) seedSample();
    if (h && TABS.includes(h)) ui.tab = h;
  }

  function boot() {
    initTheme();
    initTabsFromHash();
    // 语音列表是异步加载的
    if ("speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = populateVoices;
      window.speechSynthesis.getVoices();
    }
    // 语音输入按钮只在支持的浏览器显示
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const btn = $("#voiceBtn");
      if (btn) btn.hidden = false;
    }
    document.addEventListener("keydown", reviewKeyHandler);
    document.addEventListener("keydown", learnKeyHandler);
    $$("dialog.modal").forEach((dlg) => {
      dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(dlg); });
    });
    render();
    window.addEventListener("hashchange", () => {
      const h = (location.hash || "").replace("#", "");
      if (TABS.includes(h) && h !== ui.tab) {
        ui.tab = h;
        if (h !== "review") ui.review = null;
        render();
      }
    });
    // 每 60 秒刷新一次，让“下次复习”等相对时间保持准确
    setInterval(() => {
      if (ui.tab === "home" || (ui.tab === "review" && !ui.review)) render();
    }, 60000);
    window.addEventListener("beforeunload", saveNow);

    /* PWA：注册 service worker（仅在 https/localhost 下生效，file:// 自动跳过） */
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch((e) => console.warn("SW 注册失败", e));
      });
    }

    /* 手机端滑动手势：复习卡左滑=忘记，右滑=很简单；学习卡左滑=不认识，右滑=认识
       防误触：如果触摸起点在按钮/链接上，不触发滑动评分（让按钮自己响应点击） */
    let touchX = 0, touchY = 0, touchEl = null, touchOnInteractive = false;
    document.addEventListener("touchstart", (e) => {
      const fc = e.target.closest && e.target.closest(".flashcard");
      if (!fc) { touchEl = null; return; }
      touchEl = fc;
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
      /* 起点在按钮/链接/输入框上，本次触摸不触发滑动 */
      touchOnInteractive = !!(e.target.closest && e.target.closest("button, a, input, textarea, .fc-speak, .rate-btn, .learn-btn"));
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (!touchEl) return;
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      touchEl = null;
      if (touchOnInteractive) { touchOnInteractive = false; return; }
      /* 纵向滑动 > 横向，不干预滚动；横向位移太小也不触发 */
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (ui.tab === "review" && ui.review && !ui.review.done) {
        if (!ui.review.revealed) {
          ui.review.revealed = true;
          render();
          const w = ui.review.queue[ui.review.pos]; if (w) speak(w.term);
          return;
        }
        if (dx < 0) gradeCurrent(1);
        else gradeCurrent(4);
      } else if (ui.tab === "learn" && ui.learn && !ui.learn.done) {
        if (ui.learn.mode === "front") learnAnswer(dx > 0);
      }
    }, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
