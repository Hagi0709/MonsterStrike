// モンスト EXPカレンダー（累計入力→増加量表示）- app.js
(() => {
  const STORAGE_KEY = "monst_cumxp_v2";
  let currentCumXPGlobal = 0;

  /** @type {Record<string, number>} 累計経験値 */
  let cum = load();

  /** @type {{rank:number,xp:number}[]} ランクテーブル（csv: 左=ランク, 右=累計経験値） */
  let rankTable = [];
  let rankTableReady = false;
  let rankXpMap = new Map();

  async function loadRankTable(){
    try{
      const res = await fetch("rank_table.csv", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      rankTable = [];
      const rows = text
        .trim()
        .split(/\r?\n/)
        .map(line => {
          const [r, x] = line.split(",");
          return { rank: Number(r), xp: Number(x) };
        })
        .filter(v => Number.isFinite(v.rank) && Number.isFinite(v.xp));

      // rank -> xp（累計）に正規化
      const rankXp = new Map();

for (const row of rows) {
        rankXp.set(Math.floor(row.rank), Math.floor(row.xp));
      }
      // ---- 規則性による補完 ----
      // 前提：
      // - CSVは「左=ランク」「右=累計経験値」
      // - 1501-2000 は (1499->1500 の差分)×3 を 1ランク必要EXPとして一定
      // - 2001-2500 は (1999->2000 の差分)×3 を一定
      // - 2501以降も「500ランク区間ごとに」(区切りランクの直前差分)×3 を一定として継続
      //
      // 例：
      // 2501-3000 : (2499->2500)×3
      // 3001-3500 : (2999->3000)×3 = (2501-3000 の一定差分)×3
      // …を繰り返す

      const MAX_RANK = 20000;

      const get = (r) => rankXp.get(r);
      const set = (r, xp) => rankXp.set(r, Math.floor(xp));

      // 1501-2000
      const xp1499 = get(1499);
      const xp1500 = get(1500);
      if (Number.isFinite(xp1499) && Number.isFinite(xp1500)) {
        const d1500 = xp1500 - xp1499;     // 1499->1500 の必要EXP
        const step1500 = d1500 * 3;        // 1501-2000 の一定差分
        for (let r = 1501; r <= 2000; r++) {
          if (!rankXp.has(r)) set(r, xp1500 + (r - 1500) * step1500);
        }
      }

      // 2001-2500
      const xp1999 = get(1999);
      const xp2000 = get(2000);
      if (Number.isFinite(xp1999) && Number.isFinite(xp2000)) {
        const d2000 = xp2000 - xp1999;     // 1999->2000 の必要EXP
        const step2000 = d2000 * 3;        // 2001-2500 の一定差分
        for (let r = 2001; r <= 2500; r++) {
          if (!rankXp.has(r)) set(r, xp2000 + (r - 2000) * step2000);
        }
      }

      // 2501以降（500ランク区間ごとに step を3倍）
      const xp2499 = get(2499);
      const xp2500 = get(2500);
      if (Number.isFinite(xp2499) && Number.isFinite(xp2500)) {
        let baseRank = 2500;
        let baseXp = xp2500;

        // 2501-3000 の一定差分 = (2499->2500)×3
        let step = (xp2500 - xp2499) * 3;

        while (baseRank < MAX_RANK) {
          const blockEnd = Math.min(baseRank + 500, MAX_RANK);

          for (let r = baseRank + 1; r <= blockEnd; r++) {
            if (!rankXp.has(r)) set(r, baseXp + (r - baseRank) * step);
          }

          // 次ブロックの基準点を更新
          baseXp = get(blockEnd);
          baseRank = blockEnd;

          // 次の500区間は「区切り直前差分×3」なので、stepを3倍
          step = step * 3;
        }
      }



      // rankTable（xp昇順）
      rankTable = Array.from(rankXp.entries())
        .map(([rank, xp]) => ({ rank, xp }))
        .filter(v => Number.isFinite(v.rank) && Number.isFinite(v.xp))
        .sort((a, b) => a.xp - b.xp);

      rankTableReady = rankTable.length > 0;
      rankXpMap = new Map(rankXp);
    } catch (e) {
      console.error("rank_table.csv 読み込み失敗", e);
      rankTable = [];
      rankTableReady = false;
    }
  }

  function getRankFromXP(xp){
    if (!rankTableReady) return null;
    const v = Math.max(0, Math.floor(Number(xp) || 0));

    // 二分探索：xp以下の最大rank
    let low = 0;
    let high = rankTable.length - 1;
    let result = rankTable[0]?.rank ?? 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (rankTable[mid].xp <= v) {
        result = rankTable[mid].rank;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  // UI state
  let viewDate = new Date();         // 表示月
  let selected = toYMD(new Date());  // 選択日
  let animating = false;

  // Elements
  let targetBtn=null, targetLabelEl=null, targetNeedEl=null, targetRingEl=null, targetPctEl=null;

  // ---- Target Rank ----
  let targetRank = Number(localStorage.getItem("targetRank") || 0) || 0;

  function formatComma(n){
    if(!Number.isFinite(n)) return "--";
    return Math.trunc(n).toLocaleString("ja-JP");
  }

  function getCumXPByRank(r){
    if(!Number.isFinite(r) || r<=0) return null;
    const v = rankXpMap.get(Math.floor(r));
    return Number.isFinite(v) ? v : null;
  }

  function setRingProgress(pct){
    if(!targetRingEl || !targetPctEl) return;

    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));

    // 0%に見えて固定化したように感じるのを防ぐ（小さい進捗は小数で表示）
    let label;
    if (clamped > 0 && clamped < 1) label = clamped.toFixed(1);
    else label = String(Math.round(clamped));
    targetPctEl.textContent = label + "%";

    const r = 16;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - clamped / 100);

    const bar = targetRingEl.querySelector(".ring-bar");
    if(bar){
      bar.style.strokeDasharray = String(c);
      bar.style.strokeDashoffset = String(offset);
    }
    targetRingEl.style.visibility = "visible";
    targetPctEl.style.visibility = "visible";
  }

  function updateTargetUI(currentCumXP){
    if(!targetLabelEl || !targetNeedEl) return;

    const hide = () => {
      if(targetRingEl) targetRingEl.style.visibility = "hidden";
      if(targetPctEl)  targetPctEl.style.visibility  = "hidden";
    };

    if(!targetRank){
      targetLabelEl.textContent = "目標 --";
      targetNeedEl.textContent = "必要EXP --";
      hide();
      return;
    }

    targetLabelEl.textContent = `目標 ${targetRank}`;
    const targetCum = getCumXPByRank(targetRank);
    if(targetCum == null || !Number.isFinite(currentCumXP)){
      targetNeedEl.textContent = "必要EXP --";
      hide();
      return;
    }

    const need = Math.max(0, targetCum - currentCumXP);
    targetNeedEl.textContent = `必要EXP ${formatComma(need)}`;

    const pct = (targetCum > 0) ? (Math.max(0, Math.min(1, currentCumXP / targetCum)) * 100) : 0;
    setRingProgress(pct);
  }

  function promptTargetRank(){
    const cur = targetRank ? String(targetRank) : "";
    const input = prompt("目標ランクを入力してください（例: 3000）", cur);
    if(input == null) return;
    const v = Number(String(input).replace(/[^\d]/g,""));
    if(!Number.isFinite(v) || v<=0){
      targetRank = 0;
      localStorage.removeItem("targetRank");
    }else{
      targetRank = Math.floor(v);
      localStorage.setItem("targetRank", String(targetRank));
    }
    updateTargetUI(currentCumXPGlobal || 0);
  }

  const monthLabel = document.getElementById("monthLabel");
  const gridWrap = document.getElementById("gridWrap");
  let calendarGrid = document.getElementById("calendarGrid"); // current grid
  const monthTotalEl = document.getElementById("monthGain");
  const cumTotalEl = document.getElementById("cumTotal");

  const menuBtn = document.getElementById("menuBtn");
const entryDialog = document.getElementById("entryDialog");
  const selectedDateEl = document.getElementById("selectedDate");
  const cumInput = document.getElementById("cumInput");

  targetBtn = document.getElementById("targetBtn");
  targetLabelEl = document.getElementById("targetLabel");
  targetNeedEl = document.getElementById("targetNeed");
    targetRingEl = document.getElementById("targetRing");
    targetPctEl = document.getElementById("targetPct");

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
  function syncInlineOnInit(){
    // 初期表示でスクロールが動かないように、フォーカス無しで同期
    selectedDateEl.textContent = formatJPDate(selected);
    cumInput.value = cum[selected] != null ? formatInt(cum[selected]) : "";
    updateRealtime();
  }

  const now = new Date();
  viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
  renderNoAnim();
  syncInlineOnInit();

  // ランクテーブル読み込み（読み込み後に再描画して各日付にランクを表示）
  loadRankTable().then(() => {
    renderNoAnim();
    updateTargetUI(currentCumXPGlobal||0);
  });

  if (targetBtn) targetBtn.addEventListener("click", promptTargetRank);

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
  if (menuBtn) menuBtn.addEventListener("click", () => menuDialog.showModal());

  prevBtn.addEventListener("click", () => changeMonth(-1));
  nextBtn.addEventListener("click", () => changeMonth(1));

  todayBtn.addEventListener("click", () => {
    const t = new Date();
    viewDate = new Date(t.getFullYear(), t.getMonth(), 1);
    selected = toYMD(t);
    renderNoAnim();
    syncInlineOnInit();
    menuDialog.close();
  });
  // 仕様変更：保存/削除ボタンは廃止。入力と同時に自動反映・自動保存。

  // 入力しながら3桁カンマ
  cumInput.addEventListener("input", () => {
    const caret = cumInput.selectionStart ?? 0;
    formatNumberInput(cumInput);

    const n = normalizeNumber(cumInput.value);
    if (n === null) return;

    if (n === 0) delete cum[selected];
    else cum[selected] = n;

    persist();
    renderNoAnim();

    try { cumInput.setSelectionRange(caret, caret); } catch {}
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
  fillGrid(newGrid, viewDate, deltaMap, cum);

  // old grid animate out
  calendarGrid.classList.add("grid-anim");
  calendarGrid.classList.remove("grid-current");
  calendarGrid.classList.add(dir === "next" ? "grid-exit-left" : "grid-exit-right");

  gridWrap.appendChild(newGrid);

  // 合計更新（その月の増加合計 / 最新累計）
  monthTotalEl.textContent = `獲得EXP ${formatInt(sumMonthDelta(viewDate, deltaMap))}`;
  if (cumTotalEl) cumTotalEl.textContent = `累計EXP ${formatInt(getLatestCumulativeValue(cum))}`;

  const latestCum = getLatestCumulativeValue(cum);
  currentCumXPGlobal = latestCum;
  updateTargetUI(latestCum);

  requestAnimationFrame(() => {
    newGrid.classList.remove(dir === "next" ? "grid-enter-right" : "grid-enter-left");
    newGrid.classList.add("grid-current");

    // newGridがDOMに入って幅が確定してから縮小
    applyFits(newGrid);
    syncHeaderFont();
    syncTopLeftFont();
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
  fillGrid(calendarGrid, viewDate, deltaMap, cum);

  monthTotalEl.textContent = `獲得EXP ${formatInt(sumMonthDelta(viewDate, deltaMap))}`;
  if (cumTotalEl) cumTotalEl.textContent = `累計EXP ${formatInt(getLatestCumulativeValue(cum))}`;

  const latestCum = getLatestCumulativeValue(cum);
  currentCumXPGlobal = latestCum;
  updateTargetUI(latestCum);

  // DOM上で幅が確定してから縮小
  requestAnimationFrame(() => {
    applyFits(calendarGrid);
    syncHeaderFont();
    syncTopLeftFont();
  });
}

  // ---- Grid fill ----
  function fillGrid(targetGrid, monthDate, deltaMap, cumulativeMap) {
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

      // ランク表示（累計EXPが入力されている日だけ表示）
      const rk = document.createElement("div");
      rk.className = "rank";
      const cv = cumulativeMap ? cumulativeMap[c.ymd] : null;
      if (rankTableReady && typeof cv === "number") {
        const r = getRankFromXP(cv);
        rk.textContent = r != null ? String(r) : "";
      } else {
        // 高さ固定のためvisibilityで隠す
        rk.style.visibility = "hidden";
        rk.textContent = "0";
      }
      cell.appendChild(rk);

      const d = deltaMap[c.ymd];
      const exp = document.createElement("div");
      exp.className = "exp";

if (typeof d === "number") {
  if (d < 0) exp.classList.add("neg");
  exp.textContent = formatSignedInt(d);

  // ※ newGrid（アニメ用）はDOMに入る前だと幅が取れず縮小に失敗するので、
  //    ここではフラグだけ付けて、DOM挿入後にまとめてfitTextする
  exp.dataset.fit = "1";
  exp.dataset.fitBase = "10";
  exp.dataset.fitTemplate = "+XXX,XXX,XXX";
  exp.dataset.fitMin = "6";
} else {
  exp.style.visibility = "hidden";
  exp.textContent = "0";
}
      cell.appendChild(exp);

      cell.addEventListener("click", () => {
        selected = c.ymd;
        renderNoAnim();
        // 選択日を下の入力欄に反映
        openEntry(selected);
      });
targetGrid.appendChild(cell);
    }
  }

  // ---- Entry ----
  function openEntry(ymd) {
    selected = ymd;
    selectedDateEl.textContent = formatJPDate(selected);
    cumInput.value = cum[selected] != null ? formatInt(cum[selected]) : "";
    updateRealtime();
    /* モーダルは使わない */
    setTimeout(() => cumInput.focus(), 60);
}

  function updateRealtime() {
  selectedDateEl.textContent = formatJPDate(selected);
  const deltaMap = buildDeltaMap(cum);

  monthTotalEl.textContent = `獲得EXP ${formatInt(sumMonthDelta(viewDate, deltaMap))}`;
  if (cumTotalEl) cumTotalEl.textContent = `累計EXP ${formatInt(getLatestCumulativeValue(cum))}`;

  const latestCum = getLatestCumulativeValue(cum);
  currentCumXPGlobal = latestCum;
  updateTargetUI(latestCum);

  requestAnimationFrame(() => {
    syncHeaderFont();
    syncTopLeftFont();
  });
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

  function getLatestCumulativeValue(cumulative){
    const keys = Object.keys(cumulative).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
    keys.sort();
    if (!keys.length) return 0;
    const lastKey = keys[keys.length - 1];
    const v = cumulative[lastKey];
    return (typeof v === "number" && Number.isFinite(v)) ? v : 0;
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



function syncTopLeftFont(){
  // 左上（目標/必要EXP）が長い時に、上部のセンター領域と被らないよう縮小
  const wrap = document.querySelector(".top-left");
  if(!wrap) return;
  const btn = document.getElementById("targetBtn");
  if(!btn) return;

  const maxW = wrap.clientWidth;
  btn.style.fontSize = ""; // reset

  // ざっくり縮小（12px→9px）
  let size = 12;
  while (size >= 9) {
    btn.style.fontSize = size + "px";
    // eslint-disable-next-line no-unused-expressions
    btn.offsetWidth;
    if (btn.scrollWidth <= maxW) break;
    size--;
  }
}
function syncHeaderFont(){
  // 「累計EXP」と「獲得EXP」を同じ文字サイズに固定しつつ、
  // 1行に収まる範囲で少し小さめにする
  const base = 16;
  const min  = 10;

  // monthTotalEl を基準に計算（幅は同じレイアウトなので、同じサイズを適用）
  const best = calcFitFont(monthTotalEl, base, min, "獲得EXP 9,999,999,999");

  monthTotalEl.style.transform = "";
  monthTotalEl.style.transformOrigin = "center";
  monthTotalEl.style.fontSize = best + "px";

  if (cumTotalEl) {
    cumTotalEl.style.transform = "";
    cumTotalEl.style.transformOrigin = "center";
    cumTotalEl.style.fontSize = best + "px";
  }
}

// ---- Fit text (shrink font; keep columns fixed) ----
function applyFits(scopeEl){
  const list = scopeEl.querySelectorAll('.exp');
  if(!list.length) return;
  list.forEach(el=>{
    // 自動で全文表示できるようfitTextを使用
    fitText(el,10,6,"+XXX,XXX,XXX");
  });
}


function calcFitFont(el, basePx, minPx, templateStr){
  const cs = getComputedStyle(el);
  const family = cs.fontFamily || "system-ui";
  const weight = cs.fontWeight || "900";

  const canvas = calcFitFont._c || (calcFitFont._c = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");

  const measure = (s, size) => {
    ctx.font = `${weight} ${size}px ${family}`;
    return ctx.measureText(s).width;
  };

  // iOS Safariで計測がズレるのを避ける（強制レイアウト）
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;

  let low = minPx, high = basePx, best = minPx;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const w = measure(templateStr, mid);
    if (w <= el.clientWidth) { best = mid; low = mid + 1; }
    else { high = mid - 1; }
  }
  return best;
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

  function formatJPDate(ymd){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y,m,d] = ymd.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

// ---- Utils ----
  function toYMD(date) {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
  }
  function pad2(n){ return String(n).padStart(2, "0"); }

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
  // 記号は付けない
  // 色は .exp / .exp.neg のCSSで制御する
  return formatInt(Math.abs(n));
}

  function showToast(msg) {
    toast.textContent = msg;
    if (!toast.open) toast.showModal();
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { try { toast.close(); } catch {} }, 1100);
  }
})();
