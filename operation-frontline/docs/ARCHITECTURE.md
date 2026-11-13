# Architecture

## One simulation, two hosts

`shared/src/sim/GameSim.ts` is the whole game: movement, weapons, hit resolution, damage, respawns, conquest, bots, vehicles, projectiles, deployables, destructibles.

- **Server:** `server/src/ConquestRoom.ts` owns a `GameSim`, feeds it validated commands and broadcasts snapshots and events.
- **Training:** `client/src/net/session.ts → LocalSession` runs the same `GameSim` in the browser.

The client talks to a `Session` interface and cannot tell the two apart, so offline mode exercises the same prediction and reconciliation code as online play.

## Tick rates

| Loop | Rate |
| --- | --- |
| Simulation tick | 30 Hz, fixed |
| Player commands (movement + weapon step) | 60 Hz, fixed `1/60` |
| Network snapshots | 20 Hz |
| Rendering | display rate, interpolated |

Commands are batched into one message per tick. A full 16-player snapshot is under 300 bytes (binary codec in `shared/src/protocol.ts`), about 5 KB/s per client.

## Client prediction and reconciliation

Every command is applied locally at once with `stepMove` + `stepWeapon` (shared code) and kept until acknowledged. Each snapshot carries the owner's authoritative state and the last processed command number; the client resets to it, replays the unacknowledged commands and smooths the remaining error over a few frames. Remote players are rendered about 115 ms in the past, interpolated between snapshots.

## Lag-compensated hits

Bullets are hitscan. Each command says which server tick the client was looking at; the server rewinds other players to that tick (capped at 400 ms) before testing the ray. Spread is a deterministic hash of player id and shot number, so client tracers match server results. Recoil is applied by the server on top of the view angles, so it cannot be removed client-side.

## Server validation

- Commands are type- and range-checked; malformed ones are dropped.
- Each player may execute two commands per tick with a small burst allowance, so sending more input does not move faster.
- Fire rate, ammunition, reload and switch timers live in the server's weapon state machine.
- Loadouts are sanitised against class and level.
- Spawn requests fall back to base if the objective is not owned.
- Spawn, loadout and team messages are rate limited.
- Clients never send damage, kills, score or positions.

## Collision and physics

The brief asked for PlayCanvas-supported physics. PlayCanvas' physics is Ammo.js, which cannot give bit-identical results between a browser and a Node server, and identical results are what prediction and server authority depend on. So collision is a small deterministic system in `shared/`: axis-aligned boxes plus ramps in a uniform grid, a character controller with step-up, slopes, sliding and crouch head-room checks, and ray casts for bullets and line of sight. Projectiles and the vehicle use the same world. Debris and casings are visual-only particles.

## Level

`shared/src/world/maps/kestrel.ts` authors the map in code using `MapBuilder` (walls with openings, multi-storey buildings with stairs, slabs, props). The same data drives collision, navigation (1 m layered grid + A*), rendering (merged meshes per material and chunk) and the minimap.

## Rendering notes

- First-person weapon renders on its own layer and camera so it never clips into walls.
- The IBL environment has the sun disc clamped in the asset pipeline; direct sun comes from the shadow-casting light. Without this, surfaces facing away from the sun were black.
- Particles, tracers and decals are CPU-built quad batches (three draw calls).
- Glass panes are hardware instanced.
- Quality presets scale shadows, SSAO, bloom, MSAA, particles, lights and prop distance; adaptive resolution lowers the internal render scale when frame time rises.

## Decisions worth knowing

- TypeScript is pinned to 5.9 (stable) rather than 7.0.
- UI is HTML/CSS over the canvas, not the engine's UI system.
- Colyseus schema state is not used; snapshots are explicit messages so the same codec can be tested without a server.
- The server measures its own clock for the fixed step; the delta Colyseus passes to the callback was not accurate enough.
