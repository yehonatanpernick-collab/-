// Weather: smooth transitions between states; drives clouds, fog, precipitation,
// ground wetness (render + grip) and wind. Rain turns to snow at altitude.
import { ATMO } from './render/atmosphere.js';

const STATES = {
  clear: { cover: 0.56, dark: 0.0, fog: 1.0, precip: 0, wind: 0.5 },
  cloudy: { cover: 0.88, dark: 0.35, fog: 1.6, precip: 0, wind: 0.9 },
  fog: { cover: 0.92, dark: 0.45, fog: 9.0, precip: 0, wind: 0.3 },
  rain: { cover: 1.0, dark: 0.8, fog: 3.2, precip: 1, wind: 1.4 },
  snow: { cover: 1.0, dark: 0.65, fog: 3.6, precip: 1, wind: 1.0, forceSnow: 1 },
};
const ORDER = ['clear', 'cloudy', 'fog', 'rain', 'snow'];

class Weather {
  constructor(game) {
    this.game = game;
    this.mode = game.params.get('weather') || 'clear';
    this.state = this.mode === 'auto' ? 'clear' : this.mode;
    this.cur = { ...STATES[this.state] };
    game.sky.weather.cover = this.cur.cover; game.sky._cloudInit = false;
    this.rain = 0; this.snow = 0; this.wetness = 0; this.snowCover = 0; this.windSpeed = 1;
    this.autoTimer = 240;
    if (game.params.has('weather')) this.cur = { ...STATES[this.state] };
  }

  set(mode) {
    this.mode = mode;
    if (mode !== 'auto') this.state = mode;
    this.game.hud?.toast(`Weather: ${mode}`);
  }
  cycle() { const i = (ORDER.indexOf(this.state) + 1) % ORDER.length; this.set(ORDER[i]); }

  update(dt, game) {
    if (this.mode === 'auto') {
      this.autoTimer -= dt;
      if (this.autoTimer < 0) {
        const r = Math.random();
        this.state = r < 0.4 ? 'clear' : r < 0.65 ? 'cloudy' : r < 0.78 ? 'fog' : 'rain';
        this.autoTimer = 180 + Math.random() * 300;
      }
    }
    const T = STATES[this.state], k = Math.min(1, dt * 0.15);
    for (const key of ['cover', 'dark', 'fog', 'precip', 'wind']) this.cur[key] += (T[key] - this.cur[key]) * k;
    const alt = game.camera.position.y;
    const snowy = T.forceSnow ? 1 : Math.min(1, Math.max(0, (alt - 2250) / 300));
    const p = this.cur.precip;
    this.rain = p * (1 - snowy);
    this.snow = p * snowy;
    // ground wets quickly in rain, dries slowly; snow cover builds in snowfall
    this.wetness += ((this.rain > 0.3 ? 1 : 0) - this.wetness) * dt * (this.rain > 0.3 ? 0.08 : 0.01);
    this.snowCover += ((this.snow > 0.3 ? 1 : 0) - this.snowCover) * dt * (this.snow > 0.3 ? 0.03 : 0.004);
    this.windSpeed = this.cur.wind;
    game.sky.weather.cover = this.cur.cover;
    game.sky.weather.dark = this.cur.dark;
    // fog: base density scaled; valley fog pools in the morning
    const morning = Math.max(0, 1 - Math.abs(game.sky.time - 7) / 2.5);
    ATMO.params.x = 0.00006 * this.cur.fog * (1 + morning * 2.5);
    ATMO.params.y = this.cur.fog > 3 ? 0.0016 : 0.0011;
    ATMO.params.z = 1450 + morning * 120;
    ATMO.params.w = 0.000016 * (1 + (this.cur.fog - 1) * 0.5);
    ATMO.misc.w = this.windSpeed;
    ATMO.misc.y = this.rain;
    game.weatherUniform.value.set(this.wetness, this.snowCover, 0, this.wetness);
    game.collision.wetness = this.wetness;
    game.collision.snowCover = this.snowCover;
    game.renderer.toneMappingExposure = 1.05 * (1 + this.cur.dark * 0.3);
  }
}

export function create(game) { return new Weather(game); }
