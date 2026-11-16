# Creative Hands website

Static site plus a small Cloudflare Worker for the events calendar.

| Folder / file    | What it is                                                    |
|------------------|---------------------------------------------------------------|
| `public/`        | Everything visitors can load: pages, images, `events.json`    |
| `src/`           | Worker code: `/api/events` (calendar) and `/api/session` (admin sign-in) |
| `wrangler.jsonc` | Cloudflare settings for production and staging               |

## Branches and where they deploy

| Branch      | Cloudflare Worker         | Address                            | Event storage      |
|-------------|---------------------------|------------------------------------|--------------------|
| `main`      | `creative-hands`          | creativehandsceramics.com          | live events        |
| `staging`   | `creative-hands-staging`  | staging.creativehandsceramics.com (Cloudflare Access sign-in) | separate test events |
| any other   | not deployed              | —                                  | —                  |

## Making a change

1. From `staging`, create a branch for the change.
2. Open a pull request into `staging`, merge it, and check the staging site.
3. When it looks right, open a pull request from `staging` into `main` and merge it ("Create a merge commit"). That goes live.

Direct pushes to `main` are blocked by the local `pre-push` hook.

## Running locally

Create `.dev.vars` (ignored by Git) containing a test passphrase:

```
ADMIN_KEY=local-test-passphrase
```

Then run `npx wrangler dev` and open http://localhost:8787. Events saved locally stay on your computer.

Secrets (`ADMIN_KEY`) are set per Worker in the Cloudflare dashboard and never committed.
