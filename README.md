# CalTheme

CalTheme: GHL calendar themes, booking embeds, OAuth and Paddle billing, served by Express with Supabase storage.

## Working in this repository

Read [AGENTS.md](AGENTS.md) for the code map, verification commands and ownership boundaries. Codex starts there; Claude follows [CLAUDE.md](CLAUDE.md).

## Setup and checks

Use Node >=18 and the npm lockfile. Install with `npm ci`. Configure development-only values using the variable names in [.env.example](.env.example); do not copy committed environment values into another environment. The server requires Supabase configuration and checks connectivity during startup. Use Paddle sandbox and test GHL accounts for development.

`npm run dev` runs nodemon; `npm start` runs the Express server. There is no configured build, lint or test script. `node --check src/index.js` checks only entry-point syntax.

## Before changing data or releases

src/ and public/ are the working app. The mnt/ tree contains another copy; verify provenance before using it. Keep the Paddle raw-body webhook ahead of express.json(), and public pixel CORS ahead of credentialed CORS (src/index.js).
