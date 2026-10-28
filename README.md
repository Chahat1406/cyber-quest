# Cyber Quest — Digital Survival

A browser-based, voxel-style 3D cybersecurity adventure built with Three.js, TypeScript, and Vite.

## Story

John's friend Alex has been pulled into CYBERGATE, a mysterious computer world. John must travel through five digital locations, complete cybersecurity challenges, and rescue Alex before the Warden erases his identity.

## Chapters and locations

1. **The Suspicious Signal** — Digital College Campus. Four missions: phishing awareness, unknown USB safety, account protection, and secure network routing. Workstation questions have a 30-second timer.
2. **The Hidden Intruder** — Abandoned Data City. Timed incident-investigation questions.
3. **Network Under Attack** — Firewall Fortress. Timed network defense and containment questions.
4. **The Data Heist** — The Lost Data Vault. Timed evidence-handling and recovery questions.
5. **Digital Guardian** — Core of CYBERGATE. A 120-second final challenge to rescue Alex.

Each chapter has a different environment palette, architecture, and map layout. The chapter navigation bar shows the current chapter and completed chapters. Chapters unlock in sequence.

## Controls

- **W/A/S/D** or arrow keys: move
- **Shift**: run
- **E**: interact with a nearby character or console
- **Mouse**: look around
- **Esc**: close a dialogue or pause
- Use the chapter navigation bar to visit unlocked locations.

## Run locally

Requires Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

To create a production build:

```bash
npm run build
npm run preview
```

## Save data

Progress, XP, integrity, completed missions, and unlocked chapters are stored in the browser's local storage. Use **Restart chapter** to reset the local save.

## Safety note

Cybersecurity exercises are fictional and offline. The game does not connect to real networks, access real accounts, or perform real attack actions.
