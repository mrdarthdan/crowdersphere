# Signing CrowderSphere releases

Unsigned installers work, but Windows shows "Windows protected your PC" and macOS refuses to open the app until the user overrides it. Signing removes those warnings. The release workflow (`.github/workflows/release.yml`) signs automatically as soon as the secrets below exist in **GitHub → Settings → Secrets and variables → Actions**. Nothing else needs to change.

## Windows: pick one

### Option A: SignPath Foundation (free, for open-source projects)

*Applied November 2026 and turned down for now, because the project doesn't have a userbase yet. Worth applying again once it does. Until then, Option B is in use.*

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

### Option B: Azure Artifact Signing (paid, publisher shows your name) — chosen

Microsoft's signing service, formerly called Trusted Signing. The Basic tier is $9.99 a month for up to 5,000 signatures, far more than releases need. Individual developers in the US and Canada can verify their identity, and the installer then shows your own name as the publisher. One account can sign all your Windows apps.

1. **Azure subscription.** Sign in at <https://portal.azure.com> with your Microsoft account. Artifact Signing doesn't work on free, trial or sponsored subscriptions, so use (or upgrade to) a **pay-as-you-go** subscription. For individual validation the billing account type must be *Individual*.
2. **Register the service.** Subscriptions → your subscription → Resource providers → find `Microsoft.CodeSigning` → Register.
3. **Create the signing account.** Create a resource → search "Artifact Signing" → Create. Pick a resource group (e.g. `crowdersphere-signing`), a name (e.g. `crowdersphere`), a region (e.g. West US 2), and the **Basic** pricing tier. The region decides the endpoint: West US 2 is `https://wus2.codesigning.azure.net`, East US is `https://eus.codesigning.azure.net` (shown on the account's Overview page as *Account URI*).
4. **Give yourself the role.** On the account: Access control (IAM) → Add role assignment → *Artifact Signing Identity Verifier* → your own user. Without it, the identity validation page is greyed out.
5. **Verify your identity.** On the account: Identity validations → New identity → **Public** → **Individual**. You'll confirm your details and complete a photo ID plus selfie check with Microsoft Authenticator (Entra Verified ID). Approval usually takes from a few hours to a few days.
6. **Create the certificate profile.** Once validation shows *Completed*: Certificate profiles → Create → **Public Trust**, pick the validated identity, name it (e.g. `crowdersphere-public`).
7. **Create the app GitHub signs with.** Microsoft Entra ID → App registrations → New registration (name e.g. `crowdersphere-github-signing`, defaults otherwise). Note its *Application (client) ID* and *Directory (tenant) ID*. Then Certificates & secrets → New client secret (24 months) and copy the **Value** right away; it's only shown once. Put a reminder on your calendar to renew it before it expires.
8. **Let that app sign.** Back on the signing account: Access control (IAM) → Add role assignment → *Artifact Signing Certificate Profile Signer* → select the app registration.
9. Add these GitHub secrets:
   - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`: from the app registration
   - `AZURE_SIGNING_ENDPOINT`: for example `https://wus2.codesigning.azure.net`
   - `AZURE_SIGNING_ACCOUNT`: the signing account name
   - `AZURE_SIGNING_PROFILE`: the certificate profile name
10. **Test it:** run the **Release** workflow from the Actions tab (or push the next version tag). In the Windows job, the *Set up Azure Artifact Signing* step should run instead of being skipped. Download the installer from the draft release, right-click → Properties → Digital Signatures, and check your name is listed.

Newly signed apps can still get a SmartScreen warning for the first few weeks, until enough people have downloaded them; signing builds that reputation under your name.

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
