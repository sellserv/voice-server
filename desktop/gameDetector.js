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

// Build a lookup that works on both Windows (.exe keys) and Linux (no extension)
function buildLookup(games) {
  const lookup = {};
  for (const [exe, name] of Object.entries(games)) {
    lookup[exe] = name;
    // Also add without .exe for Linux matching
    if (exe.endsWith('.exe')) {
      lookup[exe.slice(0, -4)] = name;
    }
  }
  return lookup;
}

async function detectGame(customGames) {
  const processes = await getRunningProcesses();
  const allGames = buildLookup({ ...builtinGames, ...customGames });

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
  }, 10000);
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
