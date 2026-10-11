// font bundled with the game (OFL-1.1): no requests to third-party domains
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import './ui/style.css';
import { App, SAVED_AT_KEY } from './app';
import { initPlatform, platform } from '../platform/platform';
import { STORAGE_KEY } from '../meta/profile';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

function fatal(msg: string): void {
  ui.innerHTML = `<div class="menu"><div class="content"><h1>Не удалось запустить игру</h1><p class="sub">${msg}</p></div></div>`;
}

/** Take the cloud save (Yandex Games) if it is newer than the one in this browser. */
async function syncCloud(): Promise<void> {
  const cloud = await platform().loadCloud();
  if (!cloud?.profile) return;
  try {
    const local = Number(localStorage.getItem(SAVED_AT_KEY) ?? 0);
    if (Number(cloud.savedAt ?? 0) > local) {
      localStorage.setItem(STORAGE_KEY, cloud.profile);
      localStorage.setItem(SAVED_AT_KEY, cloud.savedAt);
    }
  } catch { /* storage blocked: play with defaults */ }
}

async function boot(): Promise<void> {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) { fatal('Браузер не поддерживает WebGL. Обновите браузер или включите аппаратное ускорение.'); return; }
  await initPlatform();
  await syncCloud();
  const app = new App(canvas, ui);
  (window as unknown as { __app: App }).__app = app;
  app.showMenu('home');
  // the menu is on screen and interactive: tell the platform loading is over
  requestAnimationFrame(() => platform().ready());
}

boot().catch(e => {
  console.error(e);
  fatal(String((e as Error)?.message ?? e));
});
