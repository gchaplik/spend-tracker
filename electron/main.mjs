import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, copyFileSync, mkdirSync } from 'fs'
import net from 'net'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isDev = !app.isPackaged

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

function waitForPort(port, retries = 40, delay = 150) {
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

app.whenReady().then(async () => {
  let url

  if (isDev) {
    // Dev: Vite dev server + separate Express already started by concurrently
    url = 'http://localhost:5173'
  } else {
    // Prod: set up persistent data directory, start embedded Express
    const userDataPath = app.getPath('userData')
    mkdirSync(userDataPath, { recursive: true })

    // Copy bundled seed DB to userData on first launch
    const dbPath = join(userDataPath, 'spend.db')
    if (!existsSync(dbPath)) {
      const src = join(process.resourcesPath, 'spend.db')
      if (existsSync(src)) copyFileSync(src, dbPath)
    }

    // Tell the server where the DB and seed file live
    process.env.SPEND_DB_PATH = dbPath
    process.env.SEED_DATA_PATH = join(process.resourcesPath, 'data.json')

    // Find a free port and start Express
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

  // Open external links (e.g. aistudio.google.com) in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Also catch target="_blank" navigation
  win.webContents.on('will-navigate', (e, navUrl) => {
    if (!navUrl.startsWith('http://127.0.0.1') && !navUrl.startsWith('http://localhost')) {
      e.preventDefault()
      shell.openExternal(navUrl)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
