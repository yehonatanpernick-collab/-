# Project checklist

**Verified by:** T = automated test (`npm test`), E = browser end-to-end test on the production build, S = seen in a headless-browser screenshot, C = code exists but only type-checked.
Nothing here was run on a physical GPU or phone.

| Area | Item | State | Verified |
| --- | --- | --- | --- |
| Foundation | Workspaces, TypeScript strict, Vite, PlayCanvas, Colyseus | done | T, E |
| | Asset pipeline + manifest | done | run |
| | WebGPU with WebGL 2 fallback | fallback works; WebGPU untested | E (fallback) |
| Movement | Walk, sprint, tactical sprint, jump, crouch, slide, air control, steps, stairs, wall collision | done | T |
| | Deterministic, shared client/server | done | T |
| Camera | Mouse + touch look, FOV setting, recoil, bob, landing, sprint FOV | done | S |
| Weapons | 7 weapons, independent stats, fire rate, magazines, reload | done | T |
| | Recoil patterns, spread, range falloff, head/leg multipliers | done | T |
| | Attachments (5 slots) affecting stats and models | done | T (stats), S |
| | Server-validated hits, lag compensation | done | T |
| | Muzzle flash, tracers, impacts, casings, per-weapon sound | done | S (audio: C) |
| Classes | 4 classes, gadgets (stim, smoke, RPG, repair, ammo, medic, sensor), grenades | done | T (bots use them) |
| Conquest | 3 objectives, capture, contest, tickets, bleed, timer, win/lose, restart | done | T |
| Map | Streets, interiors, stairs, roofs, underpass, parkade, checkpoints, spawns | done | T (all reachable), S |
| Bots | Navigation, perception, targeting, cover, shooting, reloading, objectives, roles, difficulty | done | T |
| | Bots driving vehicles | not done | — |
| Training | Offline, configurable | done | E |
| Multiplayer | Matchmaking, room browser, private rooms, 16 players, team balance | done | T, E |
| | Prediction, reconciliation, interpolation, 20 Hz snapshots | done | T (rate), E |
| | Reconnection | implemented | C |
| | Input validation, rate limits | done | T |
| Destruction | Glass, barrels, crates, decals | done | T (events) |
| | Interactive doors | not done | — |
| Vehicle | Enter/exit, drive, collide, health, passenger, sync, repair | done | C (sim runs in tests; driving not screenshot-tested) |
| Audio | Spatial, attenuation, occlusion, interior reverb, ambience, music | done | C (headless test has no audio output) |
| UI | Menu (8 sections), lobby, HUD, minimap, scoreboard, deploy, end screen, settings, key binding | done | S, E |
| Mobile | Touch stick, look, buttons, responsive layout, options | done | E (emulated touch) |
| Performance | Quality presets, adaptive resolution, distance culling, instancing | done | C |
| | 60 fps desktop / 30–60 fps mobile | unmeasured | — |
| | Simulation budget | 0.2 ms per tick | T |
| Animation | Third person idle/walk/run + procedural aim, crouch, death | partial | S |
| Physics | PlayCanvas Ammo | replaced by shared deterministic collision | see docs |
| Build | Production build, single-process hosting | done | E |
