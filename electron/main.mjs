import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, copyFileSync, mkdirSync } from 'fs'
import { spawn } from 'child_process'
import net from 'net'

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
    url = `http://127.0.0.1:${port}`
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Spend Tracker',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.loadURL(url)

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
