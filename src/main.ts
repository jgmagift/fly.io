import './style.css'
import { Game } from './game/game'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const hud = document.querySelector<HTMLElement>('#hud')!

new Game(canvas, hud).start()
