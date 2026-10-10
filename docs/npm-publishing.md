# npm publishing

Created: 2026-10-07. Last updated: 2026-10-07.

The **Release** workflow publishes `@yannelli/paseo-linear-plugin` to npm after the GitHub release step. Paseo 0.10.0 and newer install it with:

```sh
paseo plugin add npm:@yannelli/paseo-linear-plugin
```

Paseo runs `npm install --omit=dev --ignore-scripts` on the daemon host and compiles `index.client.tsx` and `index.server.ts` itself. The tarball holds TypeScript source only, as listed in `files` in `package.json`. Paseo resolves plugin modules only under `client/`, `server/`, and `shared/`. After you add a top-level file, run `npm pack --dry-run` to check the file list.

## Workflow step

The **Publish npm package** step reads the name and version from `package.json`. It runs `npm publish` when npm does not have that version yet. If a publish fails, a rerun completes it. A push without release-triggering commits skips the step, because npm already has the version. A beta version, such as `1.1.0-beta.0`, is published from the `beta` branch with `npm publish --tag beta`, so the `latest` dist-tag does not change. An alpha version, such as `1.1.0-alpha.0`, is published from the `alpha` branch with `npm publish --tag alpha`.

The job grants `id-token: write`. npm uses the OIDC token to authenticate and attaches a provenance statement automatically. Provenance requires a public repository.

## First publish

npm trusted publishing needs an existing package, so the first version is published by hand. Until then, the **Publish npm package** step fails on each run. This is expected. Use npm CLI 11.15.0 or newer and an npm account with 2FA.

1. Log in:

   ```sh
   npm login
   npm whoami
   ```

2. Publish the first release from its tag:

   ```sh
   git clone https://github.com/yannelli/paseo-linear-plugin.git
   cd paseo-linear-plugin
   git checkout v0.1.0
   npm ci
   npm run check
   npm pack --dry-run
   npm publish
   ```

3. Run the **Release** workflow again from the Actions tab, or run `gh workflow run release.yml --repo yannelli/paseo-linear-plugin`. The npm step finds 0.1.0 and passes.

4. Trust the release workflow when a `feat:` or `fix:` commit is ready to merge. A new trust entry expires unless a publish through it succeeds [within 2 days](https://docs.npmjs.com/trusted-publishers). The release from that commit, for example 0.1.1, is the first publish through OIDC.

   ```sh
   npm trust github @yannelli/paseo-linear-plugin --repo yannelli/paseo-linear-plugin --file release.yml --allow-publish
   npm trust list @yannelli/paseo-linear-plugin
   ```

   If the entry expires, revoke it and run `npm trust github` again.

5. After that release appears on npm, open the package's **Settings** on npmjs.com. Set **Publishing access** to require 2FA and disallow tokens. The workflow publishes without a token.

Later `feat:` and `fix:` commits on `main` publish through the workflow.

## Authentication

npm CLI 11.5.1 or newer on Node.js 22.14.0 or newer exchanges the job's OIDC token for a short-lived publish token. The workflow reads no npm secret. Do not add an `NPM_TOKEN` secret.

The trust entry names the workflow file. When you rename `release.yml` or move the publish step to another workflow, replace the entry:

```sh
npm trust list @yannelli/paseo-linear-plugin
npm trust revoke @yannelli/paseo-linear-plugin --id=<trust-id>
npm trust github @yannelli/paseo-linear-plugin --repo yannelli/paseo-linear-plugin --file <workflow>.yml --allow-publish
```

`npm trust` requires a 2FA login and rejects tokens that bypass 2FA. The npmjs.com equivalent is the package's **Settings → Trusted publishing**.
