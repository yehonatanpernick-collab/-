// Headless check of the real Vehicle class: drive, take off, climb, cruise, bank-turn, boost, land.
import { Physics } from '../../src/engine/physics';
import { Vehicle } from '../../src/vehicle/vehicle';
const ph = new Physics(); await ph.init();
const car = new Vehicle(ph); car.spawn(0, 0.9, 0, 0);
const run = (secs: number, inp: Partial<Vehicle['input']>, label: string) => {
  car.input = { steer: 0, throttle: 0, up: 0, down: 0, boost: false, handbrake: false, ...inp };
  for (let i = 0; i < secs * 120; i++) { car.step(1 / 120); ph.world.step(); car.afterStep(); }
  const e = car.up; console.log(label.padEnd(18), 'pos', car.pos.toArray().map((v) => v.toFixed(1)).join(','), 'kmh', (car.vel.length() * 3.6).toFixed(0), 'vy', car.vel.y.toFixed(1), 'upY', e.y.toFixed(3), 'yaw', (car.yaw * 57.3).toFixed(0), 'fold', car.fold.toFixed(2));
};
run(2, {}, 'settle');
run(5, { throttle: 1 }, 'drive 5s');
run(3, { throttle: -1 }, 'brake 3s');
car.setMode('fly');
run(3, { up: 1 }, 'take off + climb');
run(4, {}, 'hover hold');
run(8, { throttle: 1 }, 'cruise 8s');
run(4, { throttle: 1, steer: 1 }, 'bank turn 4s');
run(5, { throttle: 1, boost: true }, 'boost 5s');
run(6, { down: 1 }, 'descend 6s');
car.setMode('drive');
run(4, {}, 'land');
