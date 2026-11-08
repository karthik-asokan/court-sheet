# Court Sheet

A small offline-first web app for recording badminton doubles results at the court. Games are saved on the phone first, then uploaded to a Google Sheet as soon as there is a connection. Each day's games go on their own tab.

Each row uses the same columns as the court sheet: `Date, Winner 1, Winner 2, Winner Score, Loser Score, Loser 1, Loser 2, Notes`, plus a hidden `ID` column that stops retries creating duplicates. Tabs are named by date, like `2026-11-08`, newest first.

Your player list stays in your Google Sheet. It is never stored in this repository, which is public.

## Setup

### 1. Prepare the Google Sheet

Use a Google Sheet with a `Players` tab (`Name, Type, Active`). Only `Name` is required by the app, and it must be in column A for the dropdowns on the day tabs. To start from the Excel file, upload it to Drive, open it, then choose **File > Save as Google Sheets**.

### 2. Add the script

1. In the Sheet, choose **Extensions > Apps Script**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. Change `PASSCODE` at the top to a passcode of your own, then save.

### 3. Deploy the script

1. Choose **Deploy > New deployment**, then click the gear and pick **Web app**.
2. Set **Execute as** to **Me** and **Who has access** to **Anyone**. The app cannot connect with any other access setting; the passcode is what protects the Sheet.
3. Click **Deploy** and approve the permissions. Google warns that the app isn't verified because it's your own script: choose **Advanced**, then **Go to (project name)**.
4. Copy the **Web app URL**, which ends in `/exec`.

If you change the script later, use **Deploy > Manage deployments > Edit > Version: New version**. The URL stays the same.

### 4. Publish on GitHub Pages

1. Push this folder to a public GitHub repository.
2. In the repository, open **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then `main` and `/ (root)`.
3. After a minute the app is live at `https://<your-username>.github.io/<repository-name>/`.

### 5. Install on your phone

While online, open that address:

- **iPhone:** in Safari, tap **Share > Add to Home Screen**.
- **Android:** in Chrome, tap the menu, then **Add to Home screen** or **Install app**.

Open the app, go to **Settings**, enter the URL and passcode, and tap **Save and test connection**. It should report your player count. Open the app from the home screen icon from now on.

## Using it

- **Add a game:** tap a player slot, then tap four names. Winners turn green and losers red, tagged W1, W2, L1 and L2. Tap a name again to remove them, or **Clear all** to start over, then tap **Done**. Set the scores and tap **Save game**.
- **Scores:** whole numbers from 0 to 30. Anything else is ignored as you type, and the winner's score must be higher.
- **Add a new player:** type the name in the picker's search box. They join the `Players` tab as a guest; change that in the Sheet if needed.
- **Fix a mistake:** tap any game in the list to edit or delete it, including games entered on another phone. The Sheet follows.
- **Enter a past day:** tap the date at the top.
- **Remove someone from the picker:** set `Active` to `no` on the `Players` tab.
- **Status at the top:** `All uploaded`, `2 waiting` (saved on the phone), `Offline`, `1 to fix` (the Sheet rejected a game, and the reason appears in the list) or `Check settings` (wrong passcode or script problem).

## Several people entering scores

Everyone who has the web app URL and passcode can enter games. Each phone's list shows the whole day from the Sheet, with games from other phones marked **Entered on another phone**. Another phone's games appear once it has uploaded them and your phone has connected since. An open app checks about once a minute, and tapping the status at the top checks straight away.

If you try to save a game whose players and score match one already in the list, the app asks before saving it again. Rows typed straight into the Sheet appear in the list but can only be changed in the Sheet.

## How uploads work

The app retries when the connection returns, when it is reopened, and every 20 seconds while open. On Android Chrome it can also upload after being closed. On iPhone, games upload the next time you open the app.

Queued games live only on that phone until they upload, so don't clear the browser's site data while anything is waiting.

## Changing the app

Change `VERSION` in `sw.js` whenever you edit an app file, or phones keep using the cached copy. The update reaches a phone the next time the app opens online, and shows after the following launch.

To run it locally: `python -m http.server 5070` in this folder, then open http://localhost:5070. Avoid ports 5060 and 5061, which browsers block.
