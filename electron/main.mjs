import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import net from 'net'
import pkg from 'electron-updater'
const { autoUpdater } = pkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = !app.isPackaged

// ── Port helpers ──────────────────────────────────────────────────────────────

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function waitForPort(port, retries = 60, delay = 150) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.destroy()
        resolve()
      })
      sock.on('error', () => {
        if (--retries === 0) return reject(new Error(`Server did not start on port ${port}`))
        setTimeout(attempt, delay)
      })
    }
    attempt()
  })
}

// ── Server lifecycle ──────────────────────────────────────────────────────────
// In dev:  spawn `node server/index.js` as a child process — restarts on crash.
// In prod: import server/index.js directly into the Electron process.

let serverProc = null
let isQuitting = false

function spawnServer(port, env = {}) {
  const fullEnv = { ...process.env, SERVER_PORT: String(port), ...env }
  const cwd = join(__dirname, '..')

  function doSpawn() {
    console.log(`[main] Starting server on port ${port}…`)
    serverProc = spawn(process.execPath, ['server/index.js'], { cwd, env: fullEnv, stdio: 'inherit' })

    serverProc.on('exit', (code, signal) => {
      if (isQuitting) return
      if (signal === 'SIGTERM' || signal === 'SIGKILL') return
      console.log(`[main] Server exited (code=${code}), restarting in 1 s…`)
      setTimeout(doSpawn, 1000)
    })
  }

  doSpawn()
}

function stopServer() {
  isQuitting = true
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM')
    serverProc = null
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  let url

  if (isDev) {
    // Save project root so the packaged app can find it for local updates
    const userDataPath = app.getPath('userData')
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, '.project-root'), join(__dirname, '..'))

    // Dev mode: spawn the Express server as a managed child process
    const port = 3001
    spawnServer(port)
    await waitForPort(port)
    url = 'http://localhost:5173'   // Vite HMR dev server
  } else {
    // Prod mode: set up user-data directory, then import the server directly
    const userDataPath = app.getPath('userData')
    mkdirSync(userDataPath, { recursive: true })

    const dbPath = join(userDataPath, 'spend.db')
    if (!existsSync(dbPath)) {
      const src = join(process.resourcesPath, 'spend.db')
      if (existsSync(src)) copyFileSync(src, dbPath)
    }

    process.env.SPEND_DB_PATH = dbPath
    process.env.SEED_DATA_PATH = join(process.resourcesPath, 'data.json')

    const port = await getFreePort()
    process.env.SERVER_PORT = String(port)
    await import('../server/index.js')
    await waitForPort(port)
    url = `http://localhost:${port}`
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'CashHeap',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.loadURL(url)

  // ── Auto-updater (prod only) ──────────────────────────────────────────────
  if (!isDev) {
    autoUpdater.checkForUpdates()
  }

  autoUpdater.on('update-available',     (info) => win.webContents.send('update-available', info))
  autoUpdater.on('update-not-available', (info) => win.webContents.send('update-not-available', info))
  autoUpdater.on('update-downloaded',    (info) => win.webContents.send('update-downloaded', info))
  autoUpdater.on('error',                (err)  => win.webContents.send('update-error', err?.message || String(err)))

  ipcMain.on('quit-app', () => { app.quit() })

  ipcMain.on('check-for-updates', () => { try { autoUpdater.checkForUpdates() } catch(e) { win.webContents.send('update-error', e.message) } })
  ipcMain.on('restart-and-install', () => { autoUpdater.quitAndInstall() })

  // ── Local update (build + reinstall from DMG) ─────────────────────────────
  ipcMain.on('local-update', () => {
    let projectRoot = isDev ? join(__dirname, '..') : null
    if (!projectRoot) {
      // Packaged app — read saved project root written during last dev launch
      try {
        const saved = join(app.getPath('userData'), '.project-root')
        if (existsSync(saved)) projectRoot = readFileSync(saved, 'utf8').trim()
      } catch {}
    }
    if (!projectRoot || !existsSync(join(projectRoot, 'package.json'))) {
      win.webContents.send('local-update-done', false, 'Project root not found. Open the app once from source (npm run electron:dev) to register the path.')
      return
    }

    win.webContents.send('local-update-progress', 'Building...')

    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const dmgName = arch === 'arm64'
      ? 'CashHeap-1.0.0-arm64.dmg'
      : 'CashHeap-1.0.0.dmg'
    const dmgPath = join(projectRoot, 'release', dmgName)

    // Resolve npm — load user's shell profile so PATH includes nvm/homebrew/volta etc.
    const buildScript = `
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
      cd "${projectRoot}" && npm run electron:build
    `

    // Step 1: build via bash so npm is always found
    const build = spawn('bash', ['-c', buildScript], {
      cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe']
    })
    build.stdout.on('data', d => {
      const line = d.toString().trim()
      if (line) win.webContents.send('local-update-progress', line)
    })
    build.stderr.on('data', d => {
      const line = d.toString().trim()
      if (line) win.webContents.send('local-update-progress', line)
    })
    build.on('exit', (code) => {
      if (code !== 0) {
        win.webContents.send('local-update-done', false, 'Build failed — check the log above.')
        return
      }
      win.webContents.send('local-update-progress', 'Installing...')

      // Step 2: mount DMG, copy .app, unmount, relaunch — as detached script so it survives app quit
      const installScript = `
        hdiutil info | grep -o '/Volumes/CashHeap[^\\t]*' | while read v; do hdiutil detach "$v" 2>/dev/null || true; done
        MOUNT=$(hdiutil attach "${dmgPath}" -nobrowse | grep '/Volumes/' | awk -F'\\t' '{print $NF}')
        rm -rf "/Applications/CashHeap.app"
        cp -R "$MOUNT/CashHeap.app" /Applications/
        xattr -cr "/Applications/CashHeap.app"
        hdiutil detach "$MOUNT" -quiet
        sleep 1
        open "/Applications/CashHeap.app"
      `
      const installer = spawn('bash', ['-c', installScript], {
        detached: true, stdio: 'ignore'
      })
      installer.unref()

      // Quit so the installer can replace the .app
      setTimeout(() => app.quit(), 500)
    })
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (e, navUrl) => {
    if (!navUrl.startsWith('http://127.0.0.1') && !navUrl.startsWith('http://localhost')) {
      e.preventDefault()
      shell.openExternal(navUrl)
    }
  })
})

// Kill the server when the app is about to quit
app.on('before-quit', () => {
  stopServer()
})

app.on('window-all-closed', () => {
  stopServer()
  app.quit()
})
