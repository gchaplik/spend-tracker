import { createCanvas } from 'canvas'
import { writeFileSync, mkdirSync } from 'fs'

mkdirSync('electron', { recursive: true })

const SIZE = 512
const c = createCanvas(SIZE, SIZE)
const ctx = c.getContext('2d')

// ── Background: deep navy ────────────────────────────────────────────────────
ctx.fillStyle = '#0F172A'
ctx.roundRect(0, 0, SIZE, SIZE, 88)
ctx.fill()

// ── Mountain silhouette (three peaks) ────────────────────────────────────────
// Colours
const SNOW  = '#FFFFFF'
const MID   = '#38BDF8'   // sky-blue accent — middle/front peak
const BACK  = '#1E3A5F'   // dark navy — back peak fill (recessed)

const cx = SIZE / 2       // 256
const BASE_Y = 390        // baseline of mountains

// Back-left peak (tallest, recessed dark)
ctx.beginPath()
ctx.moveTo(60,  BASE_Y)
ctx.lineTo(210, 148)
ctx.lineTo(330, BASE_Y)
ctx.closePath()
ctx.fillStyle = BACK
ctx.fill()

// Back-right peak (medium, recessed dark)
ctx.beginPath()
ctx.moveTo(220, BASE_Y)
ctx.lineTo(365, 188)
ctx.lineTo(460, BASE_Y)
ctx.closePath()
ctx.fillStyle = BACK
ctx.fill()

// Front-centre peak (accent blue, shorter but prominent)
ctx.beginPath()
ctx.moveTo(110, BASE_Y)
ctx.lineTo(cx,  188)
ctx.lineTo(402, BASE_Y)
ctx.closePath()
ctx.fillStyle = MID
ctx.fill()

// Snow cap on front peak — small white triangle near the tip
ctx.beginPath()
ctx.moveTo(cx,  188)
ctx.lineTo(cx - 38, 248)
ctx.lineTo(cx + 38, 248)
ctx.closePath()
ctx.fillStyle = SNOW
ctx.fill()

// ── Baseline ground bar ───────────────────────────────────────────────────────
ctx.fillStyle = MID
ctx.fillRect(60, BASE_Y, SIZE - 120, 14)

// ── "CH" wordmark below mountains ────────────────────────────────────────────
ctx.fillStyle = '#94A3B8'   // slate-400
ctx.font = 'bold 52px sans-serif'
ctx.textAlign = 'center'
ctx.textBaseline = 'top'
ctx.fillText('CASHHEAP', cx, 418)

writeFileSync('electron/icon.png', c.toBuffer('image/png'))
console.log('✓ electron/icon.png written (512×512) — CashHeap mountain logo')
