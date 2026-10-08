#!/usr/bin/env python3
"""Validate and install an existing development IPA. Never manages signing assets."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

BUNDLE = "local.slate.filmscheduler"


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=False, **kwargs)
    if result.returncode:
        detail = (result.stderr or result.stdout).decode(errors="replace").strip()
        raise ValueError(detail or "The command could not finish.")
    return result.stdout


def profile_at(path):
    return plistlib.loads(run(["/usr/bin/security", "cms", "-D", "-i", str(path)]))


def validate_ipa(ipa, directory):
    if not ipa.is_file():
        raise ValueError("ProductionDesk.ipa was not found. Keep the IPA beside this installer, or pass --ipa /path/to/ProductionDesk.ipa.")
    try:
        with zipfile.ZipFile(ipa) as archive:
            if sum(info.file_size for info in archive.infolist()) > 512 * 1024 * 1024:
                raise ValueError("The installer is unexpectedly large.")
            for info in archive.infolist():
                destination = (directory / info.filename).resolve()
                if not destination.is_relative_to(directory.resolve()) or stat.S_ISLNK(info.external_attr >> 16):
                    raise ValueError("The IPA contains an unsafe path.")
            archive.extractall(directory)
            # ZipFile does not preserve executable bits needed by devicectl.
            for info in archive.infolist():
                if not info.is_dir():
                    mode = (info.external_attr >> 16) & 0o777
                    if mode:
                        (directory / info.filename).chmod(mode)
    except zipfile.BadZipFile:
        raise ValueError("This file is not an iOS IPA archive.") from None
    apps = list((directory / "Payload").glob("*.app"))
    if len(apps) != 1:
        raise ValueError("The IPA must contain one application.")
    app = apps[0]
    info = plistlib.loads((app / "Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != BUNDLE or "iPhoneOS" not in info.get("CFBundleSupportedPlatforms", []):
        raise ValueError("Choose the signed Production Desk iPhone/iPad installer.")
    embedded = app / "embedded.mobileprovision"
    if not embedded.is_file():
        raise ValueError("This app is unsigned. Build the development installer before installing on a phone.")
    profile = profile_at(embedded)
    if profile["ExpirationDate"] <= dt.datetime.now(dt.timezone.utc).replace(tzinfo=None):
        raise ValueError("This installer’s development profile has expired. Rebuild using a valid existing profile.")
    entitlements = profile.get("Entitlements", {})
    team = profile.get("TeamIdentifier", [None])[0]
    allowed = entitlements.get("application-identifier", "")
    if not team or allowed not in [team + ".*", team + "." + BUNDLE] or not entitlements.get("get-task-allow"):
        raise ValueError("This installer needs a matching development profile for Production Desk.")
    run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)])
    actual = plistlib.loads(run(["/usr/bin/codesign", "-d", "--entitlements", ":-", str(app)]))
    if actual.get("application-identifier") != team + "." + BUNDLE or actual.get("com.apple.developer.team-identifier") != team:
        raise ValueError("The app signature does not match its provisioning profile.")
    cert_prefix = directory / "signing-certificate-"
    run(["/usr/bin/codesign", "-d", "--extract-certificates=" + str(cert_prefix), str(app)])
    leaf = Path(str(cert_prefix) + "0")
    if not leaf.is_file() or hashlib.sha1(leaf.read_bytes()).digest() not in [hashlib.sha1(c).digest() for c in profile.get("DeveloperCertificates", [])]:
        raise ValueError("The app’s signing certificate is not authorized by its profile.")
    run(["/usr/bin/openssl", "x509", "-inform", "DER", "-in", str(leaf), "-checkend", "0", "-noout"])
    return app, profile


def devices(directory):
    output = directory / "devices.json"
    run(["xcrun", "devicectl", "list", "devices", "--json-output", str(output)])
    return [d for d in json.loads(output.read_text())["result"]["devices"]
            if d.get("hardwareProperties", {}).get("reality") == "physical"
            and d.get("hardwareProperties", {}).get("deviceType") in ["iPhone", "iPad"]]


def device_id(device):
    return device["hardwareProperties"].get("udid", device["identifier"])


def connected(device):
    return device.get("connectionProperties", {}).get("tunnelState") == "connected"


def main():
    parser = argparse.ArgumentParser(description="Install Production Desk on an explicitly selected registered iPhone/iPad.")
    parser.add_argument("--ipa", type=Path)
    parser.add_argument("--device", help="A registered device UDID or devicectl identifier")
    parser.add_argument("--check", action="store_true", help="Verify installer and device readiness without installing")
    options = parser.parse_args()
    here = Path(__file__).resolve().parent
    ipa = options.ipa or next((p for p in [here / "ProductionDesk.ipa", here.parent / "dist/ProductionDesk.ipa"] if p.exists()), here / "ProductionDesk.ipa")
    if sys.platform != "darwin" or not shutil.which("xcrun"):
        raise ValueError("Use this installer on a Mac with Xcode installed.")
    with tempfile.TemporaryDirectory(prefix="ProductionDesk-install-") as temp:
        directory = Path(temp)
        app, profile = validate_ipa(ipa, directory)
        print("Production Desk installer verified.")
        print("Development profile expires " + profile["ExpirationDate"].strftime("%Y-%m-%d") + ".")
        eligible = [d for d in devices(directory) if device_id(d) in profile.get("ProvisionedDevices", [])]
        if options.device:
            selection = next((d for d in eligible if options.device in [device_id(d), d["identifier"]]), None)
            if not selection:
                raise ValueError("The selected iPhone/iPad is not paired or is not registered in this installer’s existing profile.")
        elif options.check:
            reachable = [d for d in eligible if connected(d)]
            print(f"{len(reachable)} registered iPhone/iPad device(s) connected.")
            if not reachable:
                print("Connect and unlock your registered phone with USB, then select Trust when prompted.")
            return
        else:
            if not eligible:
                raise ValueError("No registered iPhone/iPad was found. Connect and unlock your phone, trust this Mac, and try again.")
            print("\nChoose the device to install on:")
            for index, device in enumerate(eligible, 1):
                state = "connected" if connected(device) else "connect and unlock first"
                print(f"  {index}. {device['deviceProperties'].get('name', 'iPhone/iPad')} — {state}")
            if not sys.stdin.isatty():
                raise ValueError("Select a device explicitly with --device. Automatic installation is disabled.")
            choice = input("Device number (Enter to cancel): ").strip()
            if not choice:
                print("Installation cancelled."); return
            if not choice.isdigit() or not 1 <= int(choice) <= len(eligible):
                raise ValueError("Choose one of the listed device numbers.")
            selection = eligible[int(choice) - 1]
        if not connected(selection):
            raise ValueError("Your selected phone is disconnected. Connect it with USB, unlock it, trust this Mac, then try again. Enable Settings → Privacy & Security → Developer Mode if asked.")
        if options.check:
            print("Selected device is registered and connected. Nothing was installed."); return
        print("Installing Production Desk…")
        try:
            run(["xcrun", "devicectl", "device", "install", "app", "--device", selection["identifier"], str(app)])
        except ValueError as error:
            raise ValueError("Installation could not finish. Keep your phone unlocked and enable Settings → Privacy & Security → Developer Mode.\n" + str(error)) from None
        print("Installed. Opening Production Desk…")
        try:
            run(["xcrun", "devicectl", "device", "process", "launch", "--device", selection["identifier"], BUNDLE])
        except ValueError as error:
            raise ValueError("The app installed but could not open. Enable Developer Mode, trust the developer in Settings → General → VPN & Device Management if shown, then open Production Desk on your phone.\n" + str(error)) from None
        print("Production Desk is ready on your device.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, plistlib.InvalidFileException) as error:
        print("\n" + str(error), file=sys.stderr)
        sys.exit(1)
