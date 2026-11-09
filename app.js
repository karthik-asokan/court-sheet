(function () {
  const store = self.CourtSheet;
  const $ = (id) => document.getElementById(id);

  const SLOTS = [
    ['winner1', 'Winner 1'],
    ['winner2', 'Winner 2'],
    ['loser1', 'Loser 1'],
    ['loser2', 'Loser 2'],
  ];
  const SLOT_LABEL = Object.fromEntries(SLOTS);
  const SLOT_TAG = { winner1: 'W1', winner2: 'W2', loser1: 'L1', loser2: 'L2' };
  const GUEST = 'GUEST'; // Visitors share this name, so it can fill several slots.
  const DEFAULT_WINNER_SCORE = 15;
  const MAX_SCORE = 30;
  const RETRY_MS = 20000;
  const REFRESH_MS = 60000; // How often an open app checks for games from other phones.

  const state = {
    date: todayIso(),
    dateChosen: false, // Once the user picks a date, stop following today's date.
    names: { winner1: '', winner2: '', loser1: '', loser2: '' },
    editingId: null,
    games: [], // Games entered or changed on this phone.
    day: null, // The Sheet's copy of the shown day, from the last connection.
    players: [],
    pickerSlot: null, // The slot the next tap in the picker fills.
    uploading: false,
    lastFetch: 0,
    configured: false,
    problem: null,
  };

  function todayIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const scoreText = (s) => (s === null || s === undefined || s === '' ? '–' : s);

  /* ---------- The day's games ---------- */

  // The Sheet's games for the day, in sheet order, with this phone's unsent changes on top.
  // Games another phone entered show up once both phones have connected.
  function dayGames() {
    const local = state.games.filter((g) => g.date === state.date);
    const localById = new Map(local.map((g) => [g.id, g]));
    const list = [];
    const seen = new Set();

    if (state.day) {
      state.day.rows.forEach((row) => {
        const mine = row.id ? localById.get(row.id) : null;
        if (mine) seen.add(mine.id);
        if (mine && store.needsUpload(mine)) {
          if (!mine.deleted) list.push(mine);
        } else {
          list.push({ ...row, date: state.date, rev: 0, syncedRev: 0, errorRev: null, fromSheet: true, otherPhone: !mine });
        }
      });
      // Not on the Sheet yet. An uploaded game missing from it was deleted elsewhere.
      local.filter((g) => !seen.has(g.id) && !g.deleted && store.needsUpload(g)).forEach((g) => list.push(g));
    } else {
      local.filter((g) => !g.deleted).forEach((g) => list.push(g));
    }
    return list;
  }

  /* ---------- Rendering ---------- */

  function renderForm() {
    document.querySelectorAll('.slot').forEach((btn) => {
      const name = state.names[btn.dataset.slot];
      btn.textContent = name || SLOT_LABEL[btn.dataset.slot];
      btn.classList.toggle('empty', !name);
    });

    const games = dayGames();
    const editing = state.editingId && games.find((g) => g.id === state.editingId);
    $('edit-banner').hidden = !editing;
    $('cancel-edit').hidden = !editing;
    $('save').textContent = editing ? 'Update game' : 'Save game';
    if (editing) $('edit-title').textContent = `Editing game ${games.indexOf(editing) + 1}`;

    $('date').value = state.date;
    $('date').disabled = Boolean(editing);
    document.querySelector('.date-row').classList.toggle('locked', Boolean(editing));
    $('date-label').textContent = formatDate(state.date);
    $('date-today').hidden = state.date !== todayIso();
  }

  function stateIcon(game) {
    const wrap = el('span', 'game-state');
    const failed = store.hasFailed(game);
    const pending = store.needsUpload(game);
    wrap.classList.toggle('pending', pending && !failed);
    wrap.classList.toggle('failed', failed);
    wrap.title = failed ? 'Not uploaded: needs fixing' : pending ? 'Saved on this phone, waiting to upload' : 'On the Sheet';
    wrap.setAttribute('aria-label', wrap.title);
    wrap.setAttribute('role', 'img');
    const path = failed
      ? '<path d="M12 7v6M12 17h.01"/>'
      : pending
        ? '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>'
        : '<path d="m5 12.5 4.5 4.5L19 7.5"/>';
    wrap.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    return wrap;
  }

  function renderGames() {
    const games = dayGames();
    const list = $('games-list');
    list.replaceChildren();
    $('games-title').textContent = games.length === 1 ? '1 game' : `${games.length} games`;
    $('games-title').hidden = !games.length;
    $('games-empty').hidden = games.length > 0;

    games.map((g, i) => [g, i + 1]).reverse().forEach(([game, number]) => {
      const item = el('li');
      const btn = el('button', 'game');
      btn.type = 'button';
      btn.classList.toggle('editing', game.id === state.editingId);
      const score = `${scoreText(game.winnerScore)}–${scoreText(game.loserScore)}`;
      btn.setAttribute('aria-label', `Edit game ${number}: ${game.winner1} and ${game.winner2} beat ${game.loser1} and ${game.loser2}, ${score}`);
      const names = el('span', 'game-names');
      names.append(el('span', 'w', `${game.winner1} & ${game.winner2}`), el('span', 'l', `${game.loser1} & ${game.loser2}`));
      if (game.otherPhone) names.append(el('span', 'from', game.id ? 'Entered on another phone' : 'Typed into the Sheet'));
      btn.append(el('span', 'game-num', number), names, el('span', 'game-score', score), stateIcon(game));
      if (store.hasFailed(game)) btn.append(el('span', 'game-error', game.error));
      btn.addEventListener('click', () => startEdit(game.id));
      item.append(btn);
      list.append(item);
    });
  }

  function renderStatus() {
    const queued = state.games.filter(store.needsUpload);
    const failed = queued.filter(store.hasFailed).length;
    const waiting = queued.length - failed;
    const pill = $('status');
    let label;
    let pillState;
    if (!state.configured) {
      [label, pillState] = [waiting ? `${waiting} saved · set up` : 'Set up', 'problem'];
    } else if (state.problem) {
      [label, pillState] = ['Check settings', 'problem'];
    } else if (failed) {
      [label, pillState] = [`${failed} to fix`, 'problem'];
    } else if (state.uploading && waiting) {
      [label, pillState] = ['Uploading…', 'busy'];
    } else if (waiting) {
      [label, pillState] = [`${waiting} waiting`, navigator.onLine ? 'waiting' : 'offline'];
    } else if (!navigator.onLine) {
      [label, pillState] = ['Offline', 'offline'];
    } else {
      [label, pillState] = ['All uploaded', 'ok'];
    }
    pill.textContent = label;
    pill.dataset.state = pillState;
  }

  async function refresh() {
    state.games = await store.allGames();
    state.day = (await store.getSetting('day:' + state.date)) || null;
    state.players = (await store.getSetting('players')) || [];
    state.configured = Boolean(await store.getSetting('url'));
    state.problem = await store.getSetting('lastProblem');
    renderForm();
    renderGames();
    renderStatus();
    if ($('picker').open) renderPicker();
  }

  let toastTimer;
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
  }

  /* ---------- Player picker ---------- */

  // The saved list, plus anyone typed in on this phone who has not reached the Sheet yet.
  function knownPlayers() {
    const names = [...state.players];
    const add = (name) => {
      if (name && !names.some((n) => sameName(n, name))) names.push(name);
    };
    state.games.filter(store.needsUpload).forEach((g) => SLOTS.forEach(([slot]) => add(g[slot])));
    Object.values(state.names).forEach(add);
    return names.sort((a, b) => a.localeCompare(b));
  }

  // The first empty slot, searching onward from `after` and wrapping round.
  function nextEmptySlot(after) {
    const start = after ? SLOTS.findIndex(([s]) => s === after) + 1 : 0;
    const hit = [...SLOTS.slice(start), ...SLOTS.slice(0, start)].find(([s]) => !state.names[s]);
    return hit ? hit[0] : null;
  }

  const isGuest = (name) => sameName(name, GUEST);

  // The slots a name fills. Only GUEST can fill more than one.
  function slotsOf(name) {
    return SLOTS.map(([s]) => s).filter((s) => state.names[s] && sameName(state.names[s], name));
  }

  function renderSlotStrip(target) {
    const strip = $('picker-slots');
    strip.replaceChildren();
    SLOTS.forEach(([slot, label]) => {
      const name = state.names[slot];
      const btn = el('button', 'strip-slot ' + (slot.startsWith('winner') ? 'win' : 'lose'));
      btn.type = 'button';
      btn.classList.toggle('empty', !name);
      btn.classList.toggle('target', slot === target);
      btn.append(el('span', 'strip-tag', SLOT_TAG[slot]), el('span', 'strip-name', name || '–'));
      btn.setAttribute('aria-label', name ? `${label}: ${name}. Tap to remove.` : `${label}: empty. Tap to fill next.`);
      btn.addEventListener('click', () => {
        state.names[slot] = '';
        state.pickerSlot = slot;
        clearError();
        renderForm();
        renderPicker();
      });
      strip.append(btn);
    });
  }

  function renderPicker() {
    // The slot to fill next must be empty; the form may have changed since it was chosen.
    if (!state.pickerSlot || state.names[state.pickerSlot]) state.pickerSlot = nextEmptySlot();
    const target = state.pickerSlot;
    const query = $('picker-search').value.trim();
    const grid = $('picker-grid');
    const players = knownPlayers();
    const matches = players.filter((n) => n.toLowerCase().includes(query.toLowerCase()));
    const full = !target;

    $('picker-title').textContent = full ? 'All four picked' : `Pick ${SLOT_LABEL[target]}`;
    const hint = $('picker-hint');
    hint.replaceChildren();
    if (full) {
      hint.textContent = 'Tap a name or a slot to remove them, or tap Done.';
    } else {
      hint.append(el('span', 'w', 'Green'), ' = winners, ', el('span', 'l', 'red'), ' = losers. Tap a name or slot again to remove them. GUEST can be picked more than once.');
    }
    renderSlotStrip(target);
    $('picker-clear').hidden = !Object.values(state.names).some(Boolean);
    $('picker-search').disabled = full;
    $('picker-empty').hidden = players.length > 0 || query.length > 0;

    grid.replaceChildren();
    matches.forEach((name) => {
      const slots = slotsOf(name);
      const guest = isGuest(name);
      const chip = el('button', 'chip');
      chip.type = 'button';
      chip.append(el('span', 'chip-name', name));
      if (slots.length) {
        const sides = new Set(slots.map((s) => (s.startsWith('winner') ? 'win' : 'lose')));
        chip.classList.add(sides.size > 1 ? 'mixed' : [...sides][0]);
        chip.append(el('span', 'chip-tag', slots.map((s) => SLOT_TAG[s]).join(' ')));
        chip.setAttribute('aria-label', guest
          ? `${name}, ${slots.map((s) => SLOT_LABEL[s]).join(' and ')}. Tap to add another guest.`
          : `${name}, ${SLOT_LABEL[slots[0]]}. Tap to remove.`);
      }
      chip.setAttribute('aria-pressed', String(slots.length > 0));
      // Guests are added each tap and removed from the slots above; others toggle.
      chip.disabled = full && (guest || !slots.length);
      chip.addEventListener('click', () => togglePlayer(name));
      grid.append(chip);
    });
    if (query && !full && !players.some((n) => sameName(n, query))) {
      const add = el('button', 'chip add', `Add “${query}” as a new player`);
      add.type = 'button';
      add.addEventListener('click', () => togglePlayer(query));
      grid.append(add);
    }
  }

  function openPicker(slot) {
    // Tapping an empty slot fills that one first; a filled slot just opens the picker.
    state.pickerSlot = state.names[slot] ? nextEmptySlot() : slot;
    $('picker-search').value = '';
    renderPicker();
    if (!$('picker').open) $('picker').showModal();
  }

  function togglePlayer(name) {
    const current = isGuest(name) ? null : slotsOf(name)[0];
    if (current) {
      state.names[current] = '';
      state.pickerSlot = current; // The next tap refills the slot just freed.
    } else {
      const target = state.pickerSlot && !state.names[state.pickerSlot] ? state.pickerSlot : nextEmptySlot();
      if (!target) return;
      state.names[target] = name;
      state.pickerSlot = nextEmptySlot(target);
    }
    $('picker-search').value = '';
    clearError();
    renderForm();
    renderPicker();
  }

  function clearAllPlayers() {
    SLOTS.forEach(([slot]) => { state.names[slot] = ''; });
    state.pickerSlot = SLOTS[0][0];
    renderForm();
    renderPicker();
  }

  /* ---------- Saving ---------- */

  function showError(message) {
    $('form-error').textContent = message;
    $('form-error').hidden = false;
  }
  function clearError() {
    $('form-error').hidden = true;
  }

  // Whole numbers from 0 to 30 only: anything else typed is dropped as it is typed.
  function sanitizeScore(input) {
    let value = input.value.replace(/\D/g, '').slice(0, 2);
    if (value !== '') value = String(Math.min(MAX_SCORE, Number(value)));
    if (input.value !== value) input.value = value;
  }

  function readScore(id) {
    const raw = $(id).value.trim();
    return raw === '' ? null : Number(raw);
  }

  function validate(winnerScore, loserScore) {
    const names = Object.values(state.names);
    if (names.some((n) => !n)) return 'Pick all four players.';
    if (winnerScore === null || loserScore === null) return 'Enter both scores.';
    const inRange = (s) => Number.isInteger(s) && s >= 0 && s <= MAX_SCORE;
    if (!inRange(winnerScore) || !inRange(loserScore)) return `Scores must be whole numbers from 0 to ${MAX_SCORE}.`;
    if (winnerScore <= loserScore) return 'The winner score must be higher than the loser score.';
    return null;
  }

  // Another phone may already have recorded this game.
  function findDuplicate(fields) {
    const pair = (a, b) => [a, b].map((n) => n.trim().toLowerCase()).sort().join('|');
    const games = dayGames();
    const index = games.findIndex((g) => g.id !== state.editingId
      && pair(g.winner1, g.winner2) === pair(fields.winner1, fields.winner2)
      && pair(g.loser1, g.loser2) === pair(fields.loser1, fields.loser2)
      && g.winnerScore === fields.winnerScore && g.loserScore === fields.loserScore);
    return index < 0 ? 0 : index + 1;
  }

  function resetForm() {
    state.names = { winner1: '', winner2: '', loser1: '', loser2: '' };
    state.pickerSlot = null;
    state.editingId = null;
    $('winnerScore').value = DEFAULT_WINNER_SCORE;
    $('loserScore').value = '';
    $('notes').value = '';
    clearError();
  }

  async function saveGame(event) {
    event.preventDefault();
    const winnerScore = readScore('winnerScore');
    const loserScore = readScore('loserScore');
    const problem = validate(winnerScore, loserScore);
    if (problem) {
      showError(problem);
      return;
    }

    const fields = { ...state.names, winnerScore, loserScore, notes: $('notes').value.trim() };
    const duplicate = findDuplicate(fields);
    if (duplicate && !confirm(`Game ${duplicate} already has these players and this score. Save it again anyway?`)) return;

    const editingId = state.editingId;
    const mine = editingId && state.games.find((g) => g.id === editingId);
    if (mine) {
      await store.updateGame(editingId, (g) => ({ ...g, ...fields, deleted: false, rev: g.rev + 1, errorRev: null, error: null }));
    } else {
      // A new game, or the first change on this phone to a game from the Sheet.
      await store.putGame({
        id: editingId || crypto.randomUUID(),
        date: state.date,
        ...fields,
        createdAt: Date.now(),
        rev: 1,
        syncedRev: 0,
        everSent: Boolean(editingId),
        deleted: false,
      });
    }
    resetForm();
    await refresh();
    toast(editingId ? 'Game updated' : `Game ${dayGames().length} saved`);
    uploadSoon();
  }

  function startEdit(id) {
    const game = id && dayGames().find((g) => g.id === id);
    if (!game) {
      toast('This game was typed into the Sheet. Change it there.');
      return;
    }
    state.editingId = id;
    SLOTS.forEach(([slot]) => { state.names[slot] = game[slot]; });
    $('winnerScore').value = game.winnerScore ?? '';
    $('loserScore').value = game.loserScore ?? '';
    $('notes').value = game.notes || '';
    clearError();
    renderForm();
    renderGames();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteEditing() {
    const id = state.editingId;
    const game = dayGames().find((g) => g.id === id);
    if (!game || !confirm(`Delete this game?\n${game.winner1} & ${game.winner2} ${scoreText(game.winnerScore)}–${scoreText(game.loserScore)} ${game.loser1} & ${game.loser2}`)) return;
    const mine = state.games.find((g) => g.id === id);
    if (mine) {
      // A game the Sheet may already hold stays queued as a deletion until the Sheet confirms it.
      await store.updateGame(id, (g) => (g.everSent ? { ...g, deleted: true, rev: g.rev + 1, errorRev: null, error: null } : null));
    } else {
      await store.putGame({ ...game, fromSheet: undefined, otherPhone: undefined, createdAt: Date.now(), deleted: true, rev: 1, syncedRev: 0, errorRev: null, everSent: true });
    }
    resetForm();
    await refresh();
    toast('Game deleted');
    uploadSoon();
  }

  /* ---------- Uploading ---------- */

  // Sends anything waiting and brings back the shown day's games from every phone.
  async function uploadSoon() {
    if (!navigator.onLine) {
      registerBackgroundSync();
      renderStatus();
      return null;
    }
    state.uploading = true;
    renderStatus();
    const result = await store.upload({ dates: [state.date] });
    state.uploading = false;
    if (result.state === 'ok') state.lastFetch = Date.now();
    await refresh();
    if (result.state === 'network') registerBackgroundSync();
    return result;
  }

  async function registerBackgroundSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.sync) await reg.sync.register('upload-games');
    } catch (err) { /* Not supported here. Uploads run when the app is next open and online. */ }
  }

  /* ---------- Settings ---------- */

  async function openSettings() {
    $('set-url').value = (await store.getSetting('url')) || '';
    $('set-pass').value = (await store.getSetting('passcode')) || '';
    $('settings-msg').hidden = true;
    await renderSheetLink();
    if (!$('settings').open) $('settings').showModal();
  }

  async function renderSheetLink() {
    const url = await store.getSetting('sheetUrl');
    $('sheet-link').hidden = !url;
    if (url) $('sheet-link').href = url;
  }

  function settingsMessage(text, bad) {
    const node = $('settings-msg');
    node.textContent = text;
    node.classList.toggle('bad', Boolean(bad));
    node.hidden = false;
  }

  async function saveSettings(event) {
    event.preventDefault();
    const url = $('set-url').value.trim();
    const passcode = $('set-pass').value;
    if (!url) {
      settingsMessage('Paste the web app URL first.', true);
      return;
    }
    await store.setSetting('url', url);
    await store.setSetting('passcode', passcode);
    settingsMessage('Testing…');
    const result = await uploadSoon();
    if (result && result.state === 'ok') {
      const count = (await store.getSetting('players') || []).length;
      settingsMessage(`Connected. ${count} players loaded.`);
    } else if (result && result.state === 'rejected') {
      settingsMessage(result.message, true);
    } else if (result && result.state === 'busy') {
      settingsMessage('An upload is already running. Try again in a moment.', true);
    } else {
      settingsMessage('Could not reach the script. Check you are online, the URL ends in /exec, and the deployment allows access by “Anyone”.', true);
    }
    await renderSheetLink();
  }

  /* ---------- Wiring ---------- */

  document.querySelectorAll('.slot').forEach((btn) => {
    btn.addEventListener('click', () => openPicker(btn.dataset.slot));
  });

  document.querySelectorAll('.step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.score);
      const current = input.value === '' ? 0 : Number(input.value);
      input.value = Math.min(MAX_SCORE, Math.max(0, current + Number(btn.dataset.delta)));
      clearError();
    });
  });

  $('form').addEventListener('submit', saveGame);
  ['winnerScore', 'loserScore'].forEach((id) => {
    $(id).addEventListener('input', () => {
      sanitizeScore($(id));
      clearError();
    });
  });
  $('cancel-edit').addEventListener('click', async () => {
    resetForm();
    await refresh();
  });
  $('delete').addEventListener('click', deleteEditing);

  $('date').addEventListener('change', async () => {
    if (!$('date').value) return;
    state.date = $('date').value;
    state.dateChosen = state.date !== todayIso();
    await refresh();
    uploadSoon();
  });
  // Desktop browsers open the calendar only from a small icon, so open it from anywhere on the row.
  $('date').addEventListener('click', () => {
    try { $('date').showPicker(); } catch (err) { /* Falls back to the native behaviour. */ }
  });

  $('picker-search').addEventListener('input', renderPicker);
  $('picker-search').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = $('picker-grid').querySelector('.chip:not([disabled]):not(.win):not(.lose):not(.mixed)');
    if (first && $('picker-search').value.trim()) first.click();
  });
  $('picker-close').addEventListener('click', () => $('picker').close());
  $('picker-clear').addEventListener('click', clearAllPlayers);

  $('status').addEventListener('click', () => {
    if (!state.configured || state.problem) openSettings();
    else uploadSoon();
  });
  $('open-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => $('settings').close());
  $('settings-form').addEventListener('submit', saveSettings);

  [$('picker'), $('settings')].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close(); // Tap on the backdrop.
    });
  });

  window.addEventListener('online', () => uploadSoon());
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!state.dateChosen && !state.editingId) state.date = todayIso();
    refresh();
    uploadSoon();
  });

  // The online event can miss a weak signal, so keep trying while games are waiting,
  // and check now and then for games from other phones.
  setInterval(() => {
    if (state.uploading || !navigator.onLine || !state.configured || document.visibilityState !== 'visible') return;
    const waiting = state.games.some((g) => store.needsUpload(g) && !store.hasFailed(g));
    if (waiting || Date.now() - state.lastFetch > REFRESH_MS) uploadSoon();
  }, RETRY_MS);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('message', refresh);
  }
  // Ask the browser not to evict queued games when storage runs low.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  resetForm();
  refresh().then(() => {
    if (!state.configured) openSettings();
    else uploadSoon();
  });
})();
