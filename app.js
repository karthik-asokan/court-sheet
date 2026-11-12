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
  const MAX_SCORE = 21;
  const RETRY_MS = 20000;
  const REFRESH_MS = 60000; // How often an open app checks for games from other phones.

  const state = {
    date: todayIso(),
    dateChosen: false, // Once the user picks a date, stop following today's date.
    names: { winner1: '', winner2: '', loser1: '', loser2: '' },
    notes: '', // The game being edited keeps its notes from the sheet.
    editingId: null,
    games: [], // Games entered or changed on this phone.
    day: null, // The Sheet's copy of the shown day, from the last connection.
    players: [],
    pickerSlot: null, // The slot the next tap in the picker fills.
    uploading: false,
    lastFetch: 0,
    configured: false,
    problem: null,
    month: null, // The sheet's MONTHLY result for the shown date's month.
    owner: false, // The owner passcode was accepted: past days can be changed too.
    justLanded: null, // Games that just reached the sheet, briefly highlighted.
    loadingDate: null, // The day being fetched from the sheet right now.
    loadFailed: null, // The day whose last fetch failed.
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

  // Only today's games can be changed in the app. Other days are view-only; change them in the sheet.
  // With the owner passcode accepted, past days can be changed too. Future days never can.
  const viewOnly = () => state.date !== todayIso() && !(state.owner && state.date < todayIso());

  function renderForm() {
    $('form').hidden = viewOnly();
    // Past days: a note when they're view-only, or a small pill by the date in owner mode.
    $('past-note').hidden = !viewOnly();
    $('owner-pill').hidden = state.date === todayIso() || viewOnly();
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

    $('date').max = todayIso();
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
    // Until the sheet's copy of this day has arrived, "no games" may not be true yet.
    let empty = 'No games recorded for this day yet.';
    if (!state.day && state.configured) {
      if (state.loadingDate === state.date) empty = 'Loading this day’s games from the sheet…';
      else if (!navigator.onLine) empty = 'This day isn’t on this phone yet. Connect to the internet to see it.';
      else if (state.loadFailed === state.date) empty = 'Couldn’t load this day. Tap the status at the top to try again.';
    }
    $('games-empty').textContent = empty;
    $('games-empty').classList.toggle('loading', state.loadingDate === state.date && !state.day);

    games.map((g, i) => [g, i + 1]).reverse().forEach(([game, number]) => {
      const item = el('li');
      const btn = el('button', 'game');
      btn.type = 'button';
      btn.classList.toggle('editing', game.id === state.editingId);
      const score = `${scoreText(game.winnerScore)}–${scoreText(game.loserScore)}`;
      btn.setAttribute('aria-label', `Edit game ${number}: ${game.winner1} and ${game.winner2} beat ${game.loser1} and ${game.loser2}, ${score}`);
      const names = el('span', 'game-names');
      names.append(el('span', 'w', `${game.winner1} & ${game.winner2}`), el('span', 'l', `${game.loser1} & ${game.loser2}`));
      if (game.otherPhone) names.append(el('span', 'from', !game.id || game.id.startsWith('sheet-') ? 'Typed into the sheet' : 'Entered on another phone'));
      btn.append(el('span', 'game-num', number), names, el('span', 'game-score', score), stateIcon(game));
      if (state.justLanded && state.justLanded.has(game.id)) btn.classList.add('landed');
      if (store.hasFailed(game)) btn.append(el('span', 'game-error', game.error));
      btn.addEventListener('click', () => startEdit(game.id));
      item.append(btn);
      list.append(item);
    });
  }

  /* ---------- Player of the Day, Player of the Month and standings ---------- */

  const pts = (n) => `${String(n).replace('-', '−')} ${Math.abs(n) === 1 ? 'pt' : 'pts'}`;
  const monthName = (iso) => {
    const [y, m] = iso.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long' });
  };
  // "A", "A & B", "A, B & C".
  const joinNames = (names) => (names.length < 3 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`);
  const hasWinner = (award) => Boolean(award && award.names && award.names.length);

  // Both cards come from the sheet's own POTD and MONTHLY calculations.
  function renderAwards() {
    const award = state.day && state.day.award;
    const card = $('potd');
    card.hidden = !hasWinner(award);
    if (!card.hidden) {
      $('potd-label').textContent = award.names.length > 1 ? 'Players of the day' : 'Player of the day';
      $('potd-list').replaceChildren(...award.names.map((name) => {
        const row = el('span', 'potd-row');
        row.append(el('span', 'potd-name', name), el('span', 'potd-points', pts(award.points)));
        return row;
      }));
      $('potd-note').hidden = !state.games.some((g) => g.date === state.date && store.needsUpload(g));
      $('potd-more').textContent = `Tap for ${state.date === todayIso() ? "today's" : "the day's"} standings`;
    }

    const month = state.month && state.month.award;
    $('potm').hidden = !hasWinner(month);
    if (!$('potm').hidden) {
      $('potm-label').textContent = `${month.names.length > 1 ? 'Players' : 'Player'} of the month · ${monthName(state.date)}${state.date.slice(0, 7) === todayIso().slice(0, 7) ? ' so far' : ''}`;
      $('potm-names').textContent = joinNames(month.names);
      $('potm-points').textContent = pts(month.points);
    }
  }

  let standingsKind = 'day';
  function standingsData() {
    const award = standingsKind === 'day' ? state.day && state.day.award : state.month && state.month.award;
    const title = standingsKind === 'day' ? `Standings · ${formatDate(state.date)}` : `Standings · ${monthName(state.date)} ${state.date.slice(0, 4)}`;
    return { award, title };
  }

  function openStandings(kind) {
    standingsKind = kind;
    const { award, title } = standingsData();
    if (!award || !award.table) {
      toast('Standings appear once the sheet has been updated.');
      return;
    }
    $('standings-title').textContent = title;
    const winners = new Set(award.names);
    $('standings-sub').textContent = `${award.names.length > 1 ? 'Joint winners' : 'Winner'}: ${joinNames(award.names)}, ${pts(award.points)}. Ties go to the higher win rate.`;
    $('standings-body').replaceChildren(...award.table.map((p, i) => {
      const row = el('tr');
      if (winners.has(p.name)) row.className = 'top';
      row.append(
        el('td', 'rank', String(i + 1)),
        el('td', 'name', p.name),
        el('td', '', String(p.played)),
        el('td', '', String(p.won)),
        el('td', '', p.rate === null ? '–' : `${Math.round(p.rate * 100)}%`),
        el('td', 'points', String(p.points).replace('-', '−')),
      );
      return row;
    }));
    if (!$('standings').open) $('standings').showModal();
  }

  // Plain text that reads well in WhatsApp.
  function standingsText() {
    const { award } = standingsData();
    const heading = standingsKind === 'day'
      ? `🏸 Mavericks · ${formatDate(state.date)}\n🏆 ${award.names.length > 1 ? 'Players' : 'Player'} of the Day: ${joinNames(award.names)} (${pts(award.points)})`
      : `🏸 Mavericks · ${monthName(state.date)} ${state.date.slice(0, 4)}${state.date.slice(0, 7) === todayIso().slice(0, 7) ? ' so far' : ''}\n🏆 ${award.names.length > 1 ? 'Players' : 'Player'} of the Month: ${joinNames(award.names)} (${pts(award.points)})`;
    const lines = award.table.map((p, i) => `${i + 1}. ${p.name}: ${pts(p.points)}, won ${p.won} of ${p.played}`);
    return `${heading}\n\n${lines.join('\n')}`;
  }

  async function shareText(text, done) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // Closed the share sheet.
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch (err) {
      toast('Sharing isn’t available on this browser.');
    }
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
    state.month = (await store.getSetting('month:' + state.date.slice(0, 7))) || null;
    state.owner = (await store.getSetting('owner')) === true;
    if (viewOnly() && state.editingId) resetForm(); // Midnight passed mid-edit.
    noticeUploads();
    renderForm();
    renderGames();
    renderAwards();
    renderStatus();
    if ($('picker').open) renderPicker();
    if ($('standings').open) openStandings(standingsKind);
  }

  // A short buzz and a tick when games saved on this phone reach the sheet.
  let pendingBefore = null;
  function noticeUploads() {
    const pending = new Set(state.games.filter(store.needsUpload).map((g) => g.id));
    if (pendingBefore) {
      const landed = [...pendingBefore].filter((id) => !pending.has(id) && state.games.some((g) => g.id === id && !g.deleted));
      if (landed.length) {
        state.justLanded = new Set(landed);
        setTimeout(() => { state.justLanded = null; renderGames(); }, 1800);
        if (navigator.vibrate) navigator.vibrate(40);
        toast(landed.length === 1 ? 'In the sheet ✓' : `${landed.length} games in the sheet ✓`);
      }
    }
    pendingBefore = pending;
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
    // New players are added in the sheet's Players tab, not here.
    $('picker-none').hidden = !query || matches.length > 0;
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

  // For teams picked the wrong way round: the winners become the losers and back. The losers'
  // score stays as typed, since it's the score that tells which side won.
  function swapSides() {
    const n = state.names;
    state.names = { winner1: n.loser1, winner2: n.loser2, loser1: n.winner1, loser2: n.winner2 };
    state.pickerSlot = null;
    clearError();
    renderForm();
    if (Object.values(state.names).some(Boolean)) toast('Winners and losers swapped');
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

  // The losers' score: whole numbers from 0 to 20 only. Anything else typed is dropped as it is typed.
  function sanitizeScore(input) {
    let value = input.value.replace(/\D/g, '').slice(0, 2);
    if (value !== '') value = String(Math.min(LOSER_MAX, Number(value)));
    if (input.value !== value) input.value = value;
  }

  function readScore(id) {
    const raw = $(id).value.trim();
    return raw === '' ? null : Number(raw);
  }

  // Games are to 15. From 14 all they go on until one side is 2 ahead, with a hard stop at 21.
  const GAME_TO = 15;
  const LOSER_MAX = MAX_SCORE - 1;

  // The winners' score follows from the losers': 15 if they reached 13 or less, 2 ahead from 14 all,
  // and 21 if it went to 20 all.
  function winnerFor(loserScore) {
    if (loserScore === null || loserScore <= GAME_TO - 2) return GAME_TO;
    return Math.min(MAX_SCORE, loserScore + 2);
  }
  function showWinnerScore() {
    $('winnerScore').value = String(winnerFor(readScore('loserScore')));
  }
  function realFinish(w, l) {
    if (w === GAME_TO) return l <= GAME_TO - 2;
    return w > GAME_TO && w <= MAX_SCORE && (w - l === 2 || (w === MAX_SCORE && l === MAX_SCORE - 1));
  }

  function validate(winnerScore, loserScore) {
    const names = Object.values(state.names);
    if (names.some((n) => !n)) return 'Pick all four players.';
    if (loserScore === null) return 'Enter the losers\' score.';
    if (!Number.isInteger(loserScore) || loserScore < 0 || loserScore > LOSER_MAX) {
      return `The losers' score must be a whole number from 0 to ${LOSER_MAX}.`;
    }
    if (!realFinish(winnerScore, loserScore)) return 'A game ends at 15 with the losers on 13 or less. From 14 all it goes on until one side is 2 ahead (16–14, 17–15 … 21–19), with a hard stop at 21–20.';
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
    state.notes = '';
    clearError();
  }

  async function saveGame(event) {
    event.preventDefault();
    const winnerScore = readScore('winnerScore');
    const loserScore = readScore('loserScore');
    const problem = viewOnly() ? 'Only today\'s games can be saved. Change other days in the sheet.' : validate(winnerScore, loserScore);
    if (problem) {
      showError(problem);
      return;
    }

    const fields = { ...state.names, winnerScore, loserScore, notes: state.notes };
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

  async function startEdit(id) {
    const game = id && dayGames().find((g) => g.id === id);
    if (viewOnly()) {
      // A change made here on a past day that never reached the sheet can't upload any more.
      const mine = id && state.games.find((g) => g.id === id && store.needsUpload(g));
      if (mine && confirm('This change is from a past day, so it can no longer upload. Remove it from this phone?\nIf it should count, enter it in the sheet by hand.')) {
        await store.removeGame(id);
        await refresh();
        toast('Removed from this phone');
      } else if (!mine) {
        toast('Past days are view-only. Change them in the sheet.');
      }
      return;
    }
    if (!game) {
      toast('This game was typed into the Sheet. Change it there.');
      return;
    }
    state.editingId = id;
    SLOTS.forEach(([slot]) => { state.names[slot] = game[slot]; });
    $('loserScore').value = game.loserScore ?? '';
    showWinnerScore();
    state.notes = game.notes || ''; // Kept as is: notes can only be changed in the sheet.
    clearError();
    renderForm();
    renderGames();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteEditing() {
    const id = state.editingId;
    const game = dayGames().find((g) => g.id === id);
    if (viewOnly()) return;
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
    let result;
    let date;
    // Another upload (an earlier tap, the timer, or the service worker) may be running. Rather than
    // skip this one, wait for it, and keep going until the day now on screen has been fetched.
    for (let tries = 0; tries < 60; tries++) {
      date = state.date;
      state.loadingDate = date;
      renderStatus();
      renderGames();
      result = await store.upload({ dates: [date] });
      if (result.state === 'busy') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (result.state !== 'ok' || state.date === date) break;
    }
    state.uploading = false;
    state.loadingDate = null;
    state.loadFailed = result.state === 'ok' ? null : date;
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

  async function openSettings(message) {
    const url = (await store.getSetting('url')) || '';
    if (!$('set-url').value || !$('settings').open) $('set-url').value = url;
    $('set-pass').value = (await store.getSetting('passcode')) || '';
    $('set-owner').value = (await store.getSetting('ownerPasscode')) || '';
    $('share-setup').disabled = !url;
    $('settings-msg').hidden = true;
    if (typeof message === 'string') settingsMessage(message);
    showVersion();
    if (!$('settings').open) $('settings').showModal();
  }

  // The running version, as the service worker reports it.
  function showVersion() {
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!worker) {
      $('app-version').textContent = '';
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => { $('app-version').textContent = `App version ${event.data}`; };
    worker.postMessage({ type: 'version' }, [channel.port2]);
  }

  /* ---------- Setup link ---------- */

  // A link to this app with the web app URL after #setup=. Opening it fills in Settings.
  const setupLink = (url) => `${location.origin}${location.pathname}#setup=${encodeURIComponent(url)}`;
  function urlFromSetup(text) {
    const match = /#setup=([^\s&]+)/.exec(text || '');
    if (!match) return text;
    try {
      return decodeURIComponent(match[1]);
    } catch (err) {
      return text;
    }
  }

  async function readSetupLink() {
    if (!location.hash.startsWith('#setup=')) return false;
    const url = urlFromSetup(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (!/^https:\/\/script\.google\.com\//.test(url)) return false;
    $('set-url').value = url;
    await openSettings('Web app URL filled in from the setup link. Enter the passcode, then tap Save and test connection.');
    $('set-url').value = url;
    return true;
  }

  function settingsMessage(text, bad) {
    const node = $('settings-msg');
    node.textContent = text;
    node.classList.toggle('bad', Boolean(bad));
    node.hidden = false;
  }

  async function saveSettings(event) {
    event.preventDefault();
    // A pasted setup link works too.
    const url = urlFromSetup($('set-url').value.trim()).trim();
    $('set-url').value = url;
    const passcode = $('set-pass').value;
    const ownerPasscode = $('set-owner').value;
    if (!url) {
      settingsMessage('Paste the web app URL first.', true);
      return;
    }
    await store.setSetting('url', url);
    await store.setSetting('passcode', passcode);
    await store.setSetting('ownerPasscode', ownerPasscode);
    if (!ownerPasscode) await store.setSetting('owner', false);
    $('share-setup').disabled = false;
    settingsMessage('Testing…');
    const result = await uploadSoon();
    await refresh();
    if (result && result.state === 'ok') {
      const count = (await store.getSetting('players') || []).length;
      let owner = '';
      if (ownerPasscode) {
        owner = state.owner ? ' Owner mode is on: past days can be changed on this phone.' : ' The owner passcode wasn’t accepted, so past days stay view-only.';
      }
      settingsMessage(`Connected. ${count} players loaded.${owner}`, Boolean(ownerPasscode && !state.owner));
    } else if (result && result.state === 'rejected') {
      settingsMessage(result.message, true);
    } else if (result && result.state === 'busy') {
      settingsMessage('An upload is already running. Try again in a moment.', true);
    } else {
      settingsMessage('Could not reach the script. Check you are online, the URL ends in /exec, and the deployment allows access by “Anyone”.', true);
    }
  }

  /* ---------- Wiring ---------- */

  document.querySelectorAll('.slot').forEach((btn) => {
    btn.addEventListener('click', () => openPicker(btn.dataset.slot));
  });

  $('form').addEventListener('submit', saveGame);
  $('loserScore').addEventListener('input', () => {
    sanitizeScore($('loserScore'));
    showWinnerScore();
    clearError();
  });
  $('cancel-edit').addEventListener('click', async () => {
    resetForm();
    await refresh();
  });
  $('delete').addEventListener('click', deleteEditing);

  $('date').addEventListener('change', async () => {
    if (!$('date').value) return;
    state.date = $('date').value > todayIso() ? todayIso() : $('date').value; // No future dates.
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
  $('swap-sides').addEventListener('click', swapSides);

  $('status').addEventListener('click', () => {
    if (!state.configured || state.problem) openSettings();
    else uploadSoon();
  });
  $('open-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => $('settings').close());
  $('settings-form').addEventListener('submit', saveSettings);
  $('share-setup').addEventListener('click', async () => {
    const url = await store.getSetting('url');
    if (!url) return;
    const link = setupLink(url);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Mavericks games', text: 'Set up the Mavericks games app (ask for the passcode):', url: link });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast('Setup link copied');
    } catch (err) {
      toast('Sharing isn’t available on this browser.');
    }
  });

  window.addEventListener('hashchange', readSetupLink); // A setup link opened while the app is showing.

  $('potd').addEventListener('click', () => openStandings('day'));
  $('potm').addEventListener('click', () => openStandings('month'));
  $('standings-close').addEventListener('click', () => $('standings').close());
  $('standings-share').addEventListener('click', () => shareText(standingsText(), 'Standings copied, ready to paste'));

  [$('picker'), $('settings'), $('standings')].forEach((dialog) => {
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
    // Left open past midnight on today's page: move on to the new day.
    if (!state.dateChosen && !state.editingId && state.date !== todayIso()) {
      state.date = todayIso();
      refresh();
    }
    if (state.uploading || !navigator.onLine || !state.configured || document.visibilityState !== 'visible') return;
    const waiting = state.games.some((g) => store.needsUpload(g) && !store.hasFailed(g));
    if (waiting || Date.now() - state.lastFetch > REFRESH_MS) uploadSoon();
  }, RETRY_MS);

  /* ---------- Updates ---------- */

  // A new version installs itself in the background. When it takes over, offer to reload.
  if ('serviceWorker' in navigator) {
    const hadWorker = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 30 * 60 * 1000);
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data === 'games-changed') refresh();
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadWorker) $('update-banner').hidden = false; // The first install needs no reload.
    });
  }
  $('update-now').addEventListener('click', () => location.reload());
  // Ask the browser not to evict queued games when storage runs low.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  /* ---------- Tidying ---------- */

  // Keeps a rolling 30 days on the phone. Older games are dropped once they're safely in the sheet;
  // picking an older date fetches it from the sheet again.
  const KEEP_DAYS = 30;
  async function tidy() {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5);
    const pad = (n) => String(n).padStart(2, '0');
    const oldest = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
    for (const game of await store.allGames()) {
      if (game.date < oldest && !store.needsUpload(game)) await store.removeGame(game.id);
    }
    for (const key of await store.settingKeys()) {
      const day = /^day:(\d{4}-\d{2}-\d{2})$/.exec(key);
      const month = /^month:(\d{4}-\d{2})$/.exec(key);
      if ((day && day[1] < oldest) || (month && month[1] < oldest.slice(0, 7))) await store.removeSetting(key);
    }
  }

  resetForm();
  tidy().catch(() => {}).then(refresh).then(async () => {
    if (await readSetupLink()) return;
    if (!state.configured) openSettings();
    else uploadSoon();
  });
})();
