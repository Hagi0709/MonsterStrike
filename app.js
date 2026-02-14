(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    grid: $('calendarGrid'),
    selectedDate: $('selectedDate'),
    input: $('cumInput'),
    monthLabel: $('monthLabel'),
    monthTotal: $('monthTotal'),
    monthGain: $('monthGain'),
    targetBtn: $('targetBtn'),
    targetLabel: $('targetLabel'),
    targetNeed: $('targetNeed'),
    ringSvg: $('targetRing'),
    ringBar: null,
    ringPct: $('targetPct'),
  };

  // ===== Utilities =====
  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const jpMD = (d) => `${d.getMonth()+1}月${d.getDate()}日`;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const parseNum = (s) => {
    if (s == null) return null;
    const t = String(s).replace(/[^0-9]/g, '');
    if (!t) return null;
    try { return BigInt(t); } catch { return null; }
  };

  const fmt = (n) => {
    if (n == null) return '';
    const s = n.toString();
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  // ===== State =====
  const state = {
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(), // 0-11
    selected: new Date(),
    entries: {},  // ymd -> BigInt
    targetRank: 2500,
    expByRank: null, // array [rank] => BigInt cumulative exp
  };

  // ===== Storage =====
  const LS_KEY = 'monsuto_exp_calendar_v1';
  const load = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        if (obj.entries && typeof obj.entries === 'object') state.entries = obj.entries;
        if (obj.targetRank) state.targetRank = Number(obj.targetRank) || state.targetRank;
        if (obj.viewYear) state.viewYear = Number(obj.viewYear) || state.viewYear;
        if (typeof obj.viewMonth === 'number') state.viewMonth = obj.viewMonth;
        if (obj.selected) state.selected = new Date(obj.selected);
      }
    } catch {}
  };

  const save = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        entries: state.entries,
        targetRank: state.targetRank,
        viewYear: state.viewYear,
        viewMonth: state.viewMonth,
        selected: state.selected.toISOString(),
      }));
    } catch {}
  };

  // ===== Rank Table =====
  const loadRankTable = async () => {
    // rank_table.csv: 1行目: rank,cumulativeExp
    const res = await fetch('./rank_table.csv', { cache: 'no-store' });
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    const arr = [];
    for (let i=1;i<lines.length;i++){
      const [r, e] = lines[i].split(',');
      const rank = Number(r);
      const exp = parseNum(e);
      if (!Number.isFinite(rank) || exp == null) continue;
      arr[rank] = exp;
    }
    state.expByRank = arr;
  };

  const rankFromCum = (cum) => {
    const arr = state.expByRank;
    if (!arr || cum == null) return null;
    // binary search 1..max
    let lo = 1, hi = arr.length - 1, ans = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = arr[mid];
      if (v != null && v <= cum) { ans = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return ans;
  };

  const expForRank = (rank) => {
    const arr = state.expByRank;
    if (!arr) return null;
    return arr[rank] ?? null;
  };

  // ===== Calendar helpers =====
  const firstCellDate = (year, month) => {
    const first = new Date(year, month, 1);
    const day = first.getDay(); // 0=Sun
    const d = new Date(first);
    d.setDate(first.getDate() - day);
    d.setHours(0,0,0,0);
    return d;
  };

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const latestEntryInMonth = (year, month) => {
    // month: 0-11
    const keys = Object.keys(state.entries);
    let best = null;
    for (const k of keys) {
      const m = k.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) continue;
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      if (y !== year || mo !== month) continue;
      if (!best || k > best) best = k;
    }
    return best;
  };

  const entryCum = (key) => {
    const v = state.entries[key];
    if (v == null) return null;
    return parseNum(v);
  };

  const previousEntryKey = (key) => {
    const keys = Object.keys(state.entries).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    const idx = keys.indexOf(key);
    if (idx <= 0) return null;
    return keys[idx-1];
  };

  // ===== Rendering =====
  const renderHeader = () => {
    if (els.monthLabel) els.monthLabel.textContent = `${state.viewYear}年 ${state.viewMonth+1}月`;

    // 月内最新の累計を「累計EXP」、月内合計増分を「獲得EXP」
    const lastKey = latestEntryInMonth(state.viewYear, state.viewMonth);
    const lastCum = lastKey ? entryCum(lastKey) : 0n;

    // 月初の直前データを基準に月内増分を計算
    let monthGain = 0n;
    if (lastKey) {
      const prevKey = previousEntryKey(lastKey);
      const prevCum = prevKey ? entryCum(prevKey) : 0n;
      // ただし前日が別月の場合、月内の合計増分の方が自然なので、月内全deltaを合算
      monthGain = sumMonthDeltas(state.viewYear, state.viewMonth);
      // monthGainを0以下にしない
      if (monthGain < 0n) monthGain = 0n;
    }

    if (els.monthTotal) els.monthTotal.textContent = `累計EXP ${fmt(lastCum)}`;
    if (els.monthGain) els.monthGain.textContent = `獲得EXP ${fmt(monthGain)}`;

    // 目標表示（選択日の累計を基準）
    const selKey = ymd(state.selected);
    const selCum = entryCum(selKey) ?? 0n;
    if (els.targetLabel) els.targetLabel.textContent = `目標 ${state.targetRank}`;
    const targetExp = expForRank(state.targetRank) ?? null;
    const need = targetExp == null ? null : (targetExp - selCum);
    if (els.targetNeed) els.targetNeed.textContent = `必要EXP ${need == null ? '--' : fmt(need < 0n ? 0n : need)}`;

    renderRing(selCum, targetExp);
  };

  const sumMonthDeltas = (year, month) => {
    // その月に存在する日付エントリを日付順に並べ、差分の正の値を合計
    const keys = Object.keys(state.entries)
      .filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort();
    let total = 0n;
    let prevCum = null;
    let prevKey = null;
    for (const k of keys) {
      const [y, m] = k.split('-');
      const yN = Number(y), mN = Number(m)-1;
      const cum = entryCum(k);
      if (cum == null) continue;

      if (prevCum != null) {
        const delta = cum - prevCum;
        // deltaを「当日の獲得」と解釈するのは k の日
        if (yN === year && mN === month && delta > 0n) total += delta;
      }
      prevCum = cum;
      prevKey = k;
    }
    return total;
  };

  const renderRing = (currentCum, targetExp) => {
    if (!els.ringSvg) return;
    if (!els.ringBar) els.ringBar = els.ringSvg.querySelector('.ringBar');

    const r = 16;
    const C = 2 * Math.PI * r;
    if (els.ringBar) {
      els.ringBar.style.strokeDasharray = `${C} ${C}`;
    }

    let pct = 0;
    if (targetExp && targetExp > 0n) {
      const p = Number((currentCum * 10000n) / targetExp) / 100; // 2桁
      pct = clamp(p, 0, 100);
    }
    if (els.ringPct) els.ringPct.textContent = `${pct.toFixed(pct < 10 ? 1 : 0)}%`;

    if (els.ringBar) {
      const off = C * (1 - (pct/100));
      els.ringBar.style.strokeDashoffset = String(off);
    }
  };

  const fillGrid = () => {
    if (!els.grid) return;
    els.grid.innerHTML = '';

    const start = firstCellDate(state.viewYear, state.viewMonth);
    const today = new Date(); today.setHours(0,0,0,0);

    for (let i=0;i<42;i++){
      const d = new Date(start);
      d.setDate(start.getDate()+i);
      d.setHours(0,0,0,0);

      const cell = document.createElement('div');
      cell.className = 'cell';
      if (d.getMonth() !== state.viewMonth) cell.classList.add('outside');
      if (isSameDay(d, today)) cell.classList.add('today');
      if (isSameDay(d, state.selected)) cell.classList.add('selected');

      cell.dataset.date = ymd(d);

      const num = document.createElement('div');
      num.className = 'dayNum';
      num.textContent = String(d.getDate());

      // entries
      const key = cell.dataset.date;
      const cum = entryCum(key);
      const rank = cum == null ? null : rankFromCum(cum);

      const rankEl = document.createElement('div');
      rankEl.className = 'dayRank';
      rankEl.textContent = rank == null ? '' : String(rank);

      const deltaEl = document.createElement('div');
      deltaEl.className = 'dayDelta';
      deltaEl.textContent = '';

      const cumEl = document.createElement('div');
      cumEl.className = 'dayCum';
      cumEl.textContent = cum == null ? '' : fmt(cum);

      if (cum != null) {
        const prevKey = previousEntryKey(key);
        const prevCum = prevKey ? entryCum(prevKey) : null;
        if (prevCum != null) {
          const delta = cum - prevCum;
          if (delta > 0n) deltaEl.textContent = fmt(delta);
        }
      }

      cell.appendChild(num);
      cell.appendChild(rankEl);
      cell.appendChild(deltaEl);
      cell.appendChild(cumEl);

      cell.addEventListener('click', () => {
        state.selected = d;
        const k = ymd(d);
        if (els.selectedDate) els.selectedDate.textContent = jpMD(d);
        // input reflect
        const v = entryCum(k);
        if (els.input) els.input.value = v == null ? '' : fmt(v);
        save();
        fillGrid();
        renderHeader();
      });

      els.grid.appendChild(cell);
    }
  };

  const setSelectedDateUI = () => {
    if (els.selectedDate) els.selectedDate.textContent = jpMD(state.selected);
    const v = entryCum(ymd(state.selected));
    if (els.input) els.input.value = v == null ? '' : fmt(v);
  };

  // ===== Events =====
  const bindEvents = () => {
    // 入力（累計EXP）
    if (els.input) {
      els.input.disabled = false;
      els.input.readOnly = false;

      let composing = false;
      els.input.addEventListener('compositionstart', () => composing = true);
      els.input.addEventListener('compositionend', () => composing = false);

      els.input.addEventListener('input', () => {
        if (composing) return;
        const k = ymd(state.selected);
        const n = parseNum(els.input.value);
        if (n == null) {
          delete state.entries[k];
        } else {
          // BigIntはJSONにそのまま入れられないので文字列で保持
          state.entries[k] = n.toString();
          // 表示はカンマ付きに戻す（カーソルが飛びやすいのでフォーカス外で整形）
        }
        save();
        fillGrid();
        renderHeader();
      });

      // フォーカス外で整形
      els.input.addEventListener('blur', () => {
        const n = parseNum(els.input.value);
        els.input.value = n == null ? '' : fmt(n);
      });
    }

    // 目標ランク変更
    if (els.targetBtn) {
      els.targetBtn.addEventListener('click', () => {
        const v = prompt('目標ランクを入力してください（例: 2500）', String(state.targetRank));
        if (v == null) return;
        const n = Number(String(v).replace(/[^0-9]/g,''));
        if (!Number.isFinite(n) || n < 1) return;
        state.targetRank = Math.min(2500, Math.max(1, n));
        save();
        renderHeader();
      });
    }

    // 月移動（スワイプ）
    let x0 = null;
    document.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      x0 = e.touches[0].clientX;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const x1 = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : x0;
      const dx = x1 - x0;
      x0 = null;
      if (Math.abs(dx) < 60) return;

      if (dx < 0) nextMonth();
      else prevMonth();
    }, { passive: true });
  };

  const nextMonth = () => {
    state.viewMonth += 1;
    if (state.viewMonth >= 12) { state.viewMonth = 0; state.viewYear += 1; }
    renderHeader();
    fillGrid();
    save();
  };
  const prevMonth = () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
    renderHeader();
    fillGrid();
    save();
  };

  // ===== Boot =====
  const boot = async () => {
    load();
    // 初期選択日を「今日」に寄せる
    const now = new Date(); now.setHours(0,0,0,0);
    if (!(state.selected instanceof Date) || isNaN(state.selected.getTime())) state.selected = now;

    state.viewYear = state.selected.getFullYear();
    state.viewMonth = state.selected.getMonth();

    // ring bar cache
    if (els.ringSvg) els.ringBar = els.ringSvg.querySelector('.ringBar');

    await loadRankTable();

    setSelectedDateUI();
    bindEvents();
    renderHeader();
    fillGrid();
  };

  boot().catch((e) => {
    console.error(e);
  });
})();
