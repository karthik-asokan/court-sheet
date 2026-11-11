# Mavericks

An offline-first web app for recording the Mavericks club's badminton doubles results at the court. Games are saved on the phone first, then uploaded to Google Sheets as soon as there is a connection.

Each month gets its own points-system file in your Google Drive **games** folder, for example `Mavericks_Points System_Scores_Nov' 26`. The script creates it from a template when that month's first game arrives. Inside it:

- **`MONTHLY`**: Player of the Month.
- **One games tab per play day**, such as `08-NOV`, with the columns `GAME NO., PLAYER 1, PLAYER 2, SCORE, POINTS, VS, PLAYER 3, PLAYER 4, SCORE, POINTS`. The winners are always Players 1 and 2. A `NOTES` column follows for anything you type straight into the sheet (the app has no notes box, and keeps a game's notes when you edit it), and a hidden `ID` column stops retries creating duplicate rows.
- **One Player of the Day tab per play day**, such as `08-NOV POTD`.

The Player of the Day and `MONTHLY` tabs have the club logo on the left of the title and the player silhouette on the right. The script adds them from this site ([`icons/icon-192.png`](icons/icon-192.png) and [`images/silhouette.png`](images/silhouette.png)) to any such tab that has no pictures yet.

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
   Optionally, set `OWNER_PASSCODE` to a second passcode that only you know (see **Owner mode** below). Leave it as `''` to keep it off.
5. Save, choose **setUp** in the function menu at the top, and click **Run**. Approve the permissions when asked. Google warns that the app isn't verified because it's your own script: choose **Advanced**, then **Go to (project name)**. This creates **Mavericks Template** in the games folder.
6. Open **Project Settings** (the gear on the left) and check **Time zone** is yours. The script uses it to decide what "today" is.

You can restyle the template's fonts, colours and widths. New months copy its `MONTHLY` tab and its hidden `DAY` and `DAY POTD` tabs. Keep the column order and tab names.

### 3. Deploy the script

1. Choose **Deploy > New deployment**, then click the gear and pick **Web app**.
2. Set **Execute as** to **Me** and **Who has access** to **Anyone**. The app can't connect with any other access setting; the passcode is what protects your sheets.
3. Click **Deploy**, then copy the **Web app URL**, which ends in `/exec`.

If you change the script later, use **Deploy > Manage deployments > Edit > Version: New version**. The URL stays the same.

### 4. Connect each phone

To set up a new member's phone, tap **Share setup link** in your app's Settings and send it to them. Opening it fills in the web app URL; they only type the passcode, which is never in the link. Pasting the link into the URL box works too.

Otherwise, open https://karthik-asokan.github.io/court-sheet/ while online. Add it to the home screen: on iPhone, in Safari tap **Share > Add to Home Screen**; on Android, in Chrome tap the menu, then **Add to Home screen** or **Install app**.

Open the app, go to **Settings**, enter the web app URL and passcode, and tap **Save and test connection**. It should report your player count.

## Using it

- **Add a game:** tap a player slot, then tap four names. Winners turn green and losers red, tagged W1, W2, L1 and L2. The four slots also appear at the top of the picker; tap one to clear it. Tap a name again to remove them, or **Clear all** to start over, then tap **Done**. Type the losers' score and tap **Save game**. Picked the teams the wrong way round? Tap the round ⇅ button between the two cards to swap winners and losers.
- **Player of the Day:** a gold trophy card between **Save game** and the games list shows the day's Player of the Day and their points, read from that day's POTD tab. Joint winners are each listed. It updates whenever the phone connects; while this phone has games waiting to upload, it says so.
- **Standings:** tap the trophy card for the day's full table (played, won, win rate and points for everyone who played, winners highlighted). **Share** sends it as text through the phone's share sheet, ready for WhatsApp; where sharing isn't available it's copied instead.
- **Player of the Month:** a smaller card under it shows the MONTHLY tab's leader so far. Tap it for the month's standings.
- **Upload confirmation:** when a game reaches the sheet the phone gives a short buzz (Android) and shows **In the sheet ✓**, and the game briefly lights up.
- **Guests:** tap **GUEST** once for each guest playing. Several guests can play in one game.
- **Scores:** you only type the losers' score, from 0 to 20. The winners' score fills itself in: games are to 15, so it's 15 when the losers reached 13 or less. From 14 all the game goes on until one side is 2 ahead (16–14, 17–15 … 21–19), with a hard stop at 21: at 20 all, the next point wins 21–20. The script checks the same rule.
- **Add a new player:** add a row to the Players tab of the Mavericks Players sheet, with `yes` in Active. Phones pick it up the next time they connect. The picker's search box only finds existing players. The script refuses any game with a name that isn't in the Players tab (GUEST excepted), and writes names the way the tab spells them. Players set to `no` still count, so their games can be saved.
- **Fix a mistake:** on the day itself, tap any game in the list to edit or delete it, including games entered on another phone. The sheet follows. Deleting a day's last game removes that day's tabs.
- **Only today can be changed:** tap the date at the top to look back at a past day's games and Player of the Day, but past days are view-only, and future dates can't be picked. The script enforces this with Google's clock, so changing a phone's date doesn't get round it. To change a past day, edit the sheet. Games that didn't upload before midnight are refused and show as `to fix`; tap one to remove it from the phone, and enter it in the sheet if it should count.
- **Owner mode:** enter the `OWNER_PASSCODE` as **Owner passcode** in Settings to add, change and delete games on past days from that phone. Future dates stay blocked. Clear the box to turn it off. Everyone else stays today-only.
- **Storage:** each phone keeps a rolling 30 days. Older games are removed once they're in the sheet; anything not yet uploaded is kept. Picking an older date downloads it from the sheet again when you're online.
- **Status at the top:** `All uploaded`, `2 waiting` (saved on the phone), `Offline`, `1 to fix` (the sheet rejected a game; the reason appears in the list) or `Check settings` (wrong passcode, missing folder ID or a script problem).

## Several people entering scores

Everyone who has the web app URL and passcode can enter games. Each phone's list shows the whole day from the sheet, with games from other phones marked **Entered on another phone**. Another phone's games appear once it has uploaded them and your phone has connected since. An open app checks about once a minute, and tapping the status at the top checks straight away.

If you try to save a game whose players and score match one already in the list, the app asks before saving it again. Rows typed straight into the sheet appear in the list marked **Typed into the sheet**. The script gives each one an ID (in the hidden ID column, starting `sheet-`) the first time a phone reads that day, so they can be edited and deleted from the app like any other game, within the usual today-only rule or in owner mode.

## How uploads work

The app retries when the connection returns, when it is reopened, and every 20 seconds while open. On Android Chrome it can also upload after being closed. On iPhone, games upload the next time you open the app.

Queued games live only on that phone until they upload, so don't clear the browser's site data while anything is waiting.

## Changing the app

Change `VERSION` in `sw.js` whenever you edit an app file, or phones keep using the cached copy. Open apps check for a new version when they come to the front and every 30 minutes; when one has downloaded, a **A new version of the app is ready · Update** banner appears. Settings shows the version each phone is running.

To run it locally: `python -m http.server 5070` in this folder, then open http://localhost:5070. Avoid ports 5060 and 5061, which browsers block.
