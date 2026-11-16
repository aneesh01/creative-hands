# Creative Hands website

Static site plus a small Cloudflare Worker for the events calendar.

| Folder / file    | What it is                                                    |
|------------------|---------------------------------------------------------------|
| `public/`        | Everything visitors can load: pages, images, `events.json`, the admin page in `public/admin/` |
| `src/`           | Worker code: public `/api/events`, and the admin API under `/admin/api/` |
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

`main` and `staging` are protected by a GitHub ruleset (no deletion, no force pushes, pull requests only).

## Events admin

The events editor is at `/admin/`. Nobody can open it without signing in through **Cloudflare Access**
(an emailed one-time code, for addresses listed in the Access policy). The Worker also checks the
Access sign-in token itself (`src/access.js`) before allowing any change.

- Each publish is saved in a change history (last 30 versions) with the time and who published it.
  Any earlier version can be restored from the admin page.
- If two people edit at once, the second to publish is asked to reload rather than overwriting.

## Running locally

Create `.dev.vars` (ignored by Git) with a made-up email address, which stands in for the Access sign-in:

```
DEV_ADMIN_EMAIL=you@example.com
```

Then run `npx wrangler dev` and open http://localhost:8787/admin/. This only works on `localhost`;
on a real domain the Worker always requires a genuine Access sign-in. Events saved locally stay on your computer.
