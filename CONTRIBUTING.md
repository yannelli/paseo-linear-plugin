# Contributing

Thanks for helping with Linear for Paseo. Bug reports, ideas, docs fixes, and code are all welcome. This guide covers the setup, the checks, and how a change becomes a release.

## Quick start

You need Node.js 24 (see `.nvmrc`). To try the plugin in Paseo, you also need Paseo 0.11.0 or newer and a Linear personal API key.

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
| `npm test` | Runs the plugin tests (Linear client, key file, cache, handlers, sub-issue nesting, Markdown parser and task list toggle, description autosave, agent options, prompt guidance and its hooks, the MCP server and its tools with their settings, project tools for every agent, sub-issue agents, todo sync, the read-only setup agent, project settings, SVG icon checks and colors) and the release script tests |

The tests use a local GraphQL server. They do not call Linear and do not need an API key.

## Try your change in Paseo

1. Set `LINEAR_API_KEY` in the shell that starts the Paseo daemon, then start or restart the daemon.
2. Turn on **Enable plugins** in **Settings → Plugins**.
3. Install your checkout:

   ```sh
   paseo plugin add "$PWD"
   paseo plugin ls paseo-linear-plugin
   ```

4. After each edit, reload the plugin. If something fails, read its output:

   ```sh
   paseo plugin reload paseo-linear-plugin
   paseo plugin logs paseo-linear-plugin
   ```

If you already installed the npm release, remove it first with `paseo plugin remove paseo-linear-plugin`. Both installs use the id `paseo-linear-plugin`.

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
| `docs/*.md` | GitHub | Guides linked from the README |
| `docs/graphics/` | Your machine | Source for the README images, the social preview, and the icon |

Keep these rules when you change code:

- The API key and all calls to Linear stay in `server/`. The app bundle must never see them.
- `shared/` imports only shared code: no Node.js, React, or `server/` modules.
- Paseo resolves plugin modules only under `client/`, `server/`, and `shared/`. Do not add other module folders at the root.
- Paseo supplies `@getpaseo/plugin`, `zod`, and React at runtime, so they stay in `devDependencies`. Ask in an issue before you add a runtime dependency.
- Check the oldest supported Paseo version, 0.11.0, before you use a newer host API or add keys to `paseo-plugin.json`. The types in `devDependencies` match 0.11. Detect newer APIs at runtime, as `client/plugin-icon.tsx` does for the SVG icons of Paseo 0.13.

## Make a change

1. Open an issue first for a new feature or a large change, so we can agree on the approach.
2. Create a branch named `<type>/<short-name>`, for example `fix/identifier-trim` or `feat/project-filter`.
3. Keep each pull request to one change. Small pull requests get reviewed faster.
4. Add or update tests for any change in behavior.
5. Update `README.md`, the guides in `docs/`, or `OVERVIEW.md` when users will notice the change.
6. Run `npm run check`.

## Commit messages and pull request titles

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Pull requests are squash-merged, so the **pull request title** becomes the commit on `main`. The title decides whether a release happens:

| Title starts with | Example | Release |
| --- | --- | --- |
| `fix:`, `perf:`, `revert:` | `fix(search): trim identifier queries` | Patch, `0.1.0` to `0.1.1` |
| `feat:` | `feat(search): match issues by project` | Minor, `0.1.0` to `0.2.0` |
| `!` after the type or scope, or a `BREAKING CHANGE:` footer | `feat(search)!: drop title search` | Major |
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

- The Paseo version, and the plugin source and revision from `paseo plugin ls paseo-linear-plugin`.
- Your operating system.
- The steps that cause the problem, what you expected, and what happened.
- The error text from the picker or from `paseo plugin logs paseo-linear-plugin`.

Remove your API key and any private issue content before you post.

## Security problems

Do not open a public issue for a security problem. Report it privately as described in [SECURITY.md](SECURITY.md), and include the steps to reproduce it.

## Graphics

The README images are illustrations with sample data. To change them, edit `docs/graphics/scene.html` or `scene.css`, then render:

```sh
node docs/graphics/render.mjs
```

- **Output**
  - `hero`, `browse`, `launch`, and `keys` in a dark and a light version, such as `browse-dark.png` and `browse-light.png`
  - The README picks the version that matches the reader's GitHub theme with `<picture>`
  - `hero-dark.png` is also the GitHub social preview. Upload it in the repository's **Settings → General → Social preview**.
  - `icon.png` is the plugin icon. `paseo-plugin.json` points at it, and `package.json` ships it.
  - The dark images are the manifest `media`, in listing order, and `package.json` ships them. The first one is the registry card.
- **Look**
  - Dark follows linear.app, and its windows use Paseo's Zinc dark theme
  - Light follows vercel.com, and its windows use Paseo's light theme
  - Fonts are Geist and Geist Mono under the [SIL Open Font License](docs/graphics/fonts/OFL.txt)
  - Line icons follow [Lucide](https://lucide.dev), which uses the ISC License
  - The icon is original and is not the Linear logo. The flat mark in the app is `markSvg` in `shared/custom-icon.ts`. Do not use the Linear logo or other third-party logos.
- **Checks**
  - The script finds Playwright with Chromium locally or in the global npm root. Set `PLAYWRIGHT_MODULE` to its entry file to choose another copy.
  - It stops if the fonts do not load, if content leaves the frame or is cut off, or if an image is 900 KB or larger

Check each image before you commit it.

## Releases

You do not need to change version numbers. When a release-triggering commit lands on `main`, GitHub Actions:

1. Runs `npm run check`.
2. Picks the next version from the commit types.
3. Updates `package.json` and `package-lock.json`, then pushes an annotated tag.
4. Publishes the GitHub release with its notes, and publishes [`@yannelli/paseo-linear-plugin`](https://www.npmjs.com/package/@yannelli/paseo-linear-plugin) to npm through trusted publishing (OIDC), with no npm token.

The highest change since the last release sets the next version, and a breaking change makes a major release even before 1.0. To complete a GitHub or npm publication that stopped after its tag was pushed, run the **Release** workflow again.

### Beta releases

To publish a change for testing before a stable release, open the pull request against the `beta` branch. A release-triggering commit on `beta` publishes the next version as a beta, such as `1.1.0-beta.0`. The beta goes to npm with the `beta` dist-tag and to GitHub as a prerelease, so `latest` does not change. Install it with `paseo plugin add npm:@yannelli/paseo-linear-plugin@beta`. When the beta is ready, merge `beta` into `main` to release the stable version.

### Alpha releases

For a change that needs testing before it goes to beta users, open the pull request against the `alpha` branch. A release-triggering commit on `alpha` publishes the next version as an alpha, such as `1.1.0-alpha.0`. The alpha goes to npm with the `alpha` dist-tag and to GitHub as a prerelease, so `latest` and `beta` do not change. Install it with `paseo plugin add npm:@yannelli/paseo-linear-plugin@alpha`, or update an installed plugin with `paseo plugin update paseo-linear-plugin --version alpha`. When the alpha is ready, merge `alpha` into `beta`.

To preview the next release, run `npm run release:dry-run` on a clean `main`, `beta`, or `alpha` checkout with all tags fetched. See [npm publishing](docs/npm-publishing.md) for the publishing setup.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
