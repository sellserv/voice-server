# Game Activity Detection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect running games on the desktop app, display "Playing X" under usernames in the user list and friends list, with configurable visibility per server.

**Architecture:** Electron main process scans OS processes against a games database, sends detected game via IPC to renderer, which forwards to the server via WebSocket. Server broadcasts activity to other users respecting visibility settings. Client displays activity in user list and home sidebar.

**Tech Stack:** Electron IPC, Node.js child_process, electron-store, WebSocket events, Svelte stores

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `desktop/games.json` | Starter database of ~200 popular game executables |
| Create | `desktop/gameDetector.js` | Process scanner + game matching logic |
| Modify | `desktop/main.js` | Start game detector, wire IPC handlers |
| Modify | `desktop/preload.js` | Expose game activity IPC to renderer |
| Modify | `shared/types.ts` | Add `presence:activity` client event and `activity` field to presence events |
| Modify | `server/src/ws/index.ts` | Store activity on client, broadcast with visibility |
| Modify | `server/src/ws/handlers.ts` | Handle `presence:activity` event |
| Modify | `client/src/lib/stores/presence.ts` | Add `activity` field to `OnlineUser` |
| Modify | `client/src/routes/+layout.svelte` | Handle `presence:activity` WS event, forward desktop game changes |
| Modify | `client/src/lib/components/UserList.svelte` | Show "Playing X" under username |
| Modify | `client/src/lib/components/HomeSidebar.svelte` | Show "Playing X" in friends/DM list |
| Modify | `client/src/lib/components/SettingsModal.svelte` | Add "Game Activity" settings tab |
| Modify | `client/src/electron.d.ts` | Add game activity type declarations |

---

### Task 1: Create Games Database

**Files:**
- Create: `desktop/games.json`

- [ ] **Step 1: Create the games database file**

A JSON object mapping lowercase executable names to display names. ~200 popular games across FPS, MOBA, RPG, sandbox, racing, battle royale, and indie categories.

```json
{
  "valorant.exe": "Valorant",
  "csgo.exe": "Counter-Strike 2",
  "cs2.exe": "Counter-Strike 2",
  "fortnite.exe": "Fortnite",
  "fortniteclient-win64-shipping.exe": "Fortnite",
  "rocketleague.exe": "Rocket League",
  "minecraft.exe": "Minecraft",
  "javaw.exe": "Minecraft",
  "gta5.exe": "Grand Theft Auto V",
  "eldenring.exe": "Elden Ring",
  "overwatch.exe": "Overwatch 2",
  "leagueoflegends.exe": "League of Legends",
  "league of legends.exe": "League of Legends",
  "dota2.exe": "Dota 2",
  "apex_legends.exe": "Apex Legends",
  "r5apex.exe": "Apex Legends",
  "pubg.exe": "PUBG: Battlegrounds",
  "tslgame.exe": "PUBG: Battlegrounds",
  "rainbowsix.exe": "Rainbow Six Siege",
  "destiny2.exe": "Destiny 2",
  "diablo iv.exe": "Diablo IV",
  "starfield.exe": "Starfield",
  "baldursgate3.exe": "Baldur's Gate 3",
  "bg3.exe": "Baldur's Gate 3",
  "hogwartslegacy.exe": "Hogwarts Legacy",
  "cyberpunk2077.exe": "Cyberpunk 2077",
  "witcher3.exe": "The Witcher 3",
  "terraria.exe": "Terraria",
  "stardewvalley.exe": "Stardew Valley",
  "stardew valley.exe": "Stardew Valley",
  "hollowknight.exe": "Hollow Knight",
  "celeste.exe": "Celeste",
  "hades.exe": "Hades",
  "hadesii.exe": "Hades II",
  "deadcells.exe": "Dead Cells",
  "factorio.exe": "Factorio",
  "satisfactory.exe": "Satisfactory",
  "amongus.exe": "Among Us",
  "among us.exe": "Among Us",
  "fall guys.exe": "Fall Guys",
  "fallguys_client.exe": "Fall Guys",
  "phasmophobia.exe": "Phasmophobia",
  "lethalcompany.exe": "Lethal Company",
  "palworld.exe": "Palworld",
  "rustclient.exe": "Rust",
  "rust.exe": "Rust",
  "ark.exe": "ARK: Survival Evolved",
  "arkascended.exe": "ARK: Survival Ascended",
  "dayz.exe": "DayZ",
  "7daystodie.exe": "7 Days to Die",
  "theforest.exe": "The Forest",
  "sonsoftheforest.exe": "Sons of the Forest",
  "subnautica.exe": "Subnautica",
  "noita.exe": "Noita",
  "cuphead.exe": "Cuphead",
  "sekiro.exe": "Sekiro: Shadows Die Twice",
  "darksoulsiii.exe": "Dark Souls III",
  "darksouls.exe": "Dark Souls",
  "monsterhunterworld.exe": "Monster Hunter: World",
  "monsterhunterrise.exe": "Monster Hunter Rise",
  "nierautomata.exe": "NieR: Automata",
  "persona5royal.exe": "Persona 5 Royal",
  "finalfantasyxiv.exe": "Final Fantasy XIV",
  "ffxiv.exe": "Final Fantasy XIV",
  "ffxiv_dx11.exe": "Final Fantasy XIV",
  "wow.exe": "World of Warcraft",
  "wowclassic.exe": "World of Warcraft Classic",
  "guildwars2-64.exe": "Guild Wars 2",
  "eso64.exe": "The Elder Scrolls Online",
  "newworld.exe": "New World",
  "lostark.exe": "Lost Ark",
  "warframe.x64.exe": "Warframe",
  "warframe.exe": "Warframe",
  "pathofexile.exe": "Path of Exile",
  "pathofexile_x64.exe": "Path of Exile",
  "hearthstone.exe": "Hearthstone",
  "mtga.exe": "Magic: The Gathering Arena",
  "gwent.exe": "GWENT",
  "fifa24.exe": "EA FC 24",
  "fifa.exe": "EA FC",
  "nba2k24.exe": "NBA 2K24",
  "madden24.exe": "Madden NFL 24",
  "forzahorizon5.exe": "Forza Horizon 5",
  "forzahorizon4.exe": "Forza Horizon 4",
  "forzamotorsport.exe": "Forza Motorsport",
  "assettocorsa.exe": "Assetto Corsa",
  "iracing.exe": "iRacing",
  "eurotrucks2.exe": "Euro Truck Simulator 2",
  "ats.exe": "American Truck Simulator",
  "msfs.exe": "Microsoft Flight Simulator",
  "flightsimulator.exe": "Microsoft Flight Simulator",
  "kerbalspaceprogram.exe": "Kerbal Space Program",
  "kerbalspaceprogram2.exe": "Kerbal Space Program 2",
  "civ6.exe": "Civilization VI",
  "civ5.exe": "Civilization V",
  "totalwar.exe": "Total War",
  "stellaris.exe": "Stellaris",
  "eu4.exe": "Europa Universalis IV",
  "hoi4.exe": "Hearts of Iron IV",
  "ck3.exe": "Crusader Kings III",
  "citiesii.exe": "Cities: Skylines II",
  "cities.exe": "Cities: Skylines",
  "planetcoaster.exe": "Planet Coaster",
  "rimworld.exe": "RimWorld",
  "prisonarchitect.exe": "Prison Architect",
  "sims4.exe": "The Sims 4",
  "ts4_x64.exe": "The Sims 4",
  "left4dead2.exe": "Left 4 Dead 2",
  "back4blood.exe": "Back 4 Blood",
  "deeprockgalactic.exe": "Deep Rock Galactic",
  "helldivers2.exe": "Helldivers 2",
  "payday2_win32_release.exe": "Payday 2",
  "payday3client.exe": "Payday 3",
  "gtav.exe": "Grand Theft Auto V",
  "playgtav.exe": "Grand Theft Auto V",
  "rdr2.exe": "Red Dead Redemption 2",
  "hitman3.exe": "Hitman: World of Assassination",
  "control.exe": "Control",
  "deathstranding.exe": "Death Stranding",
  "ghostoftsushima.exe": "Ghost of Tsushima",
  "godofwar.exe": "God of War",
  "horizonzerodawn.exe": "Horizon Zero Dawn",
  "horizonforbiddenwest.exe": "Horizon Forbidden West",
  "spiderman.exe": "Marvel's Spider-Man",
  "spidermanmm.exe": "Marvel's Spider-Man: Miles Morales",
  "uncharted4.exe": "Uncharted 4",
  "thelastofus.exe": "The Last of Us Part I",
  "residentevil4.exe": "Resident Evil 4",
  "re4.exe": "Resident Evil 4",
  "residentevilvillage.exe": "Resident Evil Village",
  "alanwake2.exe": "Alan Wake 2",
  "silenthill2.exe": "Silent Hill 2",
  "deadspace.exe": "Dead Space",
  "doom.exe": "DOOM",
  "doometernel.exe": "DOOM Eternal",
  "halflife2.exe": "Half-Life 2",
  "portal2.exe": "Portal 2",
  "teardown.exe": "Teardown",
  "garrymod.exe": "Garry's Mod",
  "gmod.exe": "Garry's Mod",
  "tf2.exe": "Team Fortress 2",
  "hl2.exe": "Half-Life 2",
  "dontstarve.exe": "Don't Starve",
  "oxygennottincluded.exe": "Oxygen Not Included",
  "inscryption.exe": "Inscryption",
  "slayspire.exe": "Slay the Spire",
  "slaythespire.exe": "Slay the Spire",
  "undertale.exe": "Undertale",
  "deltarune.exe": "Deltarune",
  "animalwell.exe": "Animal Well",
  "raftgame.exe": "Raft",
  "valheim.exe": "Valheim",
  "vrising.exe": "V Rising",
  "grounded.exe": "Grounded",
  "astroneer.exe": "Astroneer",
  "seaofthieves.exe": "Sea of Thieves",
  "nomansky.exe": "No Man's Sky",
  "outerworlds.exe": "The Outer Worlds",
  "outerwilds.exe": "Outer Wilds",
  "dysonsphereprog.exe": "Dyson Sphere Program",
  "shapezio.exe": "shapez",
  "robloxplayerbeta.exe": "Roblox",
  "robloxplayer.exe": "Roblox",
  "osu!.exe": "osu!",
  "beatsaber.exe": "Beat Saber",
  "vrchat.exe": "VRChat",
  "chivalry2.exe": "Chivalry 2",
  "mordhau.exe": "Mordhau",
  "escapefromtarkov.exe": "Escape from Tarkov",
  "huntshowdown.exe": "Hunt: Showdown",
  "squad.exe": "Squad",
  "arma3.exe": "Arma 3",
  "arma3_x64.exe": "Arma 3",
  "insurgency.exe": "Insurgency: Sandstorm",
  "readyornot.exe": "Ready or Not",
  "groundbranch.exe": "Ground Branch",
  "marvelrivals.exe": "Marvel Rivals",
  "thefinals.exe": "THE FINALS",
  "deadlock.exe": "Deadlock",
  "spectre_divide.exe": "Spectre Divide",
  "wutheringwaves.exe": "Wuthering Waves",
  "zenlesszonezero.exe": "Zenless Zone Zero",
  "genshinimpact.exe": "Genshin Impact",
  "yuanshen.exe": "Genshin Impact",
  "starrail.exe": "Honkai: Star Rail",
  "honkaistarrail.exe": "Honkai: Star Rail"
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/games.json
git commit -m "feat: add starter games database (200 popular titles)"
```

---

### Task 2: Create Game Detector Module

**Files:**
- Create: `desktop/gameDetector.js`

- [ ] **Step 1: Create the game detector**

```javascript
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Load built-in games database
const builtinGames = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'games.json'), 'utf-8')
);

let currentGame = null;
let interval = null;
let onGameChange = null;

function getRunningProcesses() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? 'tasklist /fo csv /nh'
      : 'ps -eo comm --no-headers';

    exec(cmd, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve([]); return; }

      if (isWin) {
        // Parse CSV: "process.exe","PID","Session","Session#","Mem Usage"
        const names = stdout.split('\n')
          .map(line => line.match(/^"([^"]+)"/))
          .filter(Boolean)
          .map(m => m[1].toLowerCase());
        resolve([...new Set(names)]);
      } else {
        const names = stdout.split('\n')
          .map(line => line.trim().toLowerCase())
          .filter(Boolean);
        resolve([...new Set(names)]);
      }
    });
  });
}

async function detectGame(customGames) {
  const processes = await getRunningProcesses();

  // Merge built-in + custom games (custom takes priority)
  const allGames = { ...builtinGames, ...customGames };

  for (const proc of processes) {
    const gameName = allGames[proc];
    if (gameName) return gameName;
  }

  return null;
}

function start(store, callback) {
  onGameChange = callback;

  interval = setInterval(async () => {
    const customGames = store.get('customGames', {});
    const enabled = store.get('gameActivityEnabled', true);

    if (!enabled) {
      if (currentGame !== null) {
        currentGame = null;
        onGameChange(null);
      }
      return;
    }

    const detected = await detectGame(customGames);

    if (detected !== currentGame) {
      currentGame = detected;
      onGameChange(detected);
    }
  }, 10000); // Check every 10 seconds
}

function stop() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  currentGame = null;
}

function getCurrentGame() {
  return currentGame;
}

module.exports = { start, stop, getCurrentGame };
```

- [ ] **Step 2: Commit**

```bash
git add desktop/gameDetector.js
git commit -m "feat: add game detector module with process scanning"
```

---

### Task 3: Wire Electron Main Process + Preload

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`

- [ ] **Step 1: Add game detector to main.js**

Add near the top imports:
```javascript
const gameDetector = require('./gameDetector');
```

In the `app.whenReady()` or after window creation, start the detector:
```javascript
// Start game detection
gameDetector.start(store, (game) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('game:activity-changed', game);
  }
});
```

Add IPC handlers near the other `ipcMain.handle` calls:
```javascript
ipcMain.handle('game:getCurrent', () => gameDetector.getCurrentGame());
ipcMain.handle('game:getSettings', () => ({
  enabled: store.get('gameActivityEnabled', true),
  visibility: store.get('gameActivityVisibility', 'all'),
  selectedServerIds: store.get('gameActivityServerIds', []),
  customGames: store.get('customGames', {}),
}));
ipcMain.handle('game:setEnabled', (_e, enabled) => store.set('gameActivityEnabled', enabled));
ipcMain.handle('game:setVisibility', (_e, visibility) => store.set('gameActivityVisibility', visibility));
ipcMain.handle('game:setServerIds', (_e, ids) => store.set('gameActivityServerIds', ids));
ipcMain.handle('game:addCustomGame', (_e, exe, name) => {
  const custom = store.get('customGames', {});
  custom[exe.toLowerCase()] = name;
  store.set('customGames', custom);
});
ipcMain.handle('game:removeCustomGame', (_e, exe) => {
  const custom = store.get('customGames', {});
  delete custom[exe.toLowerCase()];
  store.set('customGames', custom);
});
ipcMain.handle('game:getCustomGames', () => store.get('customGames', {}));
```

In `app.on('before-quit')` or window close, stop the detector:
```javascript
gameDetector.stop();
```

- [ ] **Step 2: Add preload API**

Add to `preload.js` inside `contextBridge.exposeInMainWorld`:
```javascript
// Game Activity
getGameSettings: () => ipcRenderer.invoke('game:getSettings'),
getCurrentGame: () => ipcRenderer.invoke('game:getCurrent'),
setGameEnabled: (enabled) => ipcRenderer.invoke('game:setEnabled', enabled),
setGameVisibility: (visibility) => ipcRenderer.invoke('game:setVisibility', visibility),
setGameServerIds: (ids) => ipcRenderer.invoke('game:setServerIds', ids),
addCustomGame: (exe, name) => ipcRenderer.invoke('game:addCustomGame', exe, name),
removeCustomGame: (exe) => ipcRenderer.invoke('game:removeCustomGame', exe),
getCustomGames: () => ipcRenderer.invoke('game:getCustomGames'),
onGameActivityChanged: (callback) => {
  const handler = (_e, game) => callback(game);
  ipcRenderer.on('game:activity-changed', handler);
  return () => ipcRenderer.removeListener('game:activity-changed', handler);
},
```

- [ ] **Step 3: Update electron.d.ts**

Add to the `ElectronAPI` interface in `client/src/electron.d.ts`:
```typescript
getGameSettings: () => Promise<{
  enabled: boolean;
  visibility: 'all' | 'selected';
  selectedServerIds: string[];
  customGames: Record<string, string>;
}>;
getCurrentGame: () => Promise<string | null>;
setGameEnabled: (enabled: boolean) => Promise<void>;
setGameVisibility: (visibility: 'all' | 'selected') => Promise<void>;
setGameServerIds: (ids: string[]) => Promise<void>;
addCustomGame: (exe: string, name: string) => Promise<void>;
removeCustomGame: (exe: string) => Promise<void>;
getCustomGames: () => Promise<Record<string, string>>;
onGameActivityChanged: (callback: (game: string | null) => void) => () => void;
```

- [ ] **Step 4: Commit**

```bash
git add desktop/main.js desktop/preload.js client/src/electron.d.ts
git commit -m "feat: wire game detector IPC in Electron main + preload"
```

---

### Task 4: Add WebSocket Events and Server Handling

**Files:**
- Modify: `shared/types.ts`
- Modify: `server/src/ws/index.ts`
- Modify: `server/src/ws/handlers.ts`

- [ ] **Step 1: Add types to shared/types.ts**

Add to `ClientEvent` union:
```typescript
| { type: 'presence:activity'; game: string | null; visibility: 'all' | 'selected'; serverIds?: string[] }
```

Add `activity?: string` field to the `presence:update` ServerEvent (the one with `online: boolean`).

Add `activity?: string` field to the `presence:list` users array type.

- [ ] **Step 2: Add activity storage to server ws/index.ts**

Add `activity?: string | null` and `activityVisibility?: 'all' | 'selected'` and `activityServerIds?: string[]` to the `ConnectedClient` interface.

In `getOnlineUsers(serverId?)`, include the activity field — but only if the user's visibility allows it for that server:
```typescript
// In the map callback for getOnlineUsers:
const showActivity = !serverId ||
  c.activityVisibility === 'all' ||
  (c.activityVisibility === 'selected' && c.activityServerIds?.includes(serverId));
```

Return `activity: showActivity ? c.activity : undefined` in the user object.

In the `presence:list` event (sent on connect), include `activity` in each user object.

- [ ] **Step 3: Handle presence:activity in handlers.ts**

Add a case in the main message handler switch:
```typescript
case 'presence:activity':
  handlePresenceActivity(user, event.game, event.visibility, event.serverIds);
  break;
```

Implement the handler:
```typescript
function handlePresenceActivity(user: JwtPayload, game: string | null, visibility: 'all' | 'selected', serverIds?: string[]) {
  const client = getClient(user.userId);
  if (!client) return;

  client.activity = game;
  client.activityVisibility = visibility;
  client.activityServerIds = serverIds;

  // Broadcast to relevant servers
  if (visibility === 'all') {
    broadcast({
      type: 'presence:activity',
      userId: user.userId,
      activity: game,
    });
  } else if (serverIds && serverIds.length > 0) {
    for (const serverId of serverIds) {
      broadcastToServer(serverId, {
        type: 'presence:activity',
        userId: user.userId,
        activity: game,
      });
    }
  }
}
```

Add `presence:activity` to `ServerEvent` union:
```typescript
| { type: 'presence:activity'; userId: string; activity: string | null }
```

- [ ] **Step 4: Commit**

```bash
git add shared/types.ts server/src/ws/index.ts server/src/ws/handlers.ts
git commit -m "feat: add presence:activity WebSocket event with server visibility"
```

---

### Task 5: Update Client Stores and Layout Event Handler

**Files:**
- Modify: `client/src/lib/stores/presence.ts`
- Modify: `client/src/routes/+layout.svelte`

- [ ] **Step 1: Add activity to presence store**

Add `activity?: string` to the `OnlineUser` interface.

Update `setUserOnline` to accept optional activity parameter:
```typescript
export function setUserOnline(
  userId: string,
  username: string,
  display_name?: string,
  status: UserStatus = 'online',
  activity?: string,
) {
  onlineUsers.update((map) => {
    map.set(userId, { userId, username, display_name, status, activity });
    return new Map(map);
  });
}
```

Add `updateUserActivity` function:
```typescript
export function updateUserActivity(userId: string, activity: string | null) {
  onlineUsers.update((map) => {
    const user = map.get(userId);
    if (user) {
      map.set(userId, { ...user, activity: activity || undefined });
    }
    return new Map(map);
  });
}
```

- [ ] **Step 2: Handle events in +layout.svelte**

Add `updateUserActivity` to imports from presence store.

Add case in WS event handler:
```typescript
case 'presence:activity':
  updateUserActivity(event.userId, event.activity);
  break;
```

Add desktop game detection listener in `onMount` (only on desktop):
```typescript
if (window.electronAPI?.onGameActivityChanged) {
  const cleanup = window.electronAPI.onGameActivityChanged(async (game) => {
    const settings = await window.electronAPI!.getGameSettings();
    if (!settings.enabled) return;
    sendWs({
      type: 'presence:activity',
      game,
      visibility: settings.visibility,
      serverIds: settings.visibility === 'selected' ? settings.selectedServerIds : undefined,
    });
  });
  // Store cleanup for onDestroy
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/stores/presence.ts client/src/routes/+layout.svelte
git commit -m "feat: handle game activity in presence store and layout WS handler"
```

---

### Task 6: Display Activity in UserList and HomeSidebar

**Files:**
- Modify: `client/src/lib/components/UserList.svelte`
- Modify: `client/src/lib/components/HomeSidebar.svelte`

- [ ] **Step 1: Show activity in UserList**

After the username `<span>` in each user entry (around line 160), add:
```svelte
{#if user.activity}
  <span class="user-activity">Playing {user.activity}</span>
{/if}
```

Wrap the username + activity in a flex column container. Add CSS:
```css
.user-activity {
  font-size: 0.7rem;
  color: var(--text-dim);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}
```

Apply the same pattern to both the role-grouped user entries and bot entries.

- [ ] **Step 2: Show activity in HomeSidebar**

In the DM channel list and friends list, where the participant name is shown, add the activity below it. Look up the user's activity from the `$onlineUsers` map using the participant's user ID.

```svelte
{@const activity = $onlineUsers.get(participantId)?.activity}
{#if activity}
  <span class="dm-activity">Playing {activity}</span>
{/if}
```

Add matching CSS.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/components/UserList.svelte client/src/lib/components/HomeSidebar.svelte
git commit -m "feat: display game activity in user list and friends/DM list"
```

---

### Task 7: Add Game Activity Settings Tab

**Files:**
- Modify: `client/src/lib/components/SettingsModal.svelte`

- [ ] **Step 1: Add "Game Activity" tab to sidebar**

Add after the "Appearance" button in the sidebar:
```svelte
<button class="sidebar-item" class:active={activeTab === 'game-activity'} onclick={() => activeTab = 'game-activity'}>Game Activity</button>
```

- [ ] **Step 2: Add the settings section**

Add the tab content with:

**Enable Game Activity** — master toggle (calls `window.electronAPI.setGameEnabled`)

**Visibility** — radio buttons: "All Servers" / "Selected Servers"
- When "Selected Servers" is chosen, show checkboxes for each server the user is in (from `$servers` store)
- Calls `window.electronAPI.setGameVisibility` and `window.electronAPI.setGameServerIds`

**Custom Games** — list of user-added games with delete buttons
- "Add Game" form: text input for executable name + display name
- Calls `window.electronAPI.addCustomGame` / `removeCustomGame`

**Desktop-only notice** — if not on desktop (`!window.electronAPI`), show: "Game detection is only available in the desktop app."

Load initial settings on tab open:
```typescript
let gameEnabled = $state(true);
let gameVisibility = $state<'all' | 'selected'>('all');
let gameServerIds = $state<string[]>([]);
let customGames = $state<Record<string, string>>({});

async function loadGameSettings() {
  if (!window.electronAPI?.getGameSettings) return;
  const s = await window.electronAPI.getGameSettings();
  gameEnabled = s.enabled;
  gameVisibility = s.visibility;
  gameServerIds = s.selectedServerIds;
  customGames = s.customGames;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte
git commit -m "feat: add Game Activity settings tab with visibility and custom games"
```

---

### Task 8: Verify Build

- [ ] **Step 1: Run svelte-check**

```bash
npx svelte-check --workspace client
```

- [ ] **Step 2: Run tsc for server**

```bash
npx tsc --noEmit --project server/tsconfig.json
```

- [ ] **Step 3: Fix any errors and commit**

```bash
git add -A && git commit -m "fix: resolve type errors in game activity implementation"
```
