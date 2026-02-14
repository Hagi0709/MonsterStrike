// モンスト EXPカレンダー（累計入力→増加量表示）- app.js
(() => {
  const STORAGE_KEY = "monst_cumxp_v2";

  /** @type {Record<string, number>} 累計経験値 */
  let cum = load();

  // UI state
  let viewDate = new Date();         // 表示月
  let selected = toYMD(new Date());  // 選択日
  let animating = false;

  // Elements
  const monthLabel = document.getElementById("monthLabel");
  const gridWrap = document.getElementById("gridWrap");
  let calendarGrid = document.getElementById("calendarGrid"); // current grid
  const monthTotalEl = document.getElementById("monthTotal");

  const menuBtn = document.getElementById("menuBtn");
  const selectedDateEl = document.getElementById("selectedDate");
  const cumInput = document.getElementById("cumInput");
  const previewEl = document.getElementById("preview");
  const saveBtn = document.getElementById("saveBtn");
  const deleteBtn = document.getElementById("deleteBtn");

  const menuDialog = document.getElementById("menuDialog");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const todayBtn = document.getElementById("todayBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");
  const wipeBtn = document.getElementById("wipeBtn");

  const toast = document.getElementById("toast");

  // ズーム抑止（iOS）
  document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

  // Init
  const now = new Date();
  viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
  renderNoAnim();
  syncInline();

  // --- Swipe month change (with animation) ---
  let touchX = null;
  let touchY = null;

  gridWrap.addEventListener("touchstart", (e) => {
    if (entryDialog.open || menuDialog.open) return;
    const t = e.changedTouches[0];
    touchX = t.clientX;
    touchY = t.clientY;
  }, { passive: true });

  gridWrap.addEventListener("touchend", (e) => {
    if (entryDialog.open || menuDialog.open) return;
    if (touchX == null || touchY == null) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    touchX = null; touchY = null;

    // 縦スクロール誤爆を抑える
    if (Math.abs(dx) < 42) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.7) return;

    if (dx < 0) changeMonth(1);   // 左→次
    else changeMonth(-1);         // 右→前
  }, { passive: true });

  // Events
  menuBtn.addEventListener("click", () => menuDialog.showModal());

  prevBtn.addEventListener("click", () => changeMonth(-1));
  nextBtn.addEventListener("click", () => changeMonth(1));

  todayBtn.addEventListener("click", () => {
    const t = new Date();
    viewDate = new Date(t.getFullYear(), t.getMonth(), 1);
    selected = toYMD(t);
    renderNoAnim();
    syncInline();
    menuDialog.close();
  });
  // 仕様変更：日付を選択 → 下の入力欄で直接入力（FABなし）
  saveBtn.addEventListener("click", () => {
    const n = normalizeNumber(cumInput.value);
    if (n === null) { showToast("数字だけ（例: 123456789）"); return; }
    if (n === 0) {
      delete cum[selected];
      persist();
      showToast("削除しました");
      renderNoAnim();
      return;
    }
    cum[selected] = n;
    persist();
    showToast("保存しました");
    renderNoAnim();
  });

  deleteBtn.addEventListener("click", () => {
    if (cum[selected] == null) { showToast("この日は記録なし"); return; }
    delete cum[selected];
    persist();
    showToast("削除しました");
    renderNoAnim();
  });

  // 入力しながら3桁カンマ
  cumInput.addEventListener("input", () => {
    formatNumberInput(cumInput);
    updatePreview();
  });

  exportBtn.addEventListener("click", () => {
    const payload = {
      app: "monst-exp-calendar",
      version: 5,
      exportedAt: new Date().toISOString(),
      cumulative: cum
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monst_cumxp_${toYMD(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("エクスポートしました");
    menuDialog.close();
  });

  importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const imported = (json && (json.cumulative || json.data) && typeof (json.cumulative || json.data) === "object")
        ? (json.cumulative || json.data)
        : null;
      if (!imported) throw new Error("invalid");

      const cleaned = {};
      for (const [k, v] of Object.entries(imported)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
        const num = typeof v === "number" ? v : normalizeNumber(String(v));
        if (num && num > 0) cleaned[k] = num;
      }
      cum = { ...cum, ...cleaned };
      persist();
      showToast("インポートしました");
      menuDialog.close();
      renderNoAnim();
    } catch {
      showToast("インポート失敗（JSON確認）");
    } finally {
      importInput.value = "";
    }
  });

  wipeBtn.addEventListener("click", () => {
    cum = {};
    persist();
    showToast("全データ削除");
    menuDialog.close();
    renderNoAnim();
  });

  // ---- Month change with slide animation ----
  function changeMonth(delta) {
    if (animating) return;
    viewDate = addMonths(viewDate, delta);
    renderAnimated(delta > 0 ? "next" : "prev");
  }

  function renderAnimated(dir) {
  animating = true;

  monthLabel.textContent = `${viewDate.getFullYear()}年 ${viewDate.getMonth() + 1}月`;

  const deltaMap = buildDeltaMap(cum);

  const newGrid = document.createElement("div");
  newGrid.className = "grid grid-anim " + (dir === "next" ? "grid-enter-right" : "grid-enter-left");
  fillGrid(newGrid, viewDate, deltaMap);

  // old grid animate out
  calendarGrid.classList.add("grid-anim");
  calendarGrid.classList.remove("grid-current");
  calendarGrid.classList.add(dir === "next" ? "grid-exit-left" : "grid-exit-right");

  gridWrap.appendChild(newGrid);

  // 合計更新（その月の増加合計）
  monthTotalEl.textContent = formatInt(sumMonthDelta(viewDate, deltaMap));

  requestAnimationFrame(() => {
    newGrid.classList.remove(dir === "next" ? "grid-enter-right" : "grid-enter-left");
    newGrid.classList.add("grid-current");

    // newGridがDOMに入って幅が確定してから縮小
    applyFits(newGrid);
    fitText(monthTotalEl, 22, 12);
  });

  const cleanup = () => {
    try { calendarGrid.remove(); } catch {}
    calendarGrid = newGrid;
    animating = false;
  };
  newGrid.addEventListener("transitionend", cleanup, { once: true });
}

function renderNoAnim() {
  monthLabel.textContent = `${viewDate.getFullYear()}年 ${viewDate.getMonth() + 1}月`;

  const deltaMap = buildDeltaMap(cum);
  calendarGrid.className = "grid grid-current";
  calendarGrid.innerHTML = "";
  fillGrid(calendarGrid, viewDate, deltaMap);

  monthTotalEl.textContent = formatInt(sumMonthDelta(viewDate, deltaMap));

  // DOM上で幅が確定してから縮小
  requestAnimationFrame(() => {
    applyFits(calendarGrid);
    fitText(monthTotalEl, 22, 12);
  });
}

  // ---- Grid fill ----
  function fillGrid(targetGrid, monthDate, deltaMap) {
    const cells = buildCalendarCells(monthDate);
    const todayYMD = toYMD(new Date());

    for (const c of cells) {
      const cell = document.createElement("div");
      cell.className = "day";

      if (c.out) cell.classList.add("out");
      if (c.dow === 0) cell.classList.add("sun");
      if (c.ymd === todayYMD) cell.classList.add("today");
      if (c.ymd === selected) cell.classList.add("selected");

      const dn = document.createElement("div");
      dn.className = "dnum";
      dn.textContent = String(c.day);
      cell.appendChild(dn);

      const d = deltaMap[c.ymd];
      const exp = document.createElement("div");
      exp.className = "exp";

if (typeof d === "number") {
  if (d < 0) exp.classList.add("neg");
  exp.textContent = formatSignedInt(d);

  // ※ newGrid（アニメ用）はDOMに入る前だと幅が取れず縮小に失敗するので、
  //    ここではフラグだけ付けて、DOM挿入後にまとめてfitTextする
  exp.dataset.fit = "1";
  exp.dataset.fitBase = "18";
  exp.dataset.fitTemplate = "+XXX,XXX,XXX";
  exp.dataset.fitMin = "10";
} else {
  exp.style.visibility = "hidden";
  exp.textContent = "0";
}
      cell.appendChild(exp);

      cell.addEventListener("click", () => {
        const dt = ymdToDate(c.ymd);
        if (dt.getMonth() !== viewDate.getMonth() || dt.getFullYear() !== viewDate.getFullYear()) {
          viewDate = new Date(dt.getFullYear(), dt.getMonth(), 1);
        }
        openEntry(c.ymd);
        renderNoAnim();
      });

      targetGrid.appendChild(cell);
    }
  }

  // ---- Entry ----
  function syncInline(){
    selectedDateEl.textContent = selected;
    cumInput.value = cum[selected] != null ? formatInt(cum[selected]) : "";
    updatePreview();
  }

  function openEntry(ymd) {
    // 直接入力：選択日を下の入力欄に反映するだけ
    selected = ymd;
    selectedDateEl.textContent = selected;
    cumInput.value = cum[selected] != null ? formatInt(cum[selected]) : "";
    updatePreview();
    focusInlineInput();
  }

  function updatePreview() {
    const n = normalizeNumber(cumInput.value);
    if (n === null) { previewEl.textContent = "--"; return; }
    if (n === 0) { previewEl.textContent = "削除"; return; }

    const prev = findPrevCumulative(selected, cum);
    if (!prev) { previewEl.textContent = "前回記録なし（増加量は表示されません）"; return; }

    const diff = n - prev.value;
    const sign = diff >= 0 ? "+" : "−";
    const cls = diff >= 0 ? "plus" : "neg";
    previewEl.innerHTML = `前回(${prev.date})との差：<span class="${cls}">${sign}${formatInt(Math.abs(diff))}</span>`;
  }

  // ---- Data to delta ----
  function buildDeltaMap(cumulative) {
    const keys = Object.keys(cumulative).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
    keys.sort();

    const delta = {};
    let prevKey = null;
    for (const k of keys) {
      const v = cumulative[k];
      if (typeof v !== "number") continue;
      if (prevKey != null) {
        const pv = cumulative[prevKey];
        if (typeof pv === "number") delta[k] = v - pv;
      }
      prevKey = k;
    }
    return delta;
  }

  function findPrevCumulative(dateKey, cumulative) {
    const keys = Object.keys(cumulative).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
    keys.sort();
    let prev = null;
    for (const k of keys) {
      if (k < dateKey) prev = k;
      if (k >= dateKey) break;
    }
    if (!prev) return null;
    return { date: prev, value: cumulative[prev] };
  }

  function sumMonthDelta(d, deltaMap) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const prefix = `${y}-${pad2(m)}`;
    let s = 0;
    for (const [k, v] of Object.entries(deltaMap)) {
      if (k.startsWith(prefix) && typeof v === "number") s += v;
    }
    return s;
  }

  // ---- Calendar cells ----
  function buildCalendarCells(d) {
    const year = d.getFullYear();
    const month = d.getMonth();
    const first = new Date(year, month, 1);

    const startOffset = first.getDay(); // Sunday=0
    const start = new Date(year, month, 1 - startOffset);

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      cells.push({ ymd: toYMD(cur), day: cur.getDate(), out: cur.getMonth() !== month, dow: cur.getDay() });
    }
    return cells;
  }

  // ---- Storage ----
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(cum)); }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return {};
      const cleaned = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
        if (typeof v === "number" && Number.isFinite(v) && v > 0) cleaned[k] = Math.floor(v);
      }
      return cleaned;
    } catch { return {}; }
  }

  // ---- Input comma formatting ----
  function formatNumberInput(inputEl){
    const raw = inputEl.value;
    const selStart = inputEl.selectionStart ?? raw.length;

    let digitsLeft = 0;
    for (let i = 0; i < selStart; i++){
      const ch = raw[i];
      if (ch >= "0" && ch <= "9") digitsLeft++;
    }

    const digits = raw.replace(/[^0-9]/g, "");
    const formatted = digits === "" ? "" : Number(digits).toLocaleString("ja-JP");
    inputEl.value = formatted;

    let pos = formatted.length;
    if (digitsLeft === 0) pos = 0;
    else {
      let count = 0;
      for (let i = 0; i < formatted.length; i++){
        const ch = formatted[i];
        if (ch >= "0" && ch <= "9") count++;
        if (count >= digitsLeft){ pos = i + 1; break; }
      }
    }
    try { inputEl.setSelectionRange(pos, pos); } catch {}
  }

// ---- Fit text (shrink font; keep columns fixed) ----
function applyFits(scopeEl){
  const list = scopeEl.querySelectorAll('.exp[data-fit="1"]');
  list.forEach(el => {
    const basePx = Number(el.dataset.fitBase || 16);
    const minPx  = Number(el.dataset.fitMin || 10);
    const tpl    = (el.dataset.fitTemplate || "").trim();
    fitText(el, basePx, minPx, tpl || null);
  });
}

function fitText(el, basePx, minPx, templateStr){
  // リセット
  el.style.transform = "";
  el.style.transformOrigin = "center";
  el.style.fontSize = basePx + "px";

  const txt = (el.textContent || "").trim();
  if (!txt) return;

  // iOS Safariで計測がズレるのを避ける（強制レイアウト）
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;

  // テンプレ（例: +XXX,XXX,XXX）が指定されている場合は
  // まずテンプレが「1枠に収まる最大フォント」を基準にする
  const tpl = (templateStr && String(templateStr).trim()) ? String(templateStr).trim() : null;

  if (tpl) {
    const cs = getComputedStyle(el);
    const family = cs.fontFamily || "system-ui";
    const weight = cs.fontWeight || "900";

    const canvas = fitText._c || (fitText._c = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");

    const measure = (s, size) => {
      ctx.font = `${weight} ${size}px ${family}`;
      return ctx.measureText(s).width;
    };

    let low = minPx, high = basePx, best = minPx;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const w = measure(tpl, mid);
      if (w <= el.clientWidth) { best = mid; low = mid + 1; }
      else { high = mid - 1; }
    }

    el.style.fontSize = best + "px";
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;

    // 実値がテンプレより長い等で溢れた場合だけ、scaleXで押し込む
    if (el.scrollWidth > el.clientWidth) {
      const ratio = el.clientWidth / el.scrollWidth;
      const scale = Math.max(0.72, Math.min(1, ratio));
      el.style.transform = `scaleX(${scale})`;
    }
    return;
  }

  // --- テンプレ無し（従来動作） ---
  const fits = (size) => {
    el.style.fontSize = size + "px";
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    return el.scrollWidth <= el.clientWidth;
  };

  let low = minPx, high = basePx, best = minPx;

  if (fits(high)) {
    best = high;
  } else {
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(mid)) { best = mid; low = mid + 1; }
      else { high = mid - 1; }
    }
  }

  el.style.fontSize = best + "px";
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;

  if (el.scrollWidth > el.clientWidth) {
    const ratio = el.clientWidth / el.scrollWidth;
    const scale = Math.max(0.72, Math.min(1, ratio));
    el.style.transform = `scaleX(${scale})`;
  }
}

  // ---- Utils ----
  function toYMD(date) {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
  }
  function pad2\(n\)\{ return String\(n\)\.padStart\(2, "0"\); \}

  function focusInlineInput(){
    try { cumInput && cumInput.focus(); } catch {}
  }

  function addMonths(date, delta) {
    const y = date.getFullYear();
    const m = date.getMonth();
    return new Date(y, m + delta, 1);
  }

  function normalizeNumber(s) {
    const t = (s ?? "").toString().trim();
    if (t === "") return 0;
    if (!/^\d[\d,]*$/.test(t)) return null;
    const digits = t.replace(/,/g, "");
    if (digits === "") return 0;
    const n = Number(digits);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
  }

  function formatInt(n) { return Number(n).toLocaleString("ja-JP"); }
  function formatSignedInt(n) {
    const sign = n >= 0 ? "+" : "−";
    return sign + formatInt(Math.abs(n));
  }

  function showToast(msg) {
    toast.textContent = msg;
    if (!toast.open) toast.showModal();
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { try { toast.close(); } catch {} }, 1100);
  }
})();