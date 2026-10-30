---
name: console-skill
description: >-
  The Console skill pack: port PlayStation 2 games you own to PC with PS2Recomp, then mod, rebind, tune and play them anywhere. Use for any PS2 disc, ISO, ELF, recompiler, game port, texture or audio extraction, controller mapping, save conversion, PCSX2 testing, or modding a PS2 game. Route to the right sub-skill below.
---

# The Console skill (router)

This skill bundles 11 sub-skills. Each lives in its own folder next to this file. Pick the one that matches the request, then **read that folder's `SKILL.md` before acting** and follow it. Its scripts and reference files are in the same folder; paths are relative to this skill folder (`console-<name>/file.py`).

Start with `console-reverse` for a new game, since it opens the disc image and maps the code that the other skills depend on.

| Sub-skill (folder) | Use it for |
| --- | --- |
| `console-reverse/` | Reverse engineer: open the user's own disc image, find the boot ELF, map functions, write the design doc. Start here for a new game. |
| `console-backend/` | Backend engineer: syscalls, kernel stubs, file and disc I/O, IOP, the runtime the recompiled game runs on. |
| `console-graphics/` | Graphics artist: dump textures, repaint or replace them, TIM2 format, widescreen fix, GS packets. |
| `console-sound/` | Sound designer: extract music and SFX, decode VAG, replace tracks with your own. |
| `console-controller/` | Controller mapper: DualSense, Xbox, Switch Pro, keyboard or touch, padmap and controls.json. |
| `console-mod/` | Mod maker: turn a plain-English change into a patch (override code, PNACH cheats, CMake templates). Never touches original files. |
| `console-levels/` | Level designer: map the data files, unpack archives, swap level data. |
| `console-physics/` | Physics tuner: find the numbers that set speed, handling and gravity, then tune them. |
| `console-saves/` | Save manager: convert memory card saves, back up, sync to cloud. |
| `console-anywhere/` | Play anywhere: package the port for Windows, Mac, Linux, Steam Deck, Android, PS Vita. |
| `console-tester/` | Playtester: run the port repeatedly, read crashes and logs, rank what to fix next, compare against PCSX2. |

## Ground rules (apply to every sub-skill)

- Work only with a game the user owns, dumped from their own disc on their own computer. Never put game files, ISOs, BIOS or extracted assets into a repo or a shared mod.
- The Python tools use only the standard library. Requires Python 3.8 or newer.
- PS2Recomp, Ghidra and PCSX2 are external and optional or required per sub-skill; check each sub-skill for what it needs.
