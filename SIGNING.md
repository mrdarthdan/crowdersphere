# Signing CrowderSphere releases

Unsigned installers work, but Windows shows "Windows protected your PC" and macOS refuses to open the app until the user overrides it. Signing removes those warnings. The release workflow (`.github/workflows/release.yml`) signs automatically as soon as the secrets below exist in **GitHub → Settings → Secrets and variables → Actions**. Nothing else needs to change.

## Windows: pick one

### Option A: SignPath Foundation (free, for open-source projects) — chosen

SignPath Foundation issues the certificate and signs the installers that GitHub Actions builds from this public repository. The installer's publisher shows as "SignPath Foundation". The repository is already set up for their rules: an OSI license (MIT), a [code signing policy](README.md#code-signing-policy) and [privacy statement](README.md#privacy) on the home page, release notes that link to both, builds from tagged commits with `Cargo.lock` pinned, and an uninstaller.

**1. Before applying**
- Turn on two-factor authentication for your GitHub account (SignPath requires it for everyone on the team).
- Publish at least one unsigned release (SignPath only signs projects that are already released): push a version tag, then publish the draft release.

**2. Apply** at <https://signpath.org/apply> with the repository URL and the release page. Approval is case by case and can take a few weeks.

**3. Once approved, in SignPath** (turn on two-factor sign-in there too):
- Link the GitHub repository as a *trusted build system* (GitHub.com), as their onboarding describes.
- Create a project with the slug `crowdersphere`.
- Add an artifact configuration with the slug `initial` and paste in [`.signpath/artifact-configuration.xml`](.signpath/artifact-configuration.xml).
- Use the signing policy `release-signing`, with yourself as approver.

**4. Add two GitHub secrets** (Settings → Secrets and variables → Actions):
- `SIGNPATH_API_TOKEN`: an API token for a SignPath user that can submit signing requests
- `SIGNPATH_ORGANIZATION_ID`: from your SignPath dashboard address (`app.signpath.io/Web/<this>/...`)

**5. Each release after that:** push the tag as usual. The Windows build waits (up to an hour) for you to approve the signing request in SignPath, then swaps the signed installer into the draft release. Publish the release once it's there.

### Option B: Azure Artifact Signing (paid, publisher shows your name)

Microsoft's signing service, formerly called Trusted Signing. It costs a monthly fee (Basic tier, check current Azure pricing). Individual developers in the US and Canada can verify their identity, and the installer then shows your own name as the publisher.

1. In the Azure portal, create an Artifact Signing account, complete identity validation, and create a **Public Trust** certificate profile.
2. Create an app registration (service principal) and give it the *Artifact Signing Certificate Profile Signer* role on the account.
3. Add these GitHub secrets:
   - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`: from the app registration
   - `AZURE_SIGNING_ENDPOINT`: for example `https://wus2.codesigning.azure.net`
   - `AZURE_SIGNING_ACCOUNT`: the signing account name
   - `AZURE_SIGNING_PROFILE`: the certificate profile name

If both are configured, Azure is used.

## macOS: Apple Developer ID

This requires the Apple Developer Program ($99 a year). Without it, Mac builds are ad-hoc signed, so users must right-click the app and choose **Open** the first time.

1. In your Apple Developer account, create a **Developer ID Application** certificate and export it from Keychain Access as a `.p12` file.
2. Create an app-specific password at <https://appleid.apple.com> (used for notarization).
3. Add these GitHub secrets:
   - `APPLE_CERTIFICATE`: the .p12 file, base64-encoded (`base64 -i cert.p12 | pbcopy`)
   - `APPLE_CERTIFICATE_PASSWORD`: the .p12 export password
   - `APPLE_SIGNING_IDENTITY`: for example `Developer ID Application: Daniel Crowder (TEAMID)`
   - `APPLE_ID`, `APPLE_PASSWORD` (the app-specific password), `APPLE_TEAM_ID`

## Automatic updates: the update key

Installed copies of CrowderSphere update themselves from GitHub Releases. Each update is signed with a private **update key**, and the app only installs updates signed with it, so nobody else can push an update to CrowderSphere users. This is separate from code signing.

**Create the key once, on your own computer** (needs [Node.js](https://nodejs.org)). In PowerShell:

```
npx @tauri-apps/cli signer generate -w "$HOME\.tauri\crowdersphere.key"
```

Choose a strong password when asked. It writes two files:
- `crowdersphere.key`: the **private key**. Keep it secret and back it up together with its password (for example in your password manager). If it's lost, existing installs can't receive updates any more.
- `crowdersphere.key.pub`: the **public key**. Safe to share; it goes in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

**Add two GitHub secrets:**
- `TAURI_SIGNING_PRIVATE_KEY`: the whole contents of `crowdersphere.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password

From then on every release also gets `latest.json` and `.sig` files, and the app offers the update to everyone on an earlier version once the release is **published** (drafts aren't offered).

## Making a release

1. Change `version` in `src-tauri/Cargo.toml` (for example to `2.3.0`), add a `## 2.3.0` section to `CHANGELOG.md` saying what's new, and commit. The release notes, and the app's **Update available** window, use that section.
2. Push a matching tag (`git tag v2.3.0 && git push origin v2.3.0`), or run the **Release** workflow from the Actions tab.
3. When the Release workflow finishes, open the draft release on GitHub, check it, and click **Publish release**.
