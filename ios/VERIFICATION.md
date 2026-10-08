# Verification and contributions

Verified on this Mac on October 8, 2026 with Xcode 27.0 (27A266a), iOS 27.0 simulators and Node 24.16.0. Deployment target: iOS 17.0. Older OS versions and physical devices were not runtime-tested.

## Results

| Check | Result |
| --- | --- |
| Simulator build-for-testing, arm64 and x86_64 | Passed |
| Unsigned device Release build, arm64 | Passed on final source |
| Dependency-free web data/workflow suite | 30 tests passed |
| iPhone 18 Pro full Xcode suite | 29 unit/runtime + 3 UI tests passed |
| iPad Pro 13-inch (M5) full Xcode suite | 29 unit/runtime + 3 UI tests passed |
| Final full suite on both devices | 32 tests on each; 64 runs, zero failures or skips |
| Real WebKit geometry | Passed at 320/390 phone widths and 1194 tablet width |
| Whitespace/diff check | Passed |
| Original logo fidelity | SHA-256 matches the release asset exactly |
| Signed development installer | Final Release archive, codesign/profile/certificate validation and extracted `.command --check` passed |
| Installer source fidelity | All 17 bundled web files match final source byte-for-byte |

The native tests cover atomic storage, reopening, previous-file backup, invalid-data preservation, corrupt-file recovery, missing files, byte limits, concurrent store instances, safe export paths, local resource traversal protection, selectable-text and image-only PDFs, script page boundaries, and long report pagination with the final row readable.

The geometry test mounts the real WKWebView and verifies all five 44-point phone destinations, one current destination, hidden/reachable tools, script first-screen visibility, absence of page overflow across all views, search/filter handlers and disclosure persistence, and usable tablet split panels.

The runtime tests execute the actual bundled ES modules and DOM inside `WKWebView`, using the real native storage bridge. They import two screenplay scenes, retain original text, edit a breakdown, add a shooting day, move a strip with touch controls, create a shot, record takes and completion, undo/redo, rename an element before blur, repeatedly switch views, flush and reopen saved work. Browser Final Draft XML parsing and invalid XML rejection are verified. A real USS File import with missing optional calendar fields and one board is normalized before schedule/settings navigation. Dark appearance survives a fresh web view, and unavailable cloud actions are clearly identified.

XCTest UI checks create a production, visit all five sections three times, background/reactivate, terminate/relaunch, and confirm the production title persists. They open native JSON, PDF, then JSON sharing, dismiss each presentation and reopen it. Both phone sheets and iPad popovers worked. A third UI test pastes a screenplay, creates a shot with the keyboard open, searches scenes and captures populated views. These tests cancel sharing; they do not send files to other people or invoke a printer.

## Evidence

- [iPhone interface](evidence/iphone.png)
- [iPad interface](evidence/ipad.png)
- [iPad native PDF share popover](evidence/ipad-pdf-share.png)
- [iPhone shots](evidence/iphone-shots.png)
- [Shot creation with keyboard](evidence/iphone-keyboard.png)

Screenshots show only simulator test productions. The source logo is unchanged; optional Mac-only licensed fonts were not bundled. The visual pass keeps the original brand and introduces a compact phone header, five persistent bottom tabs, command/search disclosures, restrained metric rules and a tablet split view. Real keyboard import and shot-creation checks passed. Narrow-screen geometry checks supplement screenshot inspection.

Local detailed results (not committed because `.xcresult` bundles are large):

- `/tmp/ProductionDesk-iPhone-ReleaseVerified.xcresult` — full iPhone suite, Debug test configuration despite the bundle filename.
- `/tmp/ProductionDesk-iPad-Verified.xcresult` — full iPad suite.
- `/tmp/ProductionDesk-Final-All.xcresult` — final complete suite on both devices, including geometry and keyboard checks.
- `/tmp/ProductionDesk-device-final.log` — final unsigned Release build.

## Actual Claude CLI contribution

Claude Code **2.1.295** ran in a separate Git worktree on `codex/production-desk-ios-storage`, using existing authenticated access. The invocation used `claude -p --permission-mode acceptEdits --allowedTools 'Read,Write,Edit,Bash' --output-format json` with a scoped local storage prompt. It finished successfully in 11 turns, with no permission denials. No credentials were created or committed.

Claude wrote `WorkspaceStore.swift` and 20 XCTest tests. Its implementation provides envelope validation, per-directory serialization, temporary sibling writes, disk flush/atomic rename, previous-valid backup, damage quarantine and recovery, and iOS file protection suitable for background saves. Codex reviewed and integrated these files, corrected the assumed workspace key to the existing `activeProject`, aligned the previous-file name with `workspace.previous.json`, corrected the sorted-filename test expectation, and tightened handling of file inspection errors. All 20 tests then passed in the iOS simulator.

Two Codex agents contributed independently: one implemented the native host, Xcode project, PDF/export integration and platform/UI tests; the other wrote the web suite and reviewed the integrated app. The coordinating Codex agent preserved the bundled interface/assets, implemented mobile and lifecycle adaptations, added browser workflow tests, integrated Claude's work, fixed review findings and inspected the rendered result.

## Preview and limits

The final Debug build, **1.4.1 (1)**, was visibly opened and raised in **Device Hub → iPhone 18 Pro, iOS 27.0** on this Mac. The screenshot was checked through the native UI tools; this Xcode installation uses Device Hub for the simulator preview.

## Limits and setup requiring the owner

A signed development IPA and Mac installer were built using an existing installed Apple Development identity and its matching valid provisioning profile. Signature, certificate membership, profile expiry and registered-device eligibility were verified. The build archives unsigned then signs locally because Xcode refuses manual selection of its managed wildcard profile. No new signing identity, certificate or provisioning profile was created. No paid account purchase, App Store/TestFlight upload, merge or production deployment occurred. The registered phone was disconnected, so physical installation and runtime verification remain blocked until it is connected, unlocked, trusted and has Developer Mode enabled. See [INSTALL.md](INSTALL.md). Generated signed artifacts are local and excluded from Git; they contain development provisioning metadata. The Mac release assets, update feed and update website are unchanged. Google OAuth/cloud sync remains unavailable in this offline iOS edition; use file exports.

Web process recovery restores completed saves; it resets transient navigation/undo history. Modal drafts commit with their explicit action. An operating-system kill before the last disk write completes can lose that final in-flight edit. Native automatic damage recovery validates the workspace envelope; a JSON file with broken USS relationships is preserved and rejected by the web validator rather than silently reset.

## Provenance

Original source archive: `Production-Desk-1.4.1-11.zip`, SHA-256 `b19f1fe60bb82d03400e58a404d1a466e8531d1881e4e897544b2e22d35bb0a2`.

Original and bundled `sp-logo.png`: SHA-256 `b98b8278c2fe100a4a13bd9fed2607d33c3f368d078a7638af45dc3807f80a7f`.

## Local installer artifact

The signed development installer ZIP was saved outside Git as `ProductionDesk-iOS-Installer.zip`, with an unpacked installer beside it in `ProductionDesk-Installer/`. The build output is also retained at `/tmp/ProductionDeskInstaller/`. It uses the existing profile expiring **2027-07-29**.

- IPA SHA-256: `3ea531933a9aae79a819f96ea6acd29db65ffa076a7b4ffd66e8e3925206b342`.
- Installer ZIP SHA-256: `2cbfdd0cfe2c986533499fb9a05328559eaa1d7ab8897f1bbf195ce70471c15f`.

A no-install check rejected an unsigned fixture and an explicitly selected disconnected phone before making any installation call. Only zero connected eligible physical devices were found during final verification.
