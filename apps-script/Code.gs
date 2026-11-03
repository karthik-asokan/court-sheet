/**
 * Court Sheet backend. Receives games from the app and writes each day's games to its own tab.
 * Setup steps are in the README.
 */

// Choose your own passcode, then enter the same one in the app's Settings.
const PASSCODE = 'change-me';

const GAME_HEADERS = ['Date', 'Winner 1', 'Winner 2', 'Winner Score', 'Loser Score', 'Loser 1', 'Loser 2', 'Notes', 'ID'];
const ID_COLUMN = GAME_HEADERS.length;
const PLAYER_HEADERS = ['Name', 'Type', 'Active'];
const COLUMN_WIDTHS = [90, 130, 130, 95, 95, 130, 130, 170];
const MAX_SCORE = 30;
const DATE_TAB = /^\d{4}-\d{2}-\d{2}$/;

function doGet() {
  return ContentService.createTextOutput('Court Sheet script is running.');
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

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return reply_({ ok: false, error: 'The sheet is busy. Try again in a moment.' });
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const results = (request.games || []).map((game) => {
      try {
        saveGame_(ss, game);
        return { id: game.id, ok: true };
      } catch (err) {
        return { id: game.id, ok: false, error: err.message };
      }
    });
    return reply_({ ok: true, results: results, players: activePlayers_(ss), sheetUrl: ss.getUrl() });
  } finally {
    lock.releaseLock();
  }
}

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

// Adds, replaces or removes one game. Retrying is safe: the game's ID finds its existing row,
// so a connection that drops mid-upload can never create a duplicate.
function saveGame_(ss, game) {
  validateGame_(game);
  const tab = ss.getSheetByName(game.date);
  const rowNumber = tab ? findRow_(tab, game.id) : 0;

  if (game.deleted) {
    if (rowNumber) {
      tab.deleteRow(rowNumber);
      if (tab.getLastRow() <= 1) ss.deleteSheet(tab);
    }
    return;
  }

  [game.winner1, game.winner2, game.loser1, game.loser2].forEach((name) => ensurePlayer_(ss, name));
  const row = [
    dateSerial_(game.date),
    safeText_(game.winner1),
    safeText_(game.winner2),
    game.winnerScore,
    game.loserScore,
    safeText_(game.loser1),
    safeText_(game.loser2),
    safeText_(game.notes),
    game.id,
  ];
  if (rowNumber) {
    tab.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  } else {
    (tab || createDayTab_(ss, game.date)).appendRow(row);
  }
}

function validateGame_(game) {
  if (!game.id) throw new Error('Game has no ID.');
  if (!DATE_TAB.test(game.date || '') || isNaN(new Date(game.date + 'T00:00:00Z'))) {
    throw new Error('Invalid date.');
  }
  if (game.deleted) return;

  const names = [game.winner1, game.winner2, game.loser1, game.loser2].map((n) => String(n || '').trim().toLowerCase());
  if (names.some((n) => !n)) throw new Error('All four players are required.');
  if (new Set(names).size !== 4) throw new Error('A player appears twice in this game.');

  const validScore = (s) => Number.isInteger(s) && s >= 0 && s <= MAX_SCORE;
  if (!validScore(game.winnerScore) || !validScore(game.loserScore)) {
    throw new Error('Scores must be whole numbers from 0 to ' + MAX_SCORE + '.');
  }
  if (game.winnerScore <= game.loserScore) throw new Error('The winner score must be higher than the loser score.');
}

function findRow_(tab, id) {
  const last = tab.getLastRow();
  if (last < 2) return 0;
  const ids = tab.getRange(2, ID_COLUMN, last - 1, 1).getValues();
  const index = ids.findIndex((row) => row[0] === id);
  return index < 0 ? 0 : index + 2;
}

// Newest day first, placed after any non-date tabs such as Players.
function createDayTab_(ss, date) {
  const sheets = ss.getSheets();
  let position = sheets.findIndex((s) => DATE_TAB.test(s.getName()) && s.getName() < date);
  if (position < 0) position = sheets.length;

  const tab = ss.insertSheet(date, position);
  tab.getRange(1, 1, 1, GAME_HEADERS.length)
    .setValues([GAME_HEADERS])
    .setBackground('#1F6F5C')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  tab.setFrozenRows(1);
  COLUMN_WIDTHS.forEach((width, i) => tab.setColumnWidth(i + 1, width));
  tab.hideColumns(ID_COLUMN);
  tab.getRange(2, 1, tab.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy');

  const rows = tab.getMaxRows() - 1;
  const players = ensurePlayersTab_(ss).getRange('A2:A500');
  const nameRule = SpreadsheetApp.newDataValidation().requireValueInRange(players, true).setAllowInvalid(true).build();
  const scoreRule = SpreadsheetApp.newDataValidation().requireNumberBetween(0, MAX_SCORE).setAllowInvalid(true).build();
  tab.getRange(2, 2, rows, 2).setDataValidation(nameRule);
  tab.getRange(2, 6, rows, 2).setDataValidation(nameRule);
  tab.getRange(2, 4, rows, 2).setDataValidation(scoreRule);
  return tab;
}

function ensurePlayersTab_(ss) {
  let tab = ss.getSheetByName('Players');
  if (!tab) {
    tab = ss.insertSheet('Players');
    tab.getRange(1, 1, 1, PLAYER_HEADERS.length)
      .setValues([PLAYER_HEADERS])
      .setBackground('#1F6F5C')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    tab.setFrozenRows(1);
  }
  return tab;
}

function readPlayers_(ss) {
  const tab = ensurePlayersTab_(ss);
  const values = tab.getDataRange().getValues();
  const headers = values[0].map((h) => String(h).trim().toLowerCase());
  const nameAt = headers.indexOf('name');
  const activeAt = headers.indexOf('active');
  return values.slice(1)
    .map((row) => ({
      name: String(row[nameAt] || '').trim(),
      active: activeAt < 0 || String(row[activeAt]).trim().toLowerCase() !== 'no',
    }))
    .filter((p) => p.name);
}

function activePlayers_(ss) {
  return readPlayers_(ss).filter((p) => p.active).map((p) => p.name);
}

// Someone added in the app joins the Players tab as a guest. Filled in by column name,
// so the tab's columns can be reordered or changed.
function ensurePlayer_(ss, name) {
  const wanted = name.trim().toLowerCase();
  if (readPlayers_(ss).some((p) => p.name.toLowerCase() === wanted)) return;
  const tab = ensurePlayersTab_(ss);
  const values = { name: safeText_(name.trim()), type: 'guest', active: 'yes' };
  const headers = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0];
  tab.appendRow(headers.map((h) => values[String(h).trim().toLowerCase()] || ''));
}

// Days since 30 Dec 1899, how Sheets stores dates. A plain number cannot shift across time zones.
function dateSerial_(date) {
  return Date.parse(date + 'T00:00:00Z') / 86400000 + 25569;
}

// Stops typed text being run as a spreadsheet formula.
function safeText_(value) {
  const text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
