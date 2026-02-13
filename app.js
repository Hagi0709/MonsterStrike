// モンスト EXPカレンダー - app.js
(() => {
  const STORAGE_KEY = "monst_xp_daily_v2";

  /** @type {Record<string, number>} */
  let data = load();

  // UI state
  let viewDate = new Date();         // 表示月
  let selected = toYMD(new Date());  // 選択日
  let hideOutMonth = false;          // 画像左上の「非表示」っぽい挙動

  // Elements
  const monthLabel = document.getElementById("monthLabel");
  const calendarGrid = document.getElementById("calendarGrid");
  const monthTotalEl = document.getElementById("monthTotal");

  const muteBtn = document.getElementById("muteBtn");
  const menuBtn = document.getElementById("menuBtn");
  const fab = document.getElementById("fab");

  const entryDialog = document.getElementById("entryDialog");
  const selectedDateEl = document.getElementById("selectedDate");
  const xpInput = document.getElementById("xpInput");
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
  // 月初に固定して表示が安定
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

  prevBtn.addEventListener("click", () => {
    viewDate = addMonths(viewDate, -1);
    render();
  });
  nextBtn.addEventListener("click", () => {
    viewDate = addMonths(viewDate, 1);
    render();
  });
  todayBtn.addEventListener("click", () => {
    const t = new Date();
    viewDate = new Date(t.getFullYear(), t.getMonth(), 1);
    selected = toYMD(t);
    render();
    menuDialog.close();
  });

  fab.addEventListener("click", () => {
    // 今日をすぐ入力
    const t = new Date();
    selected = toYMD(t);
    // 今月以外表示中なら今月へ
    viewDate = new Date(t.getFullYear(), t.getMonth(), 1);
    openEntry();
    render();
  });

  saveBtn.addEventListener("click", () => {
    const n = normalizeNumber(xpInput.value);
    if (n === null) {
      showToast("数字だけ（例: 250000）");
      return;
    }
    if (n === 0) {
      delete data[selected];
      persist();
      showToast("削除しました");
      entryDialog.close();
      render();
      return;
    }
    data[selected] = n;
    persist();
    showToast("保存しました");
    entryDialog.close();
    render();
  });

  deleteBtn.addEventListener("click", () => {
    if (data[selected] == null) {
      showToast("この日は記録なし");
      return;
    }
    delete data[selected];
    persist();
    showToast("削除しました");
    entryDialog.close();
    render();
  });

  exportBtn.addEventListener("click", () => {
    const payload = {
      app: "monst-exp-calendar",
      version: 2,
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
    menuDialog.close();
  });

  importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const imported = (json && json.data && typeof json.data === "object") ? json.data : null;
      if (!imported) throw new Error("invalid");

      const cleaned = {};
      for (const [k, v] of Object.entries(imported)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
        const num = typeof v === "number" ? v : normalizeNumber(String(v));
        if (num && num > 0) cleaned[k] = num;
      }
      data = { ...data, ...cleaned };
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
    // 迷う余地がないように即削除（必要なら後で確認ダイアログにする）
    data = {};
    persist();
    showToast("全データ削除");
    menuDialog.close();
    render();
  });

  // Calendar render
  function render() {
    monthLabel.textContent = `${viewDate.getFullYear()}年 ${viewDate.getMonth() + 1}月`;

    calendarGrid.innerHTML = "";
    const cells = buildCalendarCells(viewDate);
    const todayYMD = toYMD(new Date());

    for (const c of cells) {
      const cell = document.createElement("div");
      cell.className = "day";

      if (c.out) cell.classList.add("out");
      if (c.ymd === todayYMD) cell.classList.add("today");
      if (c.ymd === selected) cell.classList.add("selected");

      // hide out-of-month like screenshot's "mute" behavior
      if (hideOutMonth && c.out) {
        cell.style.visibility = "hidden";
        cell.style.pointerEvents = "none";
      }

      const dn = document.createElement("div");
      dn.className = "dnum";
      dn.textContent = String(c.day);
      cell.appendChild(dn);

      const v = data[c.ymd];
      if (v != null) {
        const exp = document.createElement("div");
        exp.className = "exp";
        exp.textContent = formatInt(v);
        cell.appendChild(exp);
      } else {
        // 空でも高さを揃える（画像っぽく）
        const exp = document.createElement("div");
        exp.className = "exp";
        exp.style.visibility = "hidden";
        exp.textContent = "0";
        cell.appendChild(exp);
      }

      cell.addEventListener("click", () => {
        selected = c.ymd;
        // 月外を押したらその月に移動
        if (c.out) {
          const [yy, mm] = c.ymd.split("-").map(Number);
          viewDate = new Date(yy, mm - 1, 1);
        }
        openEntry();
        render();
      });

      calendarGrid.appendChild(cell);
    }

    monthTotalEl.textContent = formatInt(sumMonth(viewDate));
  }

  function openEntry() {
    selectedDateEl.textContent = selected;
    xpInput.value = data[selected] != null ? String(data[selected]) : "";
    // iOS: showModal前にfocusすると事故ることがあるので、開いてから
    entryDialog.showModal();
    setTimeout(() => xpInput.focus(), 50);
  }

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
