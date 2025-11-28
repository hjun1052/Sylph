# Sylph
An Electron-based AI browser built with React and TypeScript. This repo uses Electron Forge for local development and packaging, and Electron Builder for distribution.

## Prerequisites
- Node.js 18+ recommended (align with the version used to generate `package-lock.json`)
- npm (ships with Node)

## Getting Started
```bash
npm install
npm start        # run the app in development via Electron Forge
```

## Scripts
- `npm start` – launch the app in dev mode
- `npm run lint` – lint TypeScript/JavaScript sources
- `npm run package` – create an unpacked app build (Forge)
- `npm run make` – create platform installers (Forge)
- `npm run publish` – publish installers using Forge config
- `npm run build` – build distributables via Electron Builder

## Environment
Create a `.env` (or `.env.local`) for secrets like API keys. Example:
```
OPENAI_API_KEY=your_key
```

## Build Outputs
- Forge artifacts: `out/`
- Electron Builder artifacts: `dist/`

## Notes
- If packaging on macOS/Windows/Linux, run the commands on the target OS for native binaries.
- Clean artifacts with `rm -rf out dist`.
