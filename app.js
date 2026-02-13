// モンスト EXPカレンダー（累計入力→増加量表示）- app.js
(() => {
  const STORAGE_KEY = "monst_cumxp_v1";

  /** @type {Record<string, number>} 累計経験値 */
  let cum = load();

  // UI state
  let viewDate = new Date();         // 表示月
  let selected = toYMD(new Date());  // 選択日
  let hideOutMonth = false;          // 月外セルを隠す

  // Elements
  const monthLabel = document.getElementById("monthLabel");
  const calendarGrid = document.getElementById("calendarGrid");
  const monthTotalEl = document.getElementById("monthTotal");

  const muteBtn = document.getElementById("muteBtn");
  const menuBtn = document.getElementById("menuBtn");
  const fab = document.getElementById("fab");

  const entryDialog = document.getElementById("entryDialog");
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

  // Init
  const now = new Date();
  viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
  render();

  // Events
  muteBtn.addEventListener("click", () => {
    hideOutMonth = !hideOutMonth;
    muteBtn.querySelector(".icon").textContent = hideOutMonth ? "🔔" : "🔕";
    render();
  });

  menuBtn.addEventListener("click", () => menuDialog.showModal());

  prevBtn.addEventListener("click", () => { viewDate = addMonths(viewDate, -1); render(); });
  nextBtn.addEventListener("click", () => { viewDate = addMonths(viewDate, 1); render(); });

  todayBtn.addEventListener("click", () => {
    const t = new Date();
    viewDate = new Date(t.getFullYear(), t.getMonth(), 1);
    selected = toYMD(t);
    render();
    menuDialog.close();
  });

  // 仕様：日付を選択 → 右下＋で入力
  fab.addEventListener("click", () => {
    openEntry(selected);
  });

  // カレンダーの日付タップは「選択のみ」（入力は＋）
  // ただし選択後に即見えるようハイライト
  // （月外は選択できない仕様のまま）
  // ※月外を隠している場合は visibility hidden なので押せない

  saveBtn.addEventListener("click", () => {
    const n = normalizeNumber(cumInput.value);
    if (n === null) {
      showToast("数字だけ（例: 123456789）");
      return;
    }
    if (n === 0) {
      delete cum[selected];
      persist();
      showToast("削除しました");
      entryDialog.close();
      render();
      return;
    }
    cum[selected] = n;
    persist();
    showToast("保存しました");
    entryDialog.close();
    render();
  });

  deleteBtn.addEventListener("click", () => {
    if (cum[selected] == null) {
      showToast("この日は記録なし");
      return;
    }
    delete cum[selected];
    persist();
    showToast("削除しました");
    entryDialog.close();
    render();
  });

  cumInput.addEventListener("input", () => {
    updatePreview();
  });

  exportBtn.addEventListener("click", () => {
    const payload = {
      app: "monst-exp-calendar",
      version: 3,
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

      // 旧形式(data)も一応拾う
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
      render();
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
    render();
  });

  // Rendering
  function render() {
    monthLabel.textContent = `${viewDate.getFullYear()}年 ${viewDate.getMonth() + 1}月`;

    // 先に差分マップを作る（全期間）
    const deltaMap = buildDeltaMap(cum);

    calendarGrid.innerHTML = "";
    const cells = buildCalendarCells(viewDate);
    const todayYMD = toYMD(new Date());

    for (const c of cells) {
      const cell = document.createElement("div");
      cell.className = "day";

      if (c.out) cell.classList.add("out");
      if (c.ymd === todayYMD) cell.classList.add("today");
      if (c.ymd === selected) cell.classList.add("selected");

      if (hideOutMonth && c.out) {
        cell.style.visibility = "hidden";
        cell.style.pointerEvents = "none";
      }

      const dn = document.createElement("div");
      dn.className = "dnum";
      dn.textContent = String(c.day);
      cell.appendChild(dn);

      const d = deltaMap[c.ymd]; // 前回からの増加量（前回がある場合のみ）
      const exp = document.createElement("div");
      exp.className = "exp";

      if (typeof d === "number") {
        if (d < 0) exp.classList.add("neg");
        exp.textContent = formatSignedInt(d);
      } else {
        // 前回値がなければ表示なし（高さだけ確保）
        exp.style.visibility = "hidden";
        exp.textContent = "0";
      }
      cell.appendChild(exp);

      cell.addEventListener("click", () => {
        selected = c.ymd;
        // 月外を押したらその月へ移動（ただし out は pointer-events none なので通常来ない）
        render();
      });

      calendarGrid.appendChild(cell);
    }

    // 今月合計（増加量の合計）
    monthTotalEl.textContent = formatInt(sumMonthDelta(viewDate, deltaMap));
  }

  // 累計入力ダイアログ
  function openEntry(ymd) {
    selected = ymd;
    selectedDateEl.textContent = selected;
    cumInput.value = cum[selected] != null ? String(cum[selected]) : "";
    updatePreview();
    entryDialog.showModal();
    setTimeout(() => cumInput.focus(), 50);
  }

  function updatePreview() {
    const n = normalizeNumber(cumInput.value);
    if (n === null) {
      previewEl.textContent = "—";
      return;
    }
    if (n === 0) {
      previewEl.textContent = "削除";
      return;
    }
    const prev = findPrevCumulative(selected, cum);
    if (!prev) {
      previewEl.textContent = "前回記録なし（増加量は表示されません）";
      return;
    }
    const diff = n - prev.value;
    const sign = diff >= 0 ? "+" : "−";
    const cls = diff >= 0 ? "plus" : "neg";
    previewEl.innerHTML = `前回(${prev.date})との差：<span class="${cls}">${sign}${formatInt(Math.abs(diff))}</span>`;
  }

  // Build delta map from cumulative records
  function buildDeltaMap(cumulative) {
    const keys = Object.keys(cumulative).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
    keys.sort(); // YYYY-MM-DD なので文字列ソートでOK

    /** @type {Record<string, number>} */
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

  // Calendar generation
  function buildCalendarCells(d) {
    const year = d.getFullYear();
    const month = d.getMonth();
    const first = new Date(year, month, 1);

    // 日曜始まり
    const startOffset = first.getDay();
    const start = new Date(year, month, 1 - startOffset);

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const ymd = toYMD(cur);
      cells.push({
        ymd,
        day: cur.getDate(),
        out: cur.getMonth() !== month
      });
    }
    return cells;
  }

  // Storage
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cum));
  }

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
    } catch {
      return {};
    }
  }

  // Utils
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
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
  }

  function formatInt(n) {
    return Number(n).toLocaleString("ja-JP");
  }

  function formatSignedInt(n) {
    const sign = n >= 0 ? "+" : "−";
    return sign + formatInt(Math.abs(n));
  }

  function showToast(msg) {
    toast.textContent = msg;
    if (!toast.open) toast.showModal();
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      try { toast.close(); } catch {}
    }, 1100);
  }
})();
