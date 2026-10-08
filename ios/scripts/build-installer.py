#!/usr/bin/env python3
"""Build a local development IPA with existing signing assets only."""
import argparse
import datetime as dt
import hashlib
import importlib.util
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("desk_installer", HERE / "install-ios.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def eligible_profiles(options):
    identities = installer.run(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"]).decode()
    development = set(re.findall(r'([A-F0-9]{40}) "Apple Development:', identities))
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    roots = [Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles", Path.home() / "Library/MobileDevice/Provisioning Profiles"]
    candidates, seen = [], set()
    for root in roots:
        for path in root.glob("*.mobileprovision"):
            try:
                profile = installer.profile_at(path)
            except ValueError:
                continue
            if profile.get("UUID") in seen:
                continue
            seen.add(profile.get("UUID"))
            team = profile.get("TeamIdentifier", [None])[0]
            ent = profile.get("Entitlements", {})
            if not team or "iOS" not in profile.get("Platform", []) or not ent.get("get-task-allow") or not profile.get("ProvisionedDevices"):
                continue
            if ent.get("application-identifier") not in [team + ".*", team + "." + installer.BUNDLE] or profile["ExpirationDate"] <= now:
                continue
            matching = {hashlib.sha1(c).hexdigest().upper() for c in profile.get("DeveloperCertificates", [])} & development
            if options.profile and options.profile not in [profile["UUID"], profile.get("Name"), str(path)]:
                continue
            if options.team and options.team != team:
                continue
            if options.identity:
                matching &= {options.identity.upper()}
            for identity in sorted(matching):
                candidates.append((path, profile, team, identity))
    if not candidates:
        raise ValueError("No existing valid iOS development profile and matching installed Apple Development identity cover Production Desk. Choose an existing signing setup in Xcode; this tool never creates certificates or profiles.")
    candidates.sort(key=lambda p: p[1]["ExpirationDate"], reverse=True)
    return candidates[0]


def main():
    parser = argparse.ArgumentParser(description="Create a signed, registered-device Production Desk installer using existing local signing assets.")
    parser.add_argument("--output", type=Path, default=HERE.parent / "dist")
    parser.add_argument("--profile", help="Existing profile UUID, name or installed path")
    parser.add_argument("--identity", help="Installed Apple Development certificate SHA-1")
    parser.add_argument("--team", help="Existing development team ID")
    parser.add_argument("--derived-data", type=Path, default=Path(tempfile.gettempdir()) / "ProductionDeskSignedDerivedData")
    parser.add_argument("--check", action="store_true", help="Check existing signing eligibility without building")
    options = parser.parse_args()
    profile_path, profile, team, identity = eligible_profiles(options)
    print("Existing signing setup is eligible for Production Desk.")
    print("Development profile expires " + profile["ExpirationDate"].strftime("%Y-%m-%d") + ".")
    if options.check:
        return
    output = options.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    project = HERE.parent / "ProductionDesk.xcodeproj"
    if not project.exists():
        raise ValueError("Run the build script from the source repository.")
    with tempfile.TemporaryDirectory(prefix="ProductionDesk-signing-") as temp:
        temp = Path(temp)
        archive = temp / "ProductionDesk.xcarchive"
        log = output / "build.log"
        print("Building Production Desk…", flush=True)
        # Xcode rejects manually selecting an Xcode-managed wildcard profile.
        # Archive unsigned, then locally sign using the unchanged existing
        # profile and matching private-key identity. No portal calls occur.
        with log.open("wb") as stream:
            result = subprocess.run(["xcodebuild", "-project", str(project), "-scheme", "ProductionDesk", "-configuration", "Release", "-destination", "generic/platform=iOS", "-derivedDataPath", str(options.derived_data), "-archivePath", str(archive), "CODE_SIGNING_ALLOWED=NO", "archive"], stdout=stream, stderr=subprocess.STDOUT)
        if result.returncode:
            raise ValueError("The iOS archive build failed. See " + str(log))
        source = archive / "Products/Applications/ProductionDesk.app"
        payload = temp / "Payload"
        payload.mkdir()
        app = payload / "ProductionDesk.app"
        shutil.copytree(source, app)
        shutil.copyfile(profile_path, app / "embedded.mobileprovision")
        entitlements = dict(profile["Entitlements"])
        entitlements["application-identifier"] = team + "." + installer.BUNDLE
        entitlements["com.apple.developer.team-identifier"] = team
        entitlements["keychain-access-groups"] = [group.replace("*", installer.BUNDLE) for group in entitlements.get("keychain-access-groups", [team + ".*"])]
        ent_file = temp / "entitlements.plist"
        ent_file.write_bytes(plistlib.dumps(entitlements))
        frameworks = app / "Frameworks"
        if frameworks.exists():
            for nested in sorted(frameworks.iterdir()):
                if nested.suffix in [".framework", ".dylib"]:
                    installer.run(["/usr/bin/codesign", "--force", "--sign", identity, "--timestamp=none", str(nested)])
        print("Signing with the existing development identity…", flush=True)
        installer.run(["/usr/bin/codesign", "--force", "--sign", identity, "--timestamp=none", "--entitlements", str(ent_file), str(app)])
        ipa = output / "ProductionDesk.ipa"
        candidate = temp / "ProductionDesk.ipa"
        with zipfile.ZipFile(candidate, "w", zipfile.ZIP_DEFLATED) as package:
            for path in sorted(payload.rglob("*")):
                if path.is_file():
                    package.write(path, path.relative_to(temp))
        with tempfile.TemporaryDirectory(prefix="ProductionDesk-verify-") as verification:
            installer.validate_ipa(candidate, Path(verification))
        shutil.copyfile(candidate, ipa)
        for name in ["Install Production Desk.command", "install-ios.py"]:
            shutil.copyfile(HERE / name, output / name)
            (output / name).chmod(0o755)
        (output / "INSTALL.txt").write_text("Production Desk for iPhone / iPad\n\nConnect and unlock your registered iPhone or iPad, then double-click Install Production Desk.command on this Mac. Select your device explicitly. Enable Settings → Privacy & Security → Developer Mode if prompted. Keep the IPA and installer scripts together.\n\nThis development build works only on devices already registered in its existing profile, which expires " + profile["ExpirationDate"].strftime("%Y-%m-%d") + ". Back up your workspace before uninstalling.\n", encoding="utf-8")
        bundle = output / "ProductionDesk-iOS-Installer.zip"
        with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as package:
            for name in ["ProductionDesk.ipa", "Install Production Desk.command", "install-ios.py", "INSTALL.txt"]:
                package.write(output / name, name)
        print("Verified signed IPA: " + str(ipa))
        print("Installer package: " + str(bundle))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, plistlib.InvalidFileException) as error:
        print("\n" + str(error), file=sys.stderr)
        sys.exit(1)
