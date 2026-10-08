# Production Desk for iPhone and iPad

An offline iOS edition of Production Desk, built from the application's sources in this repository's `Production-Desk-1.4.1-11.zip`. The Squid Productions identity, Spanish Red (`#E60026`), original logo, production tools and USS 1.0.0 data remain intact. The release website, Mac downloads and Sparkle update feed are unchanged.

## Open and build

Open `ProductionDesk.xcodeproj` in Xcode. Select the **ProductionDesk** scheme and an iPhone or iPad simulator. The minimum OS is iOS 17. No dependencies, Python server, internet connection, API key or paid account are needed to run in a simulator.

```sh
xcodebuild -project ios/ProductionDesk.xcodeproj -scheme ProductionDesk \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO build
node ios/scripts/test-web.mjs
```

For tests, choose an installed simulator by name or ID:

```sh
xcodebuild -project ios/ProductionDesk.xcodeproj -scheme ProductionDesk \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO test
```

A physical iPhone/iPad requires a matching development signing setup. See [INSTALL.md](INSTALL.md) for the Mac installer, signed IPA builder and no-install checks. An actual signed installer was built and verified using existing local credentials; the registered physical phone was disconnected, so installation was not performed. The original identifier `local.slate.filmscheduler` and display name **Production Desk** are retained. No certificate or provisioning profile is committed. App Store/TestFlight distribution was not performed.

## Core workflows

- Create and switch productions; create and edit scenes and production elements.
- Import selectable-text PDF, Final Draft `.fdx`, Fountain, TXT, USS, or full workspace JSON through Files, or paste screenplay text. Review detected cast and estimated page eighths.
- Add shooting days, move strips with the touch **↕** control or **Move scene**, reorder and color strips, duplicate schedule scenarios, and set calendar/cast availability.
- Plan shots, edit camera and time details, track takes and status, reorder shots, and undo/redo edits.
- Export full JSON backups, USS interchange (intentionally excludes scripts and shot extensions), schedule CSV, shot CSV and paginated report PDFs through the iOS share sheet. Save to Files or use AirPrint.
- Use Light/Dark settings. Google account linking and cloud synchronization are unavailable in this offline edition; export files for interchange.

## Architecture and persistence

UIKit hosts the original interface in `WKWebView`. `productiondesk://app` serves bundled HTML, CSS, ES modules and images without a listening port or remote website. `scheduler` is a reply-capable bridge accepted only from the local main frame. Native operations are serialized off the UI thread. PDFKit extracts script text and UIKit creates paginated reports and presents anchored share sheets on iPad.

Script parsing and USS validation stay in the bundled, dependency-free `film-native.js` supplied by the original Mac release. Native storage independently validates the workspace envelope and writes atomically with a previous-file backup. JavaScript queues edits immediately and flushes before backgrounding. App termination restores the latest completed save; an operating-system kill before a disk write finishes cannot guarantee preservation of that last keystroke. Modal drafts commit only when their Save/Create/Import action is selected. Web process recovery reloads saved work; undo history and current navigation are in memory.

Workspace files are in **Files → On My iPhone/iPad → Production Desk**. Keep an exported full backup before replacing, deleting or uninstalling the app. If both current and previous files are damaged, the app preserves them and shows a recovery message; restore a known-good `workspace.json` in Files and reopen. Avoid editing the live JSON while the app is open.

The release dynamically discovers optional Reross/Final Draft fonts on Macs. They are not present in the archive and are not redistributed here. This edition retains the release's Futura and Courier fallback stacks.

## Source provenance

`ProductionDesk/Web` was extracted from the tracked 1.4.1 archive. Mobile changes add a compact production header, persistent phone navigation, script search disclosure, touch sizing, lifecycle saves, UUID compatibility and import validation. The original transparent `sp-logo.png` is byte-for-byte unchanged. The app icon places that same logo on a white iOS icon canvas. See [DESIGN.md](DESIGN.md) for the visual direction and [VERIFICATION.md](VERIFICATION.md) for actual checks and contribution details.
