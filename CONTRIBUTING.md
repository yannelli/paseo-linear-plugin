# Contributing

Thanks for helping with Linear issues for Paseo. Bug reports, ideas, docs fixes, and code are all welcome. This guide covers the setup, the checks, and how a change becomes a release.

## Quick start

You need Node.js 24 (see `.nvmrc`). To try the plugin in Paseo, you also need Paseo 0.10.0 or newer and a Linear personal API key.

```sh
git clone https://github.com/yannelli/paseo-linear-plugin.git
cd paseo-linear-plugin
npm ci
npm run check
```

`npm run check` must pass before you open a pull request. It runs:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type checks all TypeScript |
| `npm test` | Runs the plugin tests (Linear client, key file, cache, handlers, sub-issue nesting, Markdown and task list toggle, description autosave, agent options) and the release script tests |

The tests use a local GraphQL server. They do not call Linear and do not need an API key.

## Try your change in Paseo

1. Set `LINEAR_API_KEY` in the shell that starts the Paseo daemon, then start or restart the daemon.
2. Turn on **Enable plugins** in **Settings → Plugins**.
3. Install your checkout:

   ```sh
   paseo plugin add "$PWD"
   paseo plugin ls linear
   ```

4. After each edit, reload the plugin. If something fails, read its output:

   ```sh
   paseo plugin reload linear
   paseo plugin logs linear
   ```

If you already installed the npm release, remove it first with `paseo plugin remove linear`. Both installs use the id `linear`.

## Where things live

| Path | Runs in | Contents |
| --- | --- | --- |
| `client/` | App | Linear screen and panel, issue views, agent setup page, and settings screens |
| `shared/` | App and daemon | RPC contracts, settings schema, prompt templates, Markdown parser, and the attachment source |
| `server/` | Daemon only | Linear GraphQL client, key file, response cache, and RPC handlers |
| `index.client.tsx` | App | Registers the screen, the panel, the settings screens, the commands, the timeline card, and the attachment source |
| `index.server.ts` | Daemon | Registers the settings and the RPC handlers |
| `test/` | Node.js | Tests (not published) |
| `scripts/` | GitHub Actions | Release scripts (not published) |
| `docs/graphics/` | Your machine | Source for the README images |

Keep these rules when you change code:

- The API key and all calls to Linear stay in `server/`. The app bundle must never see them.
- `shared/` imports only shared code: no Node.js, React, or `server/` modules.
- Paseo resolves plugin modules only under `client/`, `server/`, and `shared/`. Do not add other module folders at the root.
- Paseo supplies `@getpaseo/plugin`, `zod`, and React at runtime, so they stay in `devDependencies`. Ask in an issue before you add a runtime dependency.
- Do not add keys to `paseo-plugin.json` without checking the oldest supported Paseo version. Paseo 0.10 rejects unknown keys.

## Make a change

1. Open an issue first for a new feature or a large change, so we can agree on the approach.
2. Create a branch named `<type>/<short-name>`, for example `fix/identifier-trim` or `feat/project-filter`.
3. Keep each pull request to one change. Small pull requests get reviewed faster.
4. Add or update tests for any change in behavior.
5. Update `README.md` or `OVERVIEW.md` when users will notice the change.
6. Run `npm run check`.

## Commit messages and pull request titles

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Pull requests are squash-merged, so the **pull request title** becomes the commit on `main`. The title decides whether a release happens:

| Title starts with | Example | Release |
| --- | --- | --- |
| `fix:`, `perf:`, `revert:` | `fix(search): trim identifier queries` | Patch, `0.1.0` to `0.1.1` |
| `feat:` | `feat(search): match issues by project` | Minor, `0.1.0` to `0.2.0` |
| `!` after the type, or a `BREAKING CHANGE:` footer | `feat(search)!: drop title search` | Major |
| `docs:`, `test:`, `chore:`, `ci:`, `refactor:`, `build:` | `docs: explain key permissions` | No release |

Format: `<type>(<optional scope>): <summary>`.

- Write the summary in the imperative mood: "add", not "added" or "adds".
- Start the summary with a lowercase letter and leave out the final period.
- Keep the header at 72 characters or fewer.
- Do not use `chore(release)`. The release workflow uses it.

## Pull request checklist

- [ ] The title follows the format above.
- [ ] The description says what changed and why, in a few short paragraphs.
- [ ] A **Testing** section lists the checks you ran, for example `npm run check`.
- [ ] Tests cover the new behavior.
- [ ] The docs match the change.
- [ ] No API keys, tokens, or private Linear data in code, tests, screenshots, or logs.

## Report a bug

Open an [issue](https://github.com/yannelli/paseo-linear-plugin/issues) and include:

- The Paseo version, and the plugin source and revision from `paseo plugin ls linear`.
- Your operating system.
- The steps that cause the problem, what you expected, and what happened.
- The error text from the picker or from `paseo plugin logs linear`.

Remove your API key and any private issue content before you post.

## Security problems

Do not open a public issue for a security problem. Contact the maintainer through [ryanyannelli.com](https://ryanyannelli.com) and include the steps to reproduce it.

## Graphics

The README images are illustrations with sample data. To change them, edit `docs/graphics/scene.html` or `scene.css`, then render:

```sh
node docs/graphics/render.mjs
```

The script needs Playwright with Chromium. Check each image before you commit it. Do not use the Linear logo or other third-party logos.

## Releases

You do not need to change version numbers. When a release-triggering commit lands on `main`, GitHub Actions:

1. Runs `npm run check`.
2. Picks the next version from the commit types.
3. Updates `package.json` and `package-lock.json`, then tags the commit.
4. Publishes the GitHub release and the npm package.

To preview the next release, run `npm run release:dry-run` on a clean `main` checkout with all tags fetched. See [npm publishing](docs/npm-publishing.md) for the publishing setup.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
