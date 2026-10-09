# App Store build readiness

The iOS target remains Production Desk **1.4.1 (2)**, bundle `local.slate.filmscheduler`, iOS 17 or later. The desktop 1.4.2 release does not change the iOS source.

`PrivacyInfo.xcprivacy` declares no tracking or developer collection and reason **C617.1** for file metadata inside the app container. `WorkspaceStore.readCandidate` reads workspace file attributes to reject oversized backups before loading them. No metadata is sent to a developer service. The reason follows [Apple's required-reason specification](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons).

`ITSAppUsesNonExemptEncryption` is false: this app includes no custom cryptography or third-party encryption implementation. The native app uses Apple's system frameworks. No accounts, ads, analytics, payments, in-app purchases or third-party SDK dependencies are present. These source findings support listing preparation; the owner must review the final App Store privacy disclosures.

Production data is local. User-selected sharing, AirPrint, support email, Files providers and operating-system backups can send or store chosen data externally. No sensitive-device permission prompts are requested. Google account and transfer controls are unavailable in the iOS Settings path. There is no hosted content feed, social posting or bundled mature-content catalogue; screenplay content is supplied by the user.

For a Release archive without contacting Apple's provisioning service:

```sh
xcodebuild -project ios/ProductionDesk.xcodeproj -scheme ProductionDesk \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath /tmp/ProductionDesk.xcarchive CODE_SIGNING_ALLOWED=NO archive
```

Verified with Xcode 27.0: archive succeeded; built arm64 bundle has the expected identifier/version/build, privacy manifest and exemption flag; every bundled Web file matches source; 1024×1024 app icon has no alpha. Existing 94 test executions cover app behavior. The only archive warning is skipped App Intents metadata because the app does not use AppIntents.

An unsigned archive cannot be uploaded as-is. Export requires an App Store distribution profile matching this explicit app identifier and an existing Apple Distribution identity. Do not create certificates or profiles or invoke automatic provisioning without authorization. An export or upload success does not imply processing, App Review submission, approval or publication. App pricing and listing metadata are managed separately in App Store Connect.

Build 2 updates the visible software credit to “Squid Productions and Gabe Mills,” as requested. It preserves the app name, logo, version and workflows. Build 1 was validated and uploaded previously; the replacement keeps the existing approved signing assets.

Build 2 verification: the signed Release archive and App Store export succeeded with the existing distribution identity and approved app-specific profile. Apple validation passed for 1.4.1 (2), and the replacement uploaded successfully to App Store Connect app 6821032415 on October 9, 2026. Xcode Organizer records build 2 as Uploaded to Apple. Processing and listing build selection are separate checks. The affected layout/navigation check passed at 320, 390 and 1194 CSS pixels; the populated iPad UI test passed after explicitly dismissing the software keyboard before modal footer actions. It covers script import, the three primary views, shot creation and keyboard interaction. The refreshed `evidence/ipad.png` is a 2064×2752 simulator capture with the joint credit visible. The full 94 executions above describe the earlier implementation verification; only these affected checks were repeated for build 2.
