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
  const DEFAULT_WINNER_SCORE = 15;
  const MAX_SCORE = 30;
  const RETRY_MS = 20000;

  const state = {
    date: todayIso(),
    dateChosen: false, // Once the user picks a date, stop following today's date.
    names: { winner1: '', winner2: '', loser1: '', loser2: '' },
    editingId: null,
    games: [],
    players: [],
    pickerSlot: null,
    uploading: false,
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

  /* ---------- Rendering ---------- */

  function renderForm() {
    document.querySelectorAll('.slot').forEach((btn) => {
      const name = state.names[btn.dataset.slot];
      btn.textContent = name || SLOT_LABEL[btn.dataset.slot];
      btn.classList.toggle('empty', !name);
    });

    const editing = state.editingId && state.games.find((g) => g.id === state.editingId);
    $('edit-banner').hidden = !editing;
    $('cancel-edit').hidden = !editing;
    $('save').textContent = editing ? 'Update game' : 'Save game';
    if (editing) $('edit-title').textContent = `Editing game ${dayGames().indexOf(editing) + 1}`;

    $('date').value = state.date;
    $('date').disabled = Boolean(editing);
    document.querySelector('.date-row').classList.toggle('locked', Boolean(editing));
    $('date-label').textContent = formatDate(state.date);
    $('date-today').hidden = state.date !== todayIso();
  }

  const dayGames = () => state.games.filter((g) => g.date === state.date && !g.deleted);

  function stateIcon(game) {
    const wrap = el('span', 'game-state');
    const failed = store.hasFailed(game);
    const pending = store.needsUpload(game);
    wrap.classList.toggle('pending', pending && !failed);
    wrap.classList.toggle('failed', failed);
    wrap.title = failed ? 'Not uploaded: needs fixing' : pending ? 'Saved on this device, waiting to upload' : 'Uploaded';
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
      btn.setAttribute('aria-label', `Edit game ${number}: ${game.winner1} and ${game.winner2} beat ${game.loser1} and ${game.loser2}, ${game.winnerScore} to ${game.loserScore}`);
      const names = el('span', 'game-names');
      names.append(el('span', 'w', `${game.winner1} & ${game.winner2}`), el('span', 'l', `${game.loser1} & ${game.loser2}`));
      btn.append(
        el('span', 'game-num', number),
        names,
        el('span', 'game-score', `${game.winnerScore}–${game.loserScore}`),
        stateIcon(game),
      );
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
    state.players = (await store.getSetting('players')) || [];
    state.configured = Boolean(await store.getSetting('url'));
    state.problem = await store.getSetting('lastProblem');
    renderForm();
    renderGames();
    renderStatus();
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

  // The saved list, plus anyone typed in on this device who has not reached the sheet yet.
  function knownPlayers() {
    const names = [...state.players];
    const add = (name) => {
      if (name && !names.some((n) => sameName(n, name))) names.push(name);
    };
    state.games.filter(store.needsUpload).forEach((g) => SLOTS.forEach(([slot]) => add(g[slot])));
    Object.values(state.names).forEach(add);
    return names.sort((a, b) => a.localeCompare(b));
  }

  function renderPicker() {
    const slot = state.pickerSlot;
    const query = $('picker-search').value.trim();
    const grid = $('picker-grid');
    const taken = Object.entries(state.names).filter(([s, n]) => s !== slot && n).map(([, n]) => n);
    const players = knownPlayers();
    const matches = players.filter((n) => n.toLowerCase().includes(query.toLowerCase()));

    $('picker-title').textContent = SLOT_LABEL[slot];
    $('picker-clear').hidden = !state.names[slot];
    $('picker-empty').hidden = players.length > 0 || query.length > 0;

    grid.replaceChildren();
    matches.forEach((name) => {
      const chip = el('button', 'chip', name);
      chip.type = 'button';
      chip.disabled = taken.some((t) => sameName(t, name));
      chip.classList.toggle('current', state.names[slot] === name);
      chip.addEventListener('click', () => choosePlayer(name));
      grid.append(chip);
    });
    if (query && !players.some((n) => sameName(n, query))) {
      const add = el('button', 'chip add', `Add “${query}” as a new player`);
      add.type = 'button';
      add.addEventListener('click', () => choosePlayer(query));
      grid.append(add);
    }
  }

  function openPicker(slot) {
    state.pickerSlot = slot;
    $('picker-search').value = '';
    renderPicker();
    if (!$('picker').open) $('picker').showModal();
  }

  function choosePlayer(name) {
    const slot = state.pickerSlot;
    state.names[slot] = name;
    clearError();
    renderForm();
    // Move straight on to the next empty slot, so four names take four taps.
    const start = SLOTS.findIndex(([s]) => s === slot);
    const next = [...SLOTS.slice(start + 1), ...SLOTS.slice(0, start)].find(([s]) => !state.names[s]);
    if (next) openPicker(next[0]);
    else $('picker').close();
  }

  /* ---------- Saving ---------- */

  function showError(message) {
    $('form-error').textContent = message;
    $('form-error').hidden = false;
  }
  function clearError() {
    $('form-error').hidden = true;
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

  function resetForm() {
    state.names = { winner1: '', winner2: '', loser1: '', loser2: '' };
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
    const editingId = state.editingId;
    if (editingId) {
      await store.updateGame(editingId, (g) => ({ ...g, ...fields, rev: g.rev + 1, errorRev: null, error: null }));
    } else {
      await store.putGame({
        id: crypto.randomUUID(),
        date: state.date,
        ...fields,
        createdAt: Date.now(),
        rev: 1,
        syncedRev: 0,
        everSent: false,
        deleted: false,
      });
    }
    resetForm();
    await refresh();
    toast(editingId ? 'Game updated' : `Game ${dayGames().length} saved`);
    uploadSoon();
  }

  function startEdit(id) {
    const game = state.games.find((g) => g.id === id);
    if (!game) return;
    state.editingId = id;
    SLOTS.forEach(([slot]) => { state.names[slot] = game[slot]; });
    $('winnerScore').value = game.winnerScore;
    $('loserScore').value = game.loserScore;
    $('notes').value = game.notes;
    clearError();
    renderForm();
    renderGames();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteEditing() {
    const id = state.editingId;
    const game = state.games.find((g) => g.id === id);
    if (!game || !confirm(`Delete this game?\n${game.winner1} & ${game.winner2} ${game.winnerScore}–${game.loserScore} ${game.loser1} & ${game.loser2}`)) return;
    // A game the sheet may already hold stays queued as a deletion until the sheet confirms it.
    await store.updateGame(id, (g) => (g.everSent ? { ...g, deleted: true, rev: g.rev + 1, errorRev: null, error: null } : null));
    resetForm();
    await refresh();
    toast('Game deleted');
    uploadSoon();
  }

  /* ---------- Uploading ---------- */

  async function uploadSoon(options) {
    if (!navigator.onLine && !(options && options.force)) {
      registerBackgroundSync();
      renderStatus();
      return null;
    }
    state.uploading = true;
    renderStatus();
    const result = await store.upload(options);
    state.uploading = false;
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
    const result = await uploadSoon({ force: true });
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
  $('winnerScore').addEventListener('input', clearError);
  $('loserScore').addEventListener('input', clearError);
  $('cancel-edit').addEventListener('click', async () => {
    resetForm();
    await refresh();
  });
  $('delete').addEventListener('click', deleteEditing);

  $('date').addEventListener('change', () => {
    if (!$('date').value) return;
    state.date = $('date').value;
    state.dateChosen = state.date !== todayIso();
    renderForm();
    renderGames();
  });
  // Desktop browsers open the calendar only from a small icon, so open it from anywhere on the row.
  $('date').addEventListener('click', () => {
    try { $('date').showPicker(); } catch (err) { /* Falls back to the native behaviour. */ }
  });

  $('picker-search').addEventListener('input', renderPicker);
  $('picker-search').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = $('picker-grid').querySelector('.chip:not([disabled])');
    if (first && $('picker-search').value.trim()) first.click();
  });
  $('picker-close').addEventListener('click', () => $('picker').close());
  $('picker-clear').addEventListener('click', () => {
    state.names[state.pickerSlot] = '';
    renderForm();
    renderPicker();
  });

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

  // The online event can miss a weak signal, so keep trying while games are waiting.
  setInterval(() => {
    const waiting = state.games.some((g) => store.needsUpload(g) && !store.hasFailed(g));
    if (waiting && !state.uploading && navigator.onLine) uploadSoon();
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
    else uploadSoon({ force: true });
  });
})();
