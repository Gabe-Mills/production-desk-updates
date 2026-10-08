# Install on your iPhone or iPad

Unzip the local installer package. Connect and unlock your registered device, then double-click **Install Production Desk.command** on this Mac. Choose the device number. Keep the IPA and the two installer scripts together.

If prompted, trust this Mac and enable **Settings → Privacy & Security → Developer Mode**. Installation preserves the app’s existing workspace; export a full backup before uninstalling.

This is a signed development build for devices already registered in the existing profile. It requires a Mac with Xcode and expires with that profile. No App Store or TestFlight upload is involved.

## Check without installing

```sh
python3 ios/scripts/install-ios.py --ipa /path/to/ProductionDesk.ipa --check
```

For an explicit device, add `--device DEVICE_ID` from `xcrun devicectl list devices`. The installer verifies the app signature, certificate, profile expiry and device registration before installation. A disconnected phone must be connected and unlocked first.

## Rebuild the installer

```sh
ios/scripts/build-installer.sh --check
ios/scripts/build-installer.sh --output /tmp/ProductionDeskInstaller
```

The build uses an existing valid Apple Development identity and matching profile. Optional `--profile`, `--identity` and `--team` flags select existing assets. It archives in Release, signs locally and verifies the IPA. It never creates signing assets or requests provisioning updates. Keep generated IPAs and signing metadata out of Git.
