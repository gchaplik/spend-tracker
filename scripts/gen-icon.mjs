import { createCanvas } from 'canvas'
import { writeFileSync, mkdirSync } from 'fs'

mkdirSync('electron', { recursive: true })

const c = createCanvas(512, 512)
const ctx = c.getContext('2d')

// Background: brand blue
ctx.fillStyle = '#0284C7'
ctx.roundRect(0, 0, 512, 512, 80)
ctx.fill()

// Dollar sign: white
ctx.fillStyle = '#ffffff'
ctx.font = 'bold 320px sans-serif'
ctx.textAlign = 'center'
ctx.textBaseline = 'middle'
ctx.fillText('$', 256, 276)

writeFileSync('electron/icon.png', c.toBuffer('image/png'))
console.log('✓ electron/icon.png written (512×512)')
