# Mobile design review

The existing phone screenshot (`evidence/iphone.png`) spends roughly half the screen on branding, production switching, navigation and utility commands. The script heading sits near the bottom, and the script itself is below the first screen. The clean pass should put the scene first while keeping the Squid identity recognizable.

## Preserve the visual identity

Keep the original transparent SP mark, **Production Desk**, Squid Production credit, Spanish Red `#E60026`, existing Futura heading stack and Courier screenplay stack. The tracked 1.4.1 archive and bundled `Web/style.css`, `Web/themes.css`, `Web/assets/sp-logo.png` are the reference. Use red for the primary creation action, selected section and small structural accents. Quiet neutral surfaces should give the screenplay and stripboard more emphasis. Keep the existing scene-color semantics and custom strip colors.

## Phone composition

Use a compact brand/project header with a clear production picker and a collapsed production-tools disclosure. Retain all five primary destinations in a persistent bottom navigation bar: Breakdown, Schedule, Shots, Elements and Reports. Keep full accessible names if visible labels are shortened. Apple describes tab bars as navigation among top-level sections; its navigation guidance emphasizes concise labels, and its design Q&A recommends labels for clarity and accessibility. [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [navigation guidance](https://developer.apple.com/videos/play/wwdc2022/10001/), [design Q&A](https://developer.apple.com/news/?id=s8sl4tpa).

Condense duplicate production title/breadcrumb text, keep save status and Undo/Redo reachable, and show scene or shot content within the first phone screen. Keep Import, New production, Production settings, Appearance and Help in the disclosure. Treat the disclosure as a command group rather than a sixth tab.

Retain the tablet's script/breakdown split when width permits; let the stripboard span the available area. A narrow iPad window can use the phone composition, but an 820-point portrait iPad should not inherit a tall phone header solely because of the current `max-width:1000px` rule.

## Implementation traps

- Keep `#navigation` outside any collapsed disclosure subtree. A hidden ancestor also hides a fixed-position descendant. Preserve the current button nodes, IDs and `data-view` values so click handlers, render selection and workflow state survive.
- The CSS cascade currently runs `style.css`, `shots.css`, `ipad.css`, `themes.css`, then `ios.css`. `themes.css` explicitly restores the mobile `.sidebar-bottom`; put new mobile overrides last and avoid depending on older hidden rules. Original mobile rules hide navigation icons, so restore their display explicitly if used.
- Reserve content space for the full bottom bar. Keep the final editor buttons and toast above it. The native WKWebView already respects UIKit safe areas; CSS safe-area variables can be zero there. Verify the combined inset instead of assuming a full-screen web viewport.
- Use a visible selected marker as well as color, and set `aria-current="page"` on exactly one destination. Decorative icons should be hidden from accessibility. The tools disclosure needs a meaningful name and correct expanded state.
- Make touch targets at least 44 by 44 points, use legible labels and sufficient contrast in both themes. These sizes and contrast principles are published in Apple's [UI design tips](https://developer.apple.com/design/tips/). Avoid shrinking tab text below 11 points to force a long label into one line.
- Test keyboard-open layout: fixed web bars can move above the keyboard, and sticky modal footers can consume a short viewport. Keep focused fields and Save/Cancel reachable. Avoid global overflow clipping that prevents reports from scrolling horizontally or script text from being selected.

## Meaningful runtime regressions

Use actual WKWebView DOM geometry in `RuntimeWorkflowTests`, rather than tests that assert CSS text. The dependency-free Node tests cover data integrity; they cannot verify viewport layout.

1. At compact widths, assert five unique `#navigation [data-view]` controls, all visible, with tap rectangles at least 44 by 44 CSS pixels. After switching through all five sections repeatedly, assert exactly one selected/current destination and the matching rendered section. Original handlers must still fire once.
2. With tools collapsed, confirm Import/New/Settings/Help are hidden from hit testing and keyboard focus. Expand the disclosure, invoke a tool, dismiss its modal, and confirm the current section and production remain intact.
3. After loading a two-scene script, assert the top of `#script-text` falls within the visible first screen and above the navigation bar. Assert `document.documentElement.scrollWidth <= innerWidth + 1` at 320 and 390 CSS pixels. Report tables may scroll within their own container.
4. Scroll to the last shot editor action and last scene field; assert their centers can be reached above the fixed bar. Verify long titles, many scene options, an empty project, dark mode, keyboard-open inputs and a short landscape viewport.
5. At tablet width, verify script and breakdown panels share a row when sufficient width exists; verify every panel has a positive visible width. Include portrait/landscape and a narrow multitasking window.
6. Create or edit a scene/shot, navigate repeatedly, collapse/reopen tools, background and reopen the app. Assert scene text, schedule membership, shot state and the inline element rename remain persisted. Preserve undo behavior within the running app.

Capture phone/tablet screenshots of the populated Breakdown, Schedule and Shots screens after the pass. Screenshot checks should supplement the geometry/workflow assertions. A native VoiceOver pass and larger text-size check remain necessary before distribution; DOM labels alone do not establish full assistive-technology support.

## Implemented pass and verification

The integrated `Web/mobile-layout.js` moves the original controls into the compact brand/project header, production-tools disclosure and five-destination bottom bar. It retains the original `data-view` buttons and their handlers, supplies full accessible names and current-page state, moves tagging below the phone screenplay, and adds Search script and Filters & timing disclosures. `Web/ios.css` gives the compact layout quieter surfaces and clearer Squid red accents while preserving the original mark and type stacks. The wide layout retains the script/breakdown split; medium tablet widths stack panels when the sidebar leaves insufficient room for two usable columns.

`RuntimeWorkflowTests.testMobileGeometryNavigationAndRetainedDisclosureHandlers` passed on the iPhone 18 Pro simulator on 2026-10-08, exercising real mounted WKWebView layouts at 320, 390 and 1194 CSS pixels. It verified five distinct targets of at least 44 by 44 pixels, one current destination, hidden and expanded utility controls, first-screen script visibility, bounded horizontal page width across all five destinations, retained search filtering, retained shot-status filtering and disclosure state through redraw/navigation, and usable wide split-panel geometry. The dependency-free web data suite still passes all 30 tests. This geometry check supplements the full simulator suite; it does not establish VoiceOver or larger-text conformance.

No Mobbin account was used or requested. These recommendations derive from the actual app, its preserved release assets and the public Apple sources linked above.
