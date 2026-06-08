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
const BASE_Y = 400

// Main peak — jagged silhouette, not a perfect triangle
ctx.beginPath()
ctx.moveTo(40,  BASE_Y)       // bottom-left
ctx.lineTo(100, 310)          // left lower shoulder
ctx.lineTo(140, 330)          // small dip/ridge on left
ctx.lineTo(175, 255)          // secondary left peak
ctx.lineTo(200, 275)          // saddle
ctx.lineTo(256, 108)          // MAIN SUMMIT
ctx.lineTo(310, 275)          // saddle right
ctx.lineTo(340, 248)          // secondary right peak
ctx.lineTo(370, 268)          // ridge dip
ctx.lineTo(415, 305)          // right shoulder
ctx.lineTo(472, BASE_Y)       // bottom-right
ctx.closePath()
ctx.fillStyle = '#FFFFFF'
ctx.fill()


// Ground baseline
ctx.fillStyle = '#FFFFFF'
ctx.fillRect(40, BASE_Y, 432, 20)

writeFileSync('electron/icon.png', c.toBuffer('image/png'))
console.log('✓ electron/icon.png written (512×512) — white mountain on black')
