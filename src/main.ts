import { Game } from './core/Game';

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  (window as unknown as { __err: string }).__err = String(e);
  game.menu?.error(`Failed to start: ${String(e).slice(0, 300)}`);
});
