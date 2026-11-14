# calendar-themes: agent guide

Work in a dedicated branch or worktree and preserve unrelated changes. Read the repository's setup and applicable operational procedures before running commands. Keep credentials, private records and generated build output out of commits.

## Repository navigation

CalTheme: GHL calendar themes, booking embeds, OAuth and Paddle billing, served by Express with Supabase storage.

Start with [README.md](README.md). Read any more specific AGENTS.md in the directory you change.

| Path | Use it for |
| --- | --- |
| [src/index.js](src/index.js) | Express entry point and middleware order |
| [src/routes/](src/routes/) | OAuth, booking, theme, pixel and billing routes |
| [src/services/](src/services/) | GHL integration, theme defaults and CSS compilation |
| [src/db/index.js](src/db/index.js) | Supabase data access |
| [public/](public/) | Builder and embed HTML, CSS and browser JavaScript |
| [sql/](sql/) | Billing schema |
| [supabase/schema.sql](supabase/schema.sql) | Database schema |
| [PADDLE_INTEGRATION.md](PADDLE_INTEGRATION.md) | Billing integration guide |

## Local verification

No test, lint or build script is declared in package.json. Run `node --check src/index.js` for entry-point syntax; this does not verify all modules or runtime behavior. Use `npm run dev` only with an isolated development database and sandbox integrations.

## Ownership and constraints

src/ and public/ are the working app. The mnt/ tree contains another copy; verify provenance before using it. Keep the Paddle raw-body webhook ahead of express.json(), and public pixel CORS ahead of credentialed CORS (src/index.js).
