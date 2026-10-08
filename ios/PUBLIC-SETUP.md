# Production Desk · source setup

This download contains the iOS source and setup launcher. It contains no signed app, provisioning profiles, certificates or private keys.

On a Mac with Xcode and an existing compatible **Apple Development** signing setup, open **ios/scripts/Prepare Production Desk.command**. It builds a signed app locally, then asks you to select a registered iPhone or iPad. Connect and unlock that device first. Trust this Mac and enable Developer Mode if prompted.

For a check without building or installing:

```sh
"ios/scripts/Prepare Production Desk.command" --check
```

To build and verify locally without installing:

```sh
"ios/scripts/Prepare Production Desk.command" --prepare
```

Generated installers stay in `ios/dist/` and use your existing local signing assets. The launcher never creates signing assets or uploads an app. Without a compatible profile and matching signing identity, use `ProductionDesk.xcodeproj` in a simulator; device setup requires your own signing configuration.

The launcher is an unsigned Mac script. macOS may ask you to confirm opening it. This source setup is not a notarized Mac installer or an App Store/TestFlight download.
