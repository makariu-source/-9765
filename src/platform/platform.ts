// Platform services. On Yandex Games (the build loads /sdk.js) this talks to the Yandex Games
// SDK: loading-ready signal, gameplay markup, ads between matches, pause events and cloud saves.
// Everywhere else (GitHub Pages, tests) it is a set of harmless no-ops.

export interface Platform {
  readonly id: 'local' | 'yandex';
  /** interface language reported by the platform ('ru' by default) */
  readonly lang: string;
  /** rewarded ads are available */
  readonly hasRewarded: boolean;
  /** the game is loaded and the player can interact (LoadingAPI.ready, called once) */
  ready(): void;
  /** gameplay markup: true while the player is actually playing a match */
  gameplay(on: boolean): void;
  /** full-screen ad at a natural break (between matches); resolves when it is over */
  interstitial(): Promise<void>;
  /** rewarded ad; resolves true only if the reward was earned */
  rewarded(): Promise<boolean>;
  /** cloud copy of the saved data, if any */
  loadCloud(): Promise<Record<string, string> | null>;
  /** store the saved data in the cloud (rate-limited internally) */
  saveCloud(data: Record<string, string>, now?: boolean): void;
  /** platform asks to pause / resume the game (its own overlays, purchase dialogs...) */
  onPause(cb: (paused: boolean) => void): void;
  /** called around every ad so the game can stop and mute */
  onAd(cb: (showing: boolean) => void): void;
}

class LocalPlatform implements Platform {
  readonly id = 'local' as const;
  readonly lang = 'ru';
  readonly hasRewarded = false;
  ready(): void {}
  gameplay(): void {}
  async interstitial(): Promise<void> {}
  async rewarded(): Promise<boolean> { return false; }
  async loadCloud(): Promise<Record<string, string> | null> { return null; }
  saveCloud(): void {}
  onPause(): void {}
  onAd(): void {}
}

/* Minimal typing of the parts of the Yandex Games SDK we use. */
interface YaAdCallbacks { onOpen?: () => void; onClose?: (wasShown?: boolean) => void; onError?: (e: unknown) => void; onOffline?: () => void; onRewarded?: () => void }
interface YaPlayer { getData(keys?: string[]): Promise<Record<string, unknown>>; setData(d: Record<string, unknown>, flush?: boolean): Promise<void> }
interface YaSDK {
  features?: { LoadingAPI?: { ready(): void }; GameplayAPI?: { start(): void; stop(): void } };
  adv: { showFullscreenAdv(o: { callbacks: YaAdCallbacks }): void; showRewardedVideo(o: { callbacks: YaAdCallbacks }): void };
  environment?: { i18n?: { lang?: string } };
  getPlayer(o?: { scopes?: boolean }): Promise<YaPlayer>;
  on?(event: string, cb: () => void): void;
}

const CLOUD_KEY = 'strikezone';
/** never let a stuck ad callback freeze the game */
const AD_SAFETY_MS = 90_000;

class YandexPlatform implements Platform {
  readonly id = 'yandex' as const;
  readonly hasRewarded = true;
  readonly lang: string;
  private readied = false;
  private playing = false;
  private player: Promise<YaPlayer | null> | null = null;
  private pauseCbs: ((p: boolean) => void)[] = [];
  private adCbs: ((s: boolean) => void)[] = [];
  private lastCloud = 0;
  private cloudTimer = 0;
  private pendingCloud: Record<string, string> | null = null;
  private adShowing = false;

  constructor(private sdk: YaSDK) {
    this.lang = sdk.environment?.i18n?.lang ?? 'ru';
    sdk.on?.('game_api_pause', () => this.pauseCbs.forEach(cb => cb(true)));
    sdk.on?.('game_api_resume', () => this.pauseCbs.forEach(cb => cb(false)));
  }

  private safe(f: () => void): void { try { f(); } catch (e) { console.warn('[yandex sdk]', e); } }

  ready(): void {
    if (this.readied) return;
    this.readied = true;
    this.safe(() => this.sdk.features?.LoadingAPI?.ready());
  }

  gameplay(on: boolean): void {
    if (on === this.playing) return;
    this.playing = on;
    this.safe(() => (on ? this.sdk.features?.GameplayAPI?.start() : this.sdk.features?.GameplayAPI?.stop()));
  }

  private ad(kind: 'fullscreen' | 'rewarded'): Promise<boolean> {
    if (this.adShowing) return Promise.resolve(false);
    return new Promise(resolve => {
      let rewarded = false, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.adShowing = false;
        this.adCbs.forEach(cb => cb(false));
        resolve(rewarded);
      };
      const callbacks: YaAdCallbacks = {
        onOpen: () => { this.adShowing = true; this.adCbs.forEach(cb => cb(true)); },
        onClose: () => finish(),
        onError: () => finish(),
        onOffline: () => finish(),
        onRewarded: () => { rewarded = true; },
      };
      setTimeout(finish, AD_SAFETY_MS);
      try {
        if (kind === 'fullscreen') this.sdk.adv.showFullscreenAdv({ callbacks });
        else this.sdk.adv.showRewardedVideo({ callbacks });
      } catch { finish(); }
    });
  }

  async interstitial(): Promise<void> { await this.ad('fullscreen'); }
  rewarded(): Promise<boolean> { return this.ad('rewarded'); }

  private getPlayer(): Promise<YaPlayer | null> {
    if (!this.player) this.player = this.sdk.getPlayer({ scopes: false }).catch(() => null);
    return this.player;
  }

  async loadCloud(): Promise<Record<string, string> | null> {
    const p = await this.getPlayer();
    if (!p) return null;
    try {
      const d = await p.getData([CLOUD_KEY]);
      const v = d?.[CLOUD_KEY];
      return v && typeof v === 'object' ? (v as Record<string, string>) : null;
    } catch { return null; }
  }

  saveCloud(data: Record<string, string>, now = false): void {
    // the SDK allows a limited number of writes: keep at most one every 10 s
    this.pendingCloud = data;
    const wait = now ? 0 : Math.max(0, this.lastCloud + 10_000 - Date.now());
    clearTimeout(this.cloudTimer);
    this.cloudTimer = window.setTimeout(() => void this.flushCloud(), wait);
  }

  private async flushCloud(): Promise<void> {
    const data = this.pendingCloud;
    if (!data) return;
    this.pendingCloud = null;
    this.lastCloud = Date.now();
    const p = await this.getPlayer();
    try { await p?.setData({ [CLOUD_KEY]: data }, true); } catch { /* offline or rate-limited: local copy stays */ }
  }

  onPause(cb: (paused: boolean) => void): void { this.pauseCbs.push(cb); }
  onAd(cb: (showing: boolean) => void): void { this.adCbs.push(cb); }
}

let current: Platform = new LocalPlatform();
export const platform = (): Platform => current;

/** Connect to the Yandex Games SDK if the page loaded it; otherwise stay local. Never throws. */
export async function initPlatform(timeoutMs = 4000): Promise<Platform> {
  const w = window as unknown as { YaGames?: { init(): Promise<YaSDK> } };
  if (!w.YaGames) return current;
  try {
    const sdk = await Promise.race([w.YaGames.init(), new Promise<null>(r => setTimeout(() => r(null), timeoutMs))]);
    if (sdk) current = new YandexPlatform(sdk);
  } catch (e) { console.warn('[yandex sdk] init failed, playing offline', e); }
  return current;
}
