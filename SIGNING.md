# Signing CrowderSphere releases

Unsigned installers work, but Windows shows "Windows protected your PC" and macOS refuses to open the app until the user overrides it. Signing removes those warnings. The release workflow (`.github/workflows/release.yml`) signs automatically as soon as the secrets below exist in **GitHub → Settings → Secrets and variables → Actions**. Nothing else needs to change.

## Windows: pick one

### Option A: SignPath Foundation (free, for open-source projects)

SignPath Foundation issues the certificate and signs builds made by GitHub Actions from this public repository. The installer's publisher shows as "SignPath Foundation", and the project needs to stay fully open source.

1. Apply at <https://signpath.org/apply>. The project needs an OSI license (MIT ✓), a public repository, and releases built by CI (✓). Approval can take a few weeks.
2. Once approved, in SignPath create a project with the slug `crowdersphere`, a signing policy `release-signing`, and an artifact configuration `initial` that signs the `.exe` in the uploaded zip.
3. Link the GitHub repository to SignPath as a trusted build system, as their onboarding describes.
4. Add these GitHub secrets:
   - `SIGNPATH_API_TOKEN`
   - `SIGNPATH_ORGANIZATION_ID`
5. Add a short code-signing policy page (README section or website). SignPath requires one, with the line: *"Free code signing provided by SignPath.io, certificate by SignPath Foundation."*

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

## Making a release

1. Change `version` in `src-tauri/Cargo.toml` (for example to `1.7.0`) and commit.
2. Push a matching tag: `git tag v1.7.0 && git push origin v1.7.0`
3. When the Release workflow finishes, open the draft release on GitHub, check it, and click **Publish release**.
