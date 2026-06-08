import { createCanvas } from 'canvas'
import { writeFileSync, mkdirSync } from 'fs'

mkdirSync('electron', { recursive: true })

const SIZE = 512
const c = createCanvas(SIZE, SIZE)
const ctx = c.getContext('2d')

// ── Background: pure black ───────────────────────────────────────────────────
ctx.fillStyle = '#000000'
ctx.roundRect(0, 0, SIZE, SIZE, 88)
ctx.fill()

// ── Mountain silhouette: white on black ──────────────────────────────────────
const cx = SIZE / 2   // 256
const BASE_Y = 370

// Single bold mountain — clean minimalist triangle
ctx.beginPath()
ctx.moveTo(56,  BASE_Y)
ctx.lineTo(cx,  110)
ctx.lineTo(456, BASE_Y)
ctx.closePath()
ctx.fillStyle = '#FFFFFF'
ctx.fill()

// Ground baseline
ctx.fillStyle = '#FFFFFF'
ctx.fillRect(56, BASE_Y, 400, 18)

writeFileSync('electron/icon.png', c.toBuffer('image/png'))
console.log('✓ electron/icon.png written (512×512) — white mountain on black')
