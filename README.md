# Mavericks games

An offline-first web app for recording the Mavericks club's badminton doubles results at the court. Games are saved on the phone first, then uploaded to Google Sheets as soon as there is a connection.

Each month gets its own points-system file in your Google Drive **games** folder, for example `Mavericks_Points System_Scores_Nov' 26`. The script creates it from a template when that month's first game arrives. Inside it:

- **`MONTHLY`**: Player of the Month.
- **One games tab per play day**, such as `08-NOV`, with the columns `GAME NO., PLAYER 1, PLAYER 2, SCORE, POINTS, VS, PLAYER 3, PLAYER 4, SCORE, POINTS`. The winners are always Players 1 and 2. A `NOTES` column follows, and a hidden `ID` column stops retries creating duplicate rows.
- **One Player of the Day tab per play day**, such as `08-NOV POTD`.

## Points

| Result | Winners each | Losers each |
|---|---|---|
| Normal win, such as 15–12 | 1 | 0 |
| Deuce win, with the winner above 15, such as 17–15 | 2 | 0 |
| Losers held to 7 or below, such as 15–6 | 2 | −1 |

The POINTS columns are formulas, so correcting a score by hand in the sheet also fixes the points and the awards.

**Player of the Day and Player of the Month** go to the most points. A tie goes to the higher win rate, and if that's level too, the award is shared. GUEST players never win awards. Every active player is listed, plus anyone else who played. The tables are rebuilt each time a game is saved, so new players appear automatically.

Your player names live only in your Google Sheet, never in this repository, which is public.

## Setup

### 1. Create the Mavericks Players sheet

1. In your **games** folder in Google Drive, create a new Google Sheet named **Mavericks Players**.
2. Name the first tab **Players**, with the headers `Name` in A1 and `Active` in B1.
3. Add one player per row, with `yes` in Active. Set Active to `no` to hide someone from the app without losing their history. You can paste in a prepared list; GUEST is optional, because the app always offers it.

### 2. Add the script

1. In the Mavericks Players sheet, choose **Extensions > Apps Script**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. At the top, set `PASSCODE` to a passcode of your own.
4. Set `FOLDER_ID` to your games folder's ID: open the folder in Drive and copy the code after `/folders/` in the address bar.
5. Save, choose **setUp** in the function menu at the top, and click **Run**. Approve the permissions when asked. Google warns that the app isn't verified because it's your own script: choose **Advanced**, then **Go to (project name)**. This creates **Mavericks Template** in the games folder.

You can restyle the template's fonts, colours and widths. New months copy its `MONTHLY` tab and its hidden `DAY` and `DAY POTD` tabs. Keep the column order and tab names.

### 3. Deploy the script

1. Choose **Deploy > New deployment**, then click the gear and pick **Web app**.
2. Set **Execute as** to **Me** and **Who has access** to **Anyone**. The app can't connect with any other access setting; the passcode is what protects your sheets.
3. Click **Deploy**, then copy the **Web app URL**, which ends in `/exec`.

If you change the script later, use **Deploy > Manage deployments > Edit > Version: New version**. The URL stays the same.

### 4. Connect each phone

Open https://karthik-asokan.github.io/court-sheet/ while online. Add it to the home screen: on iPhone, in Safari tap **Share > Add to Home Screen**; on Android, in Chrome tap the menu, then **Add to Home screen** or **Install app**.

Open the app, go to **Settings**, enter the web app URL and passcode, and tap **Save and test connection**. It should report your player count.

## Using it

- **Add a game:** tap a player slot, then tap four names. Winners turn green and losers red, tagged W1, W2, L1 and L2. The four slots also appear at the top of the picker; tap one to clear it. Tap a name again to remove them, or **Clear all** to start over, then tap **Done**. Set the scores and tap **Save game**.
- **Guests:** tap **GUEST** once for each guest playing. Several guests can play in one game.
- **Scores:** whole numbers from 0 to 30. Anything else is ignored as you type, and the winner's score must be higher.
- **Add a new player:** type the name in the picker's search box. They join the Players tab as active.
- **Fix a mistake:** tap any game in the list to edit or delete it, including games entered on another phone. The sheet follows. Deleting a day's last game removes that day's tabs.
- **Enter a past day:** tap the date at the top. Games go into the file for that day's month.
- **Status at the top:** `All uploaded`, `2 waiting` (saved on the phone), `Offline`, `1 to fix` (the sheet rejected a game; the reason appears in the list) or `Check settings` (wrong passcode, missing folder ID or a script problem).
- **Open this month's sheet:** the link at the bottom of Settings.

## Several people entering scores

Everyone who has the web app URL and passcode can enter games. Each phone's list shows the whole day from the sheet, with games from other phones marked **Entered on another phone**. Another phone's games appear once it has uploaded them and your phone has connected since. An open app checks about once a minute, and tapping the status at the top checks straight away.

If you try to save a game whose players and score match one already in the list, the app asks before saving it again. Rows typed straight into the sheet appear in the list but can only be changed in the sheet.

## How uploads work

The app retries when the connection returns, when it is reopened, and every 20 seconds while open. On Android Chrome it can also upload after being closed. On iPhone, games upload the next time you open the app.

Queued games live only on that phone until they upload, so don't clear the browser's site data while anything is waiting.

## Changing the app

Change `VERSION` in `sw.js` whenever you edit an app file, or phones keep using the cached copy. The update reaches a phone the next time the app opens online, and shows after the following launch.

To run it locally: `python -m http.server 5070` in this folder, then open http://localhost:5070. Avoid ports 5060 and 5061, which browsers block.
