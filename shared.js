// Device storage and upload logic. Loaded by both the page and the service worker,
// so a queued game can upload even when the app is closed (where the browser allows it).
(function (root) {
  const DB_NAME = 'court-sheet';
  const BATCH_SIZE = 20;
  const TIMEOUT_MS = 45000; // Apps Script can take a while to wake up.
  const LOCK_NAME = 'court-sheet-upload';

  let dbPromise;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('games', { keyPath: 'id' });
          req.result.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(store, mode, work) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let result;
      work(tx.objectStore(store), (value) => { result = value; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const getSetting = (key) => run('kv', 'readonly', (s, done) => {
    s.get(key).onsuccess = (e) => done(e.target.result);
  });
  const setSetting = (key, value) => run('kv', 'readwrite', (s) => { s.put(value, key); });
  const removeSetting = (key) => run('kv', 'readwrite', (s) => { s.delete(key); });
  const settingKeys = () => run('kv', 'readonly', (s, done) => {
    s.getAllKeys().onsuccess = (e) => done(e.target.result);
  });

  const allGames = () => run('games', 'readonly', (s, done) => {
    s.getAll().onsuccess = (e) => done(e.target.result.sort((a, b) => a.createdAt - b.createdAt));
  });
  const putGame = (game) => run('games', 'readwrite', (s) => { s.put(game); });
  const removeGame = (id) => run('games', 'readwrite', (s) => { s.delete(id); });

  // Read-change-write in one transaction, so an edit made during an upload is never overwritten.
  // `change` returns the updated game, or null to remove it.
  const updateGame = (id, change) => run('games', 'readwrite', (s) => {
    s.get(id).onsuccess = (e) => {
      if (!e.target.result) return;
      const next = change(e.target.result);
      if (next) s.put(next); else s.delete(id);
    };
  });

  // A game needs uploading until the server has accepted its latest revision.
  const needsUpload = (g) => g.rev !== g.syncedRev;
  const hasFailed = (g) => g.errorRev === g.rev;

  function toPayload(g) {
    return {
      id: g.id,
      date: g.date,
      winner1: g.winner1,
      winner2: g.winner2,
      winnerScore: g.winnerScore,
      loserScore: g.loserScore,
      loser1: g.loser1,
      loser2: g.loser2,
      notes: g.notes,
      deleted: g.deleted,
    };
  }

  async function post(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // text/plain keeps this a "simple" request, the only kind Apps Script accepts cross-origin.
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function exchange(url, passcode, adminPasscode, batch, dates, calendarMonths) {
    const sentRevs = new Map(batch.map((g) => [g.id, g.rev]));
    await Promise.all(batch.map((g) => updateGame(g.id, (cur) => ({ ...cur, everSent: true }))));

    const body = { passcode, games: batch.map(toPayload), dates };
    if (calendarMonths && calendarMonths.length) body.calendarMonths = calendarMonths;
    if (adminPasscode) body.adminPasscode = adminPasscode;
    const reply = await post(url, body);
    if (!reply.ok) {
      const err = new Error(reply.error || 'The script returned an error.');
      err.rejected = true;
      throw err;
    }
    if (reply.players) await setSetting('players', reply.players);
    // Only if the admin passcode wasn't changed while this request was on its way.
    const adminNow = (await getSetting('adminPasscode')) || '';
    await setSetting('admin', reply.admin === true && adminNow !== '' && adminNow === (adminPasscode || ''));
    // Days with games, for the calendar's dots.
    for (const [month, days] of Object.entries(reply.playDays || {})) {
      await setSetting('playdays:' + month, days);
    }
    for (const [month, award] of Object.entries(reply.months || {})) {
      await setSetting('month:' + month, { award, fetchedAt: Date.now() });
    }
    // Saved before the games below are marked uploaded, so the list never briefly loses one.
    for (const [date, rows] of Object.entries(reply.days || {})) {
      const award = (reply.awards && reply.awards[date]) || null; // Older scripts send none.
      await setSetting('day:' + date, { rows, award, fetchedAt: Date.now() });
    }

    for (const result of reply.results || []) {
      await updateGame(result.id, (cur) => {
        if (cur.rev !== sentRevs.get(result.id)) return cur; // Edited meanwhile: send it again.
        if (!result.ok) return { ...cur, errorRev: cur.rev, error: result.error };
        if (cur.deleted) return null;
        return { ...cur, syncedRev: cur.rev, errorRev: null, error: null };
      });
    }
    return reply;
  }

  // Always makes at least one request, which also brings back the latest games for `dates`.
  async function uploadAll(dates, calendarMonths) {
    const url = await getSetting('url');
    const passcode = await getSetting('passcode');
    const adminPasscode = await getSetting('adminPasscode');
    if (!url) return { state: 'unconfigured' };

    let lastReply = null;
    try {
      for (;;) {
        const queue = (await allGames()).filter((g) => needsUpload(g) && !hasFailed(g));
        if (!queue.length && lastReply) break;
        lastReply = await exchange(url, passcode, adminPasscode, queue.slice(0, BATCH_SIZE), dates, calendarMonths);
      }
    } catch (err) {
      const state = err.rejected ? 'rejected' : 'network';
      await setSetting('lastProblem', state === 'rejected' ? err.message : null);
      return { state, message: err.message };
    }
    await setSetting('lastProblem', null);
    return { state: 'ok', reply: lastReply };
  }

  // Page and service worker may both try at once; only one runs.
  async function upload({ dates = [], calendarMonths = [] } = {}) {
    if (root.navigator.locks) {
      return root.navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) =>
        lock ? uploadAll(dates, calendarMonths) : { state: 'busy' });
    }
    return uploadAll(dates, calendarMonths);
  }

  root.CourtSheet = {
    getSetting, setSetting, removeSetting, settingKeys, allGames, putGame, removeGame, updateGame,
    needsUpload, hasFailed, upload,
  };
})(self);
