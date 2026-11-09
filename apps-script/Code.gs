/**
 * Mavericks backend, bound to the "Mavericks Players" sheet (which holds the Players tab).
 * Each month's games go into their own points-system file in the games folder, copied from the
 * template. Setup steps are in the README.
 */

// Choose your own passcode, then enter the same one in the app's Settings.
const PASSCODE = 'change-me';
// The ID of your "games" folder: the code after /folders/ in the folder's web address.
const FOLDER_ID = 'paste-your-folder-id';

const TEMPLATE_NAME = 'Mavericks Template';
const FILE_PREFIX = 'Mavericks_Points System_Scores_';
const GUEST = 'GUEST';
const GAME_TO = 15;
const MAX_SCORE = 21;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_TAB = /^(\d\d)-[A-Z]{3}$/;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const MONTHLY = 'MONTHLY';
const DAY_PROTO = 'DAY';
const POTD_PROTO = 'DAY POTD';
const POTD_LABEL = 'PLAYER OF THE DAY';
const DAY_HEADERS = ['GAME NO.', 'PLAYER 1', 'PLAYER 2', 'SCORE', 'POINTS', '', 'PLAYER 3', 'PLAYER 4', 'SCORE', 'POINTS', 'NOTES', 'ID'];
const DAY_WIDTHS = [90, 120, 120, 75, 75, 40, 120, 120, 75, 75, 170];
const ID_COLUMN = DAY_HEADERS.length;
const STAT_HEADERS = ['PLAYER', 'TOTAL\nGAMES PLAYED', 'GAMES WON', 'GAMES LOST', 'WIN\nRATE %', 'POINTS'];
const STAT_WIDTHS = [130, 100, 85, 85, 85, 80];
// Pictures in the title row of every POTD and MONTHLY tab, served with the app.
const LOGO_URL = 'https://karthik-asokan.github.io/court-sheet/icons/icon-192.png';
const SILHOUETTE_URL = 'https://karthik-asokan.github.io/court-sheet/images/silhouette.png';
const SILHOUETTE_RATIO = 203 / 183; // width / height
const TITLE_HEIGHT = 130;
const PLAYER_HEADERS = ['Name', 'Active'];

function doGet() {
  return ContentService.createTextOutput('Mavericks script is running.');
}

// Run this once from the editor: it asks for Google's permissions and creates the Players tab
// and the template in your games folder.
function setUp() {
  ensurePlayersTab_(SpreadsheetApp.getActiveSpreadsheet());
  template_();
}

function doPost(e) {
  let request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: 'The request could not be read.' });
  }
  if (PASSCODE === 'change-me') {
    return reply_({ ok: false, error: 'Set a PASSCODE in the script, then deploy a new version.' });
  }
  if (request.passcode !== PASSCODE) {
    return reply_({ ok: false, error: 'Wrong passcode.' });
  }
  if (FOLDER_ID === 'paste-your-folder-id') {
    return reply_({ ok: false, error: 'Paste your games folder ID into FOLDER_ID, then deploy a new version.' });
  }

  const control = SpreadsheetApp.getActiveSpreadsheet();
  const games = request.games || [];
  let results = [];
  const warnings = [];
  // Only writes need the lock, so phones that are just checking for new games never wait.
  if (games.length) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(25000);
    } catch (err) {
      return reply_({ ok: false, error: 'The sheet is busy. Try again in a moment.' });
    }
    try {
      const touched = new Set();
      results = games.map((game) => {
        try {
          saveGame_(control, game);
          touched.add(game.date);
          return { id: game.id, ok: true };
        } catch (err) {
          return { id: game.id, ok: false, error: err.message };
        }
      });
      // The games are saved either way; a problem here only affects the award tabs.
      touched.forEach((date) => {
        try {
          refreshDay_(control, date);
        } catch (err) {
          warnings.push('Could not update the points tables for ' + date + ': ' + err.message);
        }
      });
    } finally {
      lock.releaseLock();
    }
  }

  // Send back every game on the days asked about, so each phone sees what the others entered.
  const dates = (request.dates || []).concat(games.map((g) => g.date)).filter((d) => ISO_DATE.test(String(d)));
  if (games.length) SpreadsheetApp.flush(); // So the award formulas below reflect these games.
  const days = {};
  const awards = {};
  dates.forEach((date) => {
    days[date] = readDay_(date);
    awards[date] = readAward_(date);
  });
  const shown = dates.length ? monthFile_(dates[0], false) : null;
  return reply_({
    ok: true,
    results: results,
    days: days,
    awards: awards,
    players: activePlayers_(control),
    sheetUrl: shown ? shown.getUrl() : folder_().getUrl(),
    warnings: warnings,
  });
}

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Saving games ---------- */

// Adds, replaces or removes one game. Retrying is safe: the game's ID finds its existing row,
// so a connection that drops mid-upload can never create a duplicate.
function saveGame_(control, game) {
  validateGame_(game);
  const ss = monthFile_(game.date, !game.deleted);
  if (!ss) return; // Deleting from a month that has no file: nothing to do.
  const tab = dayTab_(ss, game.date, !game.deleted);
  if (!tab) return;
  const existing = findRow_(tab, game.id);

  if (game.deleted) {
    if (existing) tab.deleteRow(existing);
    return;
  }

  [game.winner1, game.winner2, game.loser1, game.loser2].forEach((name) => ensurePlayer_(control, name));
  const r = existing || Math.max(tab.getLastRow(), 1) + 1;
  tab.getRange(r, 1, 1, ID_COLUMN).setValues([[
    '=ROW()-1',
    safeText_(game.winner1),
    safeText_(game.winner2),
    game.winnerScore,
    // Winner: 2 for a deuce win (above 15) or holding the loser to 7 or below, otherwise 1.
    `=IF(OR(D${r}="",I${r}=""),"",IF(OR(D${r}>15,I${r}<=7),2,1))`,
    'VS',
    safeText_(game.loser1),
    safeText_(game.loser2),
    game.loserScore,
    // Loser: -1 when held to 7 or below, otherwise 0.
    `=IF(OR(D${r}="",I${r}=""),"",IF(I${r}<=7,-1,0))`,
    safeText_(game.notes),
    game.id,
  ]]);
}

function validateGame_(game) {
  if (!game.id) throw new Error('Game has no ID.');
  if (!ISO_DATE.test(game.date || '') || isNaN(new Date(game.date + 'T00:00:00Z'))) {
    throw new Error('Invalid date.');
  }
  if (game.deleted) return;

  const names = [game.winner1, game.winner2, game.loser1, game.loser2].map((n) => String(n || '').trim().toLowerCase());
  if (names.some((n) => !n)) throw new Error('All four players are required.');
  // Several guests can share the name GUEST; everyone else may appear only once.
  const members = names.filter((n) => n !== GUEST.toLowerCase());
  if (new Set(members).size !== members.length) throw new Error('A player appears twice in this game.');

  const validScore = (s) => Number.isInteger(s) && s >= 0 && s <= MAX_SCORE;
  if (!validScore(game.winnerScore) || !validScore(game.loserScore)) {
    throw new Error('Scores must be whole numbers from 0 to ' + MAX_SCORE + '.');
  }
  if (game.winnerScore <= game.loserScore) throw new Error('The winner score must be higher than the loser score.');
  // Games are to 15. From 14 all they go on until one side is 2 ahead, with a hard stop at 21.
  const w = game.winnerScore, l = game.loserScore;
  const realFinish = w === GAME_TO ? l <= GAME_TO - 2
    : w > GAME_TO && w <= MAX_SCORE && (w - l === 2 || (w === MAX_SCORE && l === MAX_SCORE - 1));
  if (!realFinish) throw new Error('A game ends at 15 with the losers on 13 or less. From 14 all it goes on until one side is 2 ahead (16–14, 17–15 … 21–19), with a hard stop at 21–20.');
}

function findRow_(tab, id) {
  const last = tab.getLastRow();
  if (last < 2) return 0;
  const ids = tab.getRange(2, ID_COLUMN, last - 1, 1).getValues();
  const index = ids.findIndex((row) => row[0] === id);
  return index < 0 ? 0 : index + 2;
}

// A day's games in sheet order. Rows typed straight into the sheet have no ID.
function readDay_(date) {
  const ss = monthFile_(date, false);
  const tab = ss && ss.getSheetByName(dayTabName_(date));
  if (!tab || tab.getLastRow() < 2) return [];
  const text = (v) => String(v).trim();
  const score = (v) => (v === '' ? null : Number(v));
  return tab.getRange(2, 1, tab.getLastRow() - 1, ID_COLUMN).getValues()
    .map((r) => ({
      id: text(r[11]),
      winner1: text(r[1]),
      winner2: text(r[2]),
      winnerScore: score(r[3]),
      loserScore: score(r[8]),
      loser1: text(r[6]),
      loser2: text(r[7]),
      notes: text(r[10]),
    }))
    .filter((g) => g.winner1 || g.winner2 || g.loser1 || g.loser2);
}

// The day's Player of the Day, as worked out by the formulas on its POTD tab:
// { names: ['A', 'B'], points: 12 }, or null before anyone has played.
function readAward_(date) {
  const ss = monthFile_(date, false);
  const tab = ss && ss.getSheetByName(dayTabName_(date) + ' POTD');
  if (!tab || tab.getLastRow() < 3) return null;
  const rows = tab.getRange(3, 1, tab.getLastRow() - 2, 6).getValues();
  const row = rows.find((r) => String(r[0]).trim() === POTD_LABEL);
  if (!row) return null;
  const names = String(row[1]).split(',').map((n) => n.trim()).filter(Boolean);
  const points = Number(row[5]);
  if (!names.length || row[5] === '' || !isFinite(points)) return null;
  return { names: names, points: points };
}

/* ---------- Monthly files and day tabs ---------- */

function folder_() {
  return DriveApp.getFolderById(FOLDER_ID);
}

function monthFileName_(date) {
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  return FILE_PREFIX + month.charAt(0) + month.slice(1).toLowerCase() + "' " + date.slice(2, 4);
}

function dayTabName_(date) {
  return date.slice(8, 10) + '-' + MONTHS[Number(date.slice(5, 7)) - 1];
}

function firstFile_(files) {
  while (files.hasNext()) {
    const file = files.next();
    if (!file.isTrashed()) return file;
  }
  return null;
}

// The month's file, found by name in the games folder, or copied from the template if `create`.
function monthFile_(date, create) {
  const props = PropertiesService.getScriptProperties();
  const key = 'file:' + date.slice(0, 7);
  const cached = props.getProperty(key);
  if (cached) {
    try {
      if (!DriveApp.getFileById(cached).isTrashed()) return SpreadsheetApp.openById(cached);
    } catch (err) { /* Deleted or no longer shared: look it up again. */ }
  }
  let file = firstFile_(folder_().getFilesByName(monthFileName_(date)));
  if (!file) {
    if (!create) return null;
    file = template_().makeCopy(monthFileName_(date), folder_());
  }
  props.setProperty(key, file.getId());
  return SpreadsheetApp.openById(file.getId());
}

// The template in the games folder, created the first time it's needed. Restyle it freely:
// new months copy its MONTHLY tab and its hidden DAY and DAY POTD tabs.
function template_() {
  const found = firstFile_(folder_().getFilesByName(TEMPLATE_NAME));
  if (found) return found;
  const ss = SpreadsheetApp.create(TEMPLATE_NAME);
  const monthly = ss.getSheets()[0];
  monthly.setName(MONTHLY);
  styleStatsTab_(monthly);
  styleDayTab_(ss.insertSheet(DAY_PROTO));
  styleStatsTab_(ss.insertSheet(POTD_PROTO));
  ss.getSheetByName(DAY_PROTO).hideSheet();
  ss.getSheetByName(POTD_PROTO).hideSheet();
  const file = DriveApp.getFileById(ss.getId());
  file.moveTo(folder_());
  return file;
}

function styleDayTab_(tab) {
  tab.getRange(1, 1, 1, DAY_HEADERS.length).setValues([DAY_HEADERS])
    .setFontWeight('bold').setFontLine('underline');
  tab.getRange(1, 1, tab.getMaxRows(), ID_COLUMN - 1).setHorizontalAlignment('center').setVerticalAlignment('middle');
  tab.getRange(1, 11, tab.getMaxRows(), 1).setHorizontalAlignment('left');
  tab.setFrozenRows(1);
  DAY_WIDTHS.forEach((width, i) => tab.setColumnWidth(i + 1, width));
  tab.hideColumns(ID_COLUMN);
}

function styleStatsTab_(tab) {
  tab.getRange(1, 1, 1, 6).merge().setFontWeight('bold').setFontSize(14).setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  tab.getRange(2, 1, 1, 6).setValues([STAT_HEADERS]).setFontWeight('bold').setFontLine('underline')
    .setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('middle');
  STAT_WIDTHS.forEach((width, i) => tab.setColumnWidth(i + 1, width));
  addTitlePictures_(tab);
}

// The club logo at the left of the title row and the player silhouette at the right. Skipped
// if the tab already has pictures, so a tab you've restyled by hand is left alone.
function addTitlePictures_(tab) {
  try {
    if (tab.getImages().length) return;
    tab.setRowHeight(1, TITLE_HEIGHT);
    const size = TITLE_HEIGHT - 8;
    tab.insertImage(LOGO_URL, 1, 1, 4, 4).setWidth(size).setHeight(size);
    const width = Math.round(size * SILHOUETTE_RATIO);
    const offset = Math.max(0, STAT_WIDTHS[4] + STAT_WIDTHS[5] - width - 4);
    tab.insertImage(SILHOUETTE_URL, 5, 1, offset, 4).setWidth(width).setHeight(size);
  } catch (err) {
    console.warn('Could not add the title pictures: ' + err); // Decoration only; carry on.
  }
}

// The day's games tab, plus its POTD tab, created from the hidden templates in date order.
function dayTab_(ss, date, create) {
  const name = dayTabName_(date);
  const existing = ss.getSheetByName(name);
  if (existing || !create) return existing;

  let dayProto = ss.getSheetByName(DAY_PROTO);
  let potdProto = ss.getSheetByName(POTD_PROTO);
  if (!dayProto) { dayProto = ss.insertSheet(DAY_PROTO); styleDayTab_(dayProto); dayProto.hideSheet(); }
  if (!potdProto) { potdProto = ss.insertSheet(POTD_PROTO); styleStatsTab_(potdProto); potdProto.hideSheet(); }

  const position = dayPosition_(ss, date);
  const tab = ss.insertSheet(name, position, { template: dayProto });
  tab.showSheet();
  ss.insertSheet(name + ' POTD', position + 1, { template: potdProto }).showSheet();
  return tab;
}

// Days run oldest to newest, after MONTHLY.
function dayPosition_(ss, date) {
  const day = Number(date.slice(8, 10));
  const sheets = ss.getSheets();
  let after = Math.max(0, sheets.findIndex((s) => s.getName() === MONTHLY) + 1);
  for (let i = 0; i < sheets.length; i++) {
    const m = /^(\d\d)-[A-Z]{3}( POTD)?$/.exec(sheets[i].getName());
    if (!m) continue;
    if (!m[2] && Number(m[1]) > day) return i;
    after = i + 1;
  }
  return after;
}

/* ---------- Player of the Day and Player of the Month ---------- */

// Rebuilds the day's POTD tab and the month's MONTHLY tab, or removes the day if it's now empty.
function refreshDay_(control, date) {
  const ss = monthFile_(date, false);
  if (!ss) return;
  const name = dayTabName_(date);
  const games = ss.getSheetByName(name);
  const potd = ss.getSheetByName(name + ' POTD');
  if (games && games.getLastRow() < 2) {
    ss.deleteSheet(games);
    if (potd) ss.deleteSheet(potd);
  } else if (games && potd) {
    const title = 'POTD\n\n' + date.slice(8, 10) + '-' + MONTHS[Number(date.slice(5, 7)) - 1] + '-' + date.slice(0, 4);
    writeStats_(potd, title, statsPlayers_(control, [games]), [name], POTD_LABEL);
  }
  const days = ss.getSheets().filter((s) => DAY_TAB.test(s.getName()));
  const monthly = ss.getSheetByName(MONTHLY) || ss.insertSheet(MONTHLY, 0);
  const title = "POTM\n\n" + MONTHS[Number(date.slice(5, 7)) - 1] + "' " + date.slice(0, 4);
  writeStats_(monthly, title, statsPlayers_(control, days), days.map((s) => s.getName()), 'PLAYER OF THE MONTH');
}

// Every active member, plus anyone who played in these tabs. Guests never appear.
function statsPlayers_(control, dayTabs) {
  const names = activePlayers_(control);
  dayTabs.forEach((tab) => {
    if (tab.getLastRow() < 2) return;
    tab.getRange(2, 2, tab.getLastRow() - 1, 7).getValues().forEach((r) => {
      [r[0], r[1], r[5], r[6]].forEach((v) => names.push(String(v).trim()));
    });
  });
  const seen = new Set();
  return names
    .filter((n) => {
      const key = n.toLowerCase();
      if (!n || key === GUEST.toLowerCase() || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
}

// Fills a POTD or MONTHLY tab with one formula row per player, summed over `dayNames`, and
// the award row underneath. Formulas keep it right if a game is corrected by hand in the sheet.
function writeStats_(tab, title, players, dayNames, label) {
  tab.getRange(1, 1).setValue(title);
  addTitlePictures_(tab); // For tabs made before the pictures existed, or copied without them.
  const body = tab.getRange(3, 1, tab.getMaxRows() - 2, 6);
  body.breakApart().clearContent().setFontWeight('normal').setBackground(null);
  if (!players.length) return;

  const q = (name) => "'" + name.replace(/'/g, "''") + "'";
  const total = (part) => (dayNames.length ? dayNames.map((d) => part(q(d))).join('+') : '0');
  const rows = players.map((player, i) => {
    const r = i + 3;
    const won = (t) => `COUNTIF(${t}!$B:$C,$A${r})`;
    const lost = (t) => `COUNTIF(${t}!$G:$H,$A${r})`;
    const points = (t) => `SUMIF(${t}!$B:$B,$A${r},${t}!$E:$E)+SUMIF(${t}!$C:$C,$A${r},${t}!$E:$E)`
      + `+SUMIF(${t}!$G:$G,$A${r},${t}!$J:$J)+SUMIF(${t}!$H:$H,$A${r},${t}!$J:$J)`;
    return [
      safeText_(player),
      '=' + total((t) => `${won(t)}+${lost(t)}`),
      '=' + total(won),
      `=B${r}-C${r}`,
      `=IF(B${r}=0,"",C${r}/B${r})`,
      '=' + total(points),
    ];
  });
  const last = players.length + 2;
  tab.getRange(3, 1, players.length, 6).setValues(rows).setHorizontalAlignment('center');
  tab.getRange(3, 5, players.length, 1).setNumberFormat('0%');

  // Most points among players who played; a tie goes to the higher win rate, then is shared.
  const range = (col) => `${col}3:${col}${last}`;
  const top = `MAXIFS(${range('F')},${range('B')},">0")`;
  const bestRate = `MAXIFS(${range('E')},${range('B')},">0",${range('F')},${top})`;
  const awardRow = last + 2;
  tab.getRange(awardRow, 1, 1, 6).setValues([[
    label,
    `=IFERROR(TEXTJOIN(", ",TRUE,FILTER(${range('A')},${range('B')}>0,${range('F')}=${top},${range('E')}=${bestRate})),"")`,
    '', '', '',
    `=IF(COUNTIF(${range('B')},">0")=0,"",${top})`,
  ]]).setFontWeight('bold').setBackground('#E8F0EC').setHorizontalAlignment('center');
  tab.getRange(awardRow, 2, 1, 4).merge();
}

/* ---------- Players ---------- */

function ensurePlayersTab_(control) {
  let tab = control.getSheetByName('Players');
  if (!tab) {
    tab = control.insertSheet('Players', 0);
    tab.getRange(1, 1, 1, PLAYER_HEADERS.length).setValues([PLAYER_HEADERS]).setFontWeight('bold');
    tab.setFrozenRows(1);
  }
  return tab;
}

function readPlayers_(control) {
  const tab = ensurePlayersTab_(control);
  const values = tab.getDataRange().getValues();
  const headers = values[0].map((h) => String(h).trim().toLowerCase());
  const nameAt = Math.max(0, headers.indexOf('name'));
  const activeAt = headers.indexOf('active');
  return values.slice(1)
    .map((row) => ({
      name: String(row[nameAt] || '').trim(),
      active: activeAt < 0 || String(row[activeAt]).trim().toLowerCase() !== 'no',
    }))
    .filter((p) => p.name);
}

// The names offered in the app. GUEST is always available.
function activePlayers_(control) {
  const names = readPlayers_(control).filter((p) => p.active).map((p) => p.name);
  if (!names.some((n) => n.toLowerCase() === GUEST.toLowerCase())) names.push(GUEST);
  return names;
}

// Someone typed into the app joins the Players tab. Filled in by column name, so the tab's
// columns can be reordered or added to.
function ensurePlayer_(control, name) {
  const wanted = name.trim().toLowerCase();
  if (wanted === GUEST.toLowerCase()) return;
  if (readPlayers_(control).some((p) => p.name.toLowerCase() === wanted)) return;
  const tab = ensurePlayersTab_(control);
  const values = { name: safeText_(name.trim()), active: 'yes' };
  const headers = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0];
  tab.appendRow(headers.map((h) => values[String(h).trim().toLowerCase()] || ''));
}

// Stops typed text being run as a spreadsheet formula.
function safeText_(value) {
  const text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
