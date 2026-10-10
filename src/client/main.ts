import './ui/style.css';
import { App } from './app';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

function fatal(msg: string): void {
  ui.innerHTML = `<div class="menu"><div class="content"><h1>Не удалось запустить игру</h1><p class="sub">${msg}</p></div></div>`;
}

try {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) fatal('Браузер не поддерживает WebGL. Обновите браузер или включите аппаратное ускорение.');
  else {
    const app = new App(canvas, ui);
    (window as unknown as { __app: App }).__app = app;
    app.showMenu('home');
  }
} catch (e) {
  console.error(e);
  fatal(String((e as Error)?.message ?? e));
}
