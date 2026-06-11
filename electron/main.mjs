import { app, BrowserWindow, shell, ipcMain, systemPreferences } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, copyFileSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync, unlinkSync } from 'fs'
import { createServer } from 'http'
import { spawn } from 'child_process'
import net from 'net'
import pkg from 'electron-updater'
const { autoUpdater } = pkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = !app.isPackaged

// Enforce single instance — second launch focuses the existing window
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function waitForPort(port, retries = 80, delay = 200) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, '127.0.0.1', () => { sock.destroy(); resolve() })
      sock.on('error', () => {
        if (--retries === 0) return reject(new Error(`Server did not start on port ${port}`))
        setTimeout(attempt, delay)
      })
    }
    attempt()
  })
}

// ── Server ────────────────────────────────────────────────────────────────────

let httpServer = null
let mainWin = null

function stopServer() {
  if (httpServer) { httpServer.close(); httpServer = null }
}

// In prod, run Next.js programmatically inside the main process.
// This avoids spawning a child process, which can't read from the asar archive.
async function startProdServer() {
  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })

  const dbPath = join(userDataPath, 'spend.db')
  if (!existsSync(dbPath)) {
    const src = join(process.resourcesPath, 'spend.db')
    if (existsSync(src)) copyFileSync(src, dbPath)
  }

  process.env.SPEND_DB_PATH = dbPath
  process.env.SEED_DATA_PATH = join(process.resourcesPath, 'data.json')

  // Rotate backups: keep the 7 most recent copies of spend.db
  if (existsSync(dbPath)) {
    const backupDir = join(userDataPath, 'backups')
    mkdirSync(backupDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    copyFileSync(dbPath, join(backupDir, `spend-${ts}.db`))
    const all = readdirSync(backupDir)
      .filter(f => f.startsWith('spend-') && f.endsWith('.db'))
      .sort()
    for (const old of all.slice(0, Math.max(0, all.length - 7)))
      unlinkSync(join(backupDir, old))
  }

  // .next/ is shipped as extraResource to process.resourcesPath/.next
  // next() with dir=resourcesPath finds it at the default relative path
  const { default: next } = await import('next')
  const nextApp = next({
    dev: false,
    dir: process.resourcesPath,
  })

  const errorLog = join(userDataPath, 'error.log')

  // Capture server-side errors (Next.js logs real exceptions to stderr, not the response body)
  const origStderrWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk, ...args) => {
    try { appendFileSync(errorLog, `[stderr] ${chunk}`) } catch {}
    return origStderrWrite(chunk, ...args)
  }
  process.on('uncaughtException', err => {
    try { appendFileSync(errorLog, `[uncaught] ${err.stack || err.message}\n`) } catch {}
  })

  await nextApp.prepare()
  const handle = nextApp.getRequestHandler()

  const port = await getFreePort()
  await new Promise((resolve, reject) => {
    httpServer = createServer((req, res) => {  // errorLog defined above
      const chunks = []
      const origEnd = res.end.bind(res)
      res.end = (chunk, ...args) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        if (res.statusCode >= 500) {
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 4000)
          writeFileSync(errorLog, `${req.method} ${req.url} → ${res.statusCode}\n\n${body}`)
        }
        return origEnd(chunk, ...args)
      }
      handle(req, res)
    })
    httpServer.listen(port, '127.0.0.1', resolve)
    httpServer.on('error', reject)
  })

  return `http://127.0.0.1:${port}`
}

// Start the server immediately so it warms up before whenReady fires
let serverStartError = null
const serverUrlPromise = isDev ? null : startProdServer().catch(err => {
  console.error('[main] Failed to start server:', err)
  serverStartError = err
  return null
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })

  const win = mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'CashHeap',
    show: false,
    backgroundColor: '#fafaf9',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  let shown = false
  const showWin = () => { if (!shown) { shown = true; win.show() } }
  win.once('ready-to-show', showWin)
  setTimeout(showWin, 15_000)

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[renderer] did-fail-load: ${code} ${desc}`)
    showWin()
  })

  let url
  if (isDev) {
    writeFileSync(join(userDataPath, '.project-root'), join(__dirname, '..'))
    await waitForPort(3000)
    url = 'http://localhost:3000'
  } else {
    const serverUrl = await serverUrlPromise
    if (serverUrl) {
      url = serverUrl
    } else {
      const msg = serverStartError ? encodeURIComponent(serverStartError.stack || serverStartError.message) : 'Unknown+error'
      url = `data:text/html,<html><body style="font-family:system-ui;padding:40px;color:%23dc2626;background:%23fafaf9"><h2>CashHeap failed to start</h2><pre style="font-size:12px;white-space:pre-wrap;color:%23333">${msg}</pre></body></html>`
    }
  }

  win.loadURL(url)
  win.webContents.openDevTools({ mode: 'detach' })
})

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
  }
})

app.on('before-quit', stopServer)
app.on('window-all-closed', () => { stopServer(); app.quit() })

// ── IPC ───────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const w = () => mainWin

  autoUpdater.on('update-available',     i => w()?.webContents.send('update-available', i))
  autoUpdater.on('update-not-available', i => w()?.webContents.send('update-not-available', i))
  autoUpdater.on('update-downloaded',    i => w()?.webContents.send('update-downloaded', i))
  autoUpdater.on('error',                e => w()?.webContents.send('update-error', e?.message || String(e)))

  if (!isDev) { try { autoUpdater.checkForUpdates() } catch {} }

  ipcMain.on('quit-app', () => app.quit())
  ipcMain.on('check-for-updates', () => { try { autoUpdater.checkForUpdates() } catch (e) { w()?.webContents.send('update-error', e.message) } })
  ipcMain.on('restart-and-install', () => autoUpdater.quitAndInstall())

  ipcMain.handle('biometrics-available', () => {
    if (process.platform !== 'darwin') return false
    try { return systemPreferences.canPromptTouchID() } catch { return false }
  })
  ipcMain.handle('biometrics-prompt', async (_e, reason) => {
    if (process.platform !== 'darwin') throw new Error('Not macOS')
    if (!systemPreferences.canPromptTouchID()) throw new Error('Touch ID not available')
    await systemPreferences.promptTouchID(reason || 'unlock CashHeap')
    return true
  })

  ipcMain.on('local-update', () => {
    let projectRoot = isDev ? join(__dirname, '..') : null
    if (!projectRoot) {
      try {
        const saved = join(app.getPath('userData'), '.project-root')
        if (existsSync(saved)) projectRoot = readFileSync(saved, 'utf8').trim()
      } catch {}
    }
    if (!projectRoot || !existsSync(join(projectRoot, 'package.json'))) {
      w()?.webContents.send('local-update-done', false, 'Project root not found.')
      return
    }
    w()?.webContents.send('local-update-progress', 'Building...')
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const dmgName = arch === 'arm64' ? 'CashHeap-1.0.0-arm64.dmg' : 'CashHeap-1.0.0.dmg'
    const dmgPath = join(projectRoot, 'release', dmgName)
    const buildScript = `
      export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
      cd "${projectRoot}" && npm run electron:build
    `
    const build = spawn('bash', ['-c', buildScript], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    build.stdout.on('data', d => { const l = d.toString().trim(); if (l) w()?.webContents.send('local-update-progress', l) })
    build.stderr.on('data', d => { const l = d.toString().trim(); if (l) w()?.webContents.send('local-update-progress', l) })
    build.on('exit', code => {
      if (code !== 0) { w()?.webContents.send('local-update-done', false, 'Build failed.'); return }
      w()?.webContents.send('local-update-progress', 'Installing...')
      const installScript = `
        hdiutil info | grep -o '/Volumes/CashHeap[^\\t]*' | while read v; do hdiutil detach "$v" 2>/dev/null || true; done
        MOUNT=$(hdiutil attach "${dmgPath}" -nobrowse | grep '/Volumes/' | awk -F'\\t' '{print $NF}')
        rm -rf "/Applications/CashHeap.app"
        cp -R "$MOUNT/CashHeap.app" /Applications/
        xattr -cr "/Applications/CashHeap.app"
        hdiutil detach "$MOUNT" -quiet
        sleep 1; open "/Applications/CashHeap.app"
      `
      const installer = spawn('bash', ['-c', installScript], { detached: true, stdio: 'ignore' })
      installer.unref()
      setTimeout(() => app.quit(), 500)
    })
  })

  mainWin?.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  mainWin?.webContents.on('will-navigate', (e, navUrl) => {
    if (!navUrl.startsWith('http://127.0.0.1') && !navUrl.startsWith('http://localhost')) {
      e.preventDefault(); shell.openExternal(navUrl)
    }
  })
})
