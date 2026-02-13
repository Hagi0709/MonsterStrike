// モンスト ランク上げ記録 - app.js
(() => {
  const STORAGE_KEY = "monst_xp_daily_v1";

  /** @type {Record<string, number>} */
  let data = load();

  let viewDate = new Date(); // 現在表示中の月
  let selected = toYMD(new Date()); // 選択日

  // Elements
  const monthLabel = document.getElementById("monthLabel");
  const calendarGrid = document.getElementById("calendarGrid");
  const selectedDateEl = document.getElementById("selectedDate");
  const xpInput = document.getElementById("xpInput");
  const monthTotalEl = document.getElementById("monthTotal");
  const weekTotalEl = document.getElementById("weekTotal");
  const monthListEl = document.getElementById("monthList");

  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const todayBtn = document.getElementById("todayBtn");
  const saveBtn = document.getElementById("saveBtn");
  const clearBtn = document.getElementById("clearBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");
  const toast = document.getElementById("toast");

  // Init
  render();

  // Events
  prevBtn.addEventListener("click", () => { viewDate = addMonths(viewDate, -1); render(); });
  nextBtn.addEventListener("click", () => { viewDate = addMonths(viewDate, 1); render(); });
  todayBtn.addEventListener("click", () => {
    const now = new Date();
    viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
    select(toYMD(now));
    render();
  });

  saveBtn.addEventListener("click", () => {
    const ymd = selected;
    const n = normalizeNumber(xpInput.value);

    if (n === null) {
      showToast("数字だけ入れてね（例: 250000）");
      return;
    }

    if (n === 0) {
      delete data[ymd];
      persist();
      showToast("削除しました");
      render();
      return;
    }

    data[ymd] = n;
    persist();
    showToast("保存しました");
    render();
  });

  clearBtn.addEventListener("click", () => {
    const ymd = selected;
    if (data[ymd] == null) {
      showToast("この日は記録なし");
      return;
    }
    delete data[ymd];
    persist();
    showToast("削除しました");
    render();
  });

  xpInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });

  exportBtn.addEventListener("click", () => {
    const payload = {
      app: "monst-rank-tracker",
      version: 1,
      exportedAt: new Date().toISOString(),
      data
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monst_xp_${toYMD(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("エクスポートしました");
  });

  importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const imported = (json && json.data && typeof json.data === "object") ? json.data : null;
      if (!imported) throw new Error("invalid");

      // 数値以外は除外
      const cleaned = {};
      for (const [k, v] of Object.entries(imported)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
        const num = typeof v === "number" ? v : normalizeNumber(String(v));
        if (num && num > 0) cleaned[k] = num;
      }

      data = { ...data, ...cleaned };
      persist();
      showToast("インポートしました");
      render();
    } catch {
      showToast("インポート失敗（JSON形式を確認）");
    } finally {
      importInput.value = "";
    }
  });

  // Rendering
  function render() {
    // header label
    monthLabel.textContent = `${viewDate.getFullYear()}年 ${viewDate.getMonth() + 1}月`;

    // calendar
    calendarGrid.innerHTML = "";
    const cells = buildCalendarCells(viewDate);
    const todayYMD = toYMD(new Date());

    for (const c of cells) {
      const cell = document.createElement("div");
      cell.className = "day";
      if (c.out) cell.classList.add("out");
      if (c.ymd === todayYMD) cell.classList.add("today");
      if (c.ymd === selected) cell.classList.add("selected");

      const date = document.createElement("div");
      date.className = "date";
      date.textContent = String(c.day);

      cell.appendChild(date);

      if (c.ymd === todayYMD) {
        const b = document.createElement("div");
        b.className = "badge";
        b.textContent = "今日";
        cell.appendChild(b);
      }

      const v = data[c.ymd];
      if (v != null) {
        const xp = document.createElement("div");
        xp.className = "xp";
        xp.innerHTML = `<span class="plus">+</span><span class="num">${formatInt(v)}</span>`;
        cell.appendChild(xp);

        const small = document.createElement("div");
        small.className = "small";
        small.textContent = "獲得EXP";
        cell.appendChild(small);
      }

      cell.addEventListener("click", () => {
        select(c.ymd);
        // 表示中の月外を押したらその月へ移動
        if (c.out) {
          const [yy, mm] = c.ymd.split("-").map(Number);
          viewDate = new Date(yy, mm - 1, 1);
        }
        render();
      });

      calendarGrid.appendChild(cell);
    }

    // sidebar
    selectedDateEl.textContent = selected;
    xpInput.value = data[selected] != null ? String(data[selected]) : "";
    xpInput.placeholder = data[selected] != null ? "" : "例: 250000";

    // stats
    monthTotalEl.textContent = formatInt(sumMonth(viewDate));
    weekTotalEl.textContent = formatInt(sumLastDays(7));

    // month list
    renderMonthList();
  }

  function renderMonthList() {
    const ym = `${viewDate.getFullYear()}-${pad2(viewDate.getMonth() + 1)}`;
    const rows = Object.entries(data)
      .filter(([k, v]) => k.startsWith(ym) && typeof v === "number")
      .sort(([a], [b]) => a.localeCompare(b));

    monthListEl.innerHTML = "";

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "今月の記録はまだありません。";
      monthListEl.appendChild(empty);
      return;
    }

    for (const [k, v] of rows) {
      const row = document.createElement("div");
      row.className = "row";

      const left = document.createElement("div");
      left.innerHTML = `<div class="d">${k}</div><div class="muted">獲得EXP</div>`;

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "10px";

      const val = document.createElement("div");
      val.className = "v";
      val.innerHTML = `<span class="plus">+</span>${formatInt(v)}`;

      const btn = document.createElement("button");
      btn.textContent = "編集";
      btn.addEventListener("click", () => {
        select(k);
        render();
        xpInput.focus();
      });

      right.appendChild(val);
      right.appendChild(btn);

      row.appendChild(left);
      row.appendChild(right);

      monthListEl.appendChild(row);
    }
  }

  function select(ymd) {
    selected = ymd;
  }

  // Calendar generation
  function buildCalendarCells(d) {
    const year = d.getFullYear();
    const month = d.getMonth();
    const first = new Date(year, month, 1);

    // 日曜始まり (0=Sun)
    const startOffset = first.getDay();
    const start = new Date(year, month, 1 - startOffset);

    const cells = [];
    for (let i = 0; i < 42; i++) { // 6週
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

  // Data
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return {};
      // sanitize
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

  // Stats
  function sumMonth(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const prefix = `${y}-${pad2(m)}`;
    let s = 0;
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith(prefix)) s += v;
    }
    return s;
  }

  function sumLastDays(days) {
    const today = new Date();
    let s = 0;
    for (let i = 0; i < days; i++) {
      const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = toYMD(dt);
      const v = data[key];
      if (v != null) s += v;
    }
    return s;
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

  function showToast(msg) {
    toast.textContent = msg;
    if (!toast.open) toast.showModal();
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      try { toast.close(); } catch {}
    }, 1100);
  }
})();
