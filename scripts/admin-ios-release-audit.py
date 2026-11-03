"""Build-55 guard; stdlib only; writes no credentials or profile contents.

Adopt in scripts/ beside admin-ios-release-source.json. Run from repository root.
source: immutable task source guard; native: prepare/validate generated native
settings; ipa: verify actual exported iOS app, signing and bundled audio on macOS.
"""
import base64
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import uuid
import wave

ROOT = Path.cwd()
APP = ROOT / "apps/admin"
REPORTS = ROOT / "build/reports"
VERSION = "1.0.1"
BUILD = "55"
BUNDLE = "co.uk.speedy-van.admin"
TEAM = "BXK52CMHR2"
PROJECT = "0dd0709d-309d-455c-8ad8-eeeb4550adca"
UPDATES_URL = f"https://u.expo.dev/{PROJECT}"
API_URL = "https://www.speedyvan.uk"
OWNER_SOUND_SHA256 = "09c0374f169a701059ede07b2054de9628cc7cfbcfb60666fd86d40f77e67998"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def report(name, data):
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / name).write_text(json.dumps(data, indent=2) + "\n")
    print(f"PASS: {name}")


def source():
    expected = json.loads(Path(__file__).with_name("admin-ios-release-source.json").read_text())
    for entry in expected:
        require(digest((ROOT / entry["path"]).read_bytes()) == entry["sha256"],
                f"Frozen source changed: {entry['path']}")
    report("admin-source-audit.json", {"passed": True, "files": expected})


def sounds(read_sound):
    results = []
    for name in ["new-job.wav", "chat-message.wav", "job-offer.wav"]:
        data = read_sound(name)
        source_data = (APP / "assets/sounds" / name).read_bytes()
        require(data == source_data, f"Native sound differs from source: {name}")
        if name != "job-offer.wav":
            require(digest(data) == OWNER_SOUND_SHA256, f"Owner sound mismatch: {name}")
        with wave.open(io.BytesIO(data), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
            require(audio.getcomptype() == "NONE" and audio.getsampwidth() == 2,
                    f"Sound must be 16-bit PCM: {name}")
            require(0 < duration < 30, f"Sound duration invalid for Apple: {name}")
            results.append({"name": name, "sha256": digest(data), "durationSeconds": duration})
    return results


def check_updates(config):
    require(config.get("EXUpdatesEnabled") is True, "Updates disabled")
    require(config.get("EXUpdatesURL") == UPDATES_URL, "Wrong Expo Updates project")
    require(config.get("EXUpdatesRuntimeVersion") == VERSION, "Wrong native runtime version")
    require(config.get("EXUpdatesRequestHeaders", {}).get("expo-channel-name") == "production",
            "Missing production update channel")
    require(not config.get("EXUpdatesDisableAntiBrickingMeasures"), "Update recovery disabled")


def check_entitlements(entitlements):
    require(entitlements.get("aps-environment") == "production", "Production APNs missing")
    require(entitlements.get("com.apple.developer.usernotifications.time-sensitive") is True,
            "Time-sensitive notification entitlement missing")


def native():
    cfg = json.loads((REPORTS / "admin-public-config.json").read_text())
    require(cfg.get("version") == VERSION and cfg.get("ios", {}).get("buildNumber") == BUILD,
            "Wrong source version/build")
    require(cfg.get("ios", {}).get("bundleIdentifier") == BUNDLE, "Wrong source bundle")
    require(cfg.get("extra", {}).get("apiBaseUrl") == API_URL, "Wrong release API")
    require(cfg.get("extra", {}).get("eas", {}).get("projectId") == PROJECT, "Wrong source project")
    ios = APP / "ios"
    require((ios / "SVAdmin.xcodeproj/project.pbxproj").is_file(), "Wrong generated project")
    expo_plist = ios / "SVAdmin/Supporting/Expo.plist"
    updates = plistlib.loads(expo_plist.read_bytes())
    # EAS Build injects this automatically. Codemagic must set it explicitly.
    updates["EXUpdatesRequestHeaders"] = {
        **updates.get("EXUpdatesRequestHeaders", {}), "expo-channel-name": "production"
    }
    check_updates(updates)
    expo_plist.write_bytes(plistlib.dumps(updates))
    entitlements_path = ios / "SVAdmin/SVAdmin.entitlements"
    entitlements = plistlib.loads(entitlements_path.read_bytes())
    entitlements["aps-environment"] = "production"
    check_entitlements(entitlements)
    entitlements_path.write_bytes(plistlib.dumps(entitlements))
    pod_properties = json.loads((ios / "Podfile.properties.json").read_text())
    require(pod_properties.get("expo.jsEngine") == "hermes", "Hermes must remain enabled")
    sound_results = sounds(lambda name: (ios / "SVAdmin" / name).read_bytes())
    report("admin-native-audit.json", {"passed": True, "runtime": VERSION, "build": BUILD,
           "channel": "production", "sounds": sound_results})


def command_plist(args):
    result = subprocess.run(args, check=True, capture_output=True)
    # codesign emits an informational line separately from its XML entitlement data.
    for output in [result.stdout, result.stderr]:
        start = output.find(b"<?xml")
        end = output.find(b"</plist>", start)
        if start >= 0 and end >= 0:
            return plistlib.loads(output[start:end + len(b"</plist>")])
    raise RuntimeError(f"No plist returned by {args[0]}")


def signing():
    # Never print credentials or pass the certificate password in argv.
    require(sys.platform == "darwin", "Signing installation requires macOS")
    for name in ["CM_CERTIFICATE", "CM_CERTIFICATE_PASSWORD", "CM_PROVISIONING_PROFILE"]:
        require(name in os.environ, f"Missing secure signing environment variable: {name}")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="admin-signing-") as temp:
        certificate = Path(temp) / "distribution.p12"
        profile_path = Path(temp) / "app.mobileprovision"
        certificate.write_bytes(base64.b64decode(os.environ["CM_CERTIFICATE"], validate=True))
        profile_path.write_bytes(base64.b64decode(os.environ["CM_PROVISIONING_PROFILE"], validate=True))
        require(certificate.stat().st_size > 0, "Empty distribution certificate")
        profile = command_plist(["security", "cms", "-D", "-i", str(profile_path)])
        require(TEAM in profile.get("TeamIdentifier", []), "Signing profile team mismatch")
        require(profile["Entitlements"].get("application-identifier") == f"{TEAM}.{BUNDLE}",
                "Signing profile bundle mismatch")
        require(not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices"),
                "Signing profile must use App Store distribution")
        require(profile["ExpirationDate"].replace(tzinfo=datetime.timezone.utc) >
                datetime.datetime.now(datetime.timezone.utc), "Signing profile expired")
        check_entitlements(profile["Entitlements"])
        profile_id = str(uuid.UUID(profile["UUID"]))
        profile_dir = Path.home() / "Library/MobileDevice/Provisioning Profiles"
        profile_dir.mkdir(parents=True, exist_ok=True)
        (profile_dir / f"{profile_id}.mobileprovision").write_bytes(profile_path.read_bytes())
        subprocess.run(["keychain", "initialize"], check=True, capture_output=True)
        subprocess.run(["keychain", "add-certificates", "--certificate", str(certificate),
                        "--certificate-password", "@env:CM_CERTIFICATE_PASSWORD"],
                       check=True, capture_output=True)
    print("PASS: existing App Store signing credentials installed")


def ipa():
    paths = list((ROOT / "build/ios/ipa").glob("*.ipa"))
    require(len(paths) == 1, "Expected exactly one exported IPA")
    ipa_path = paths[0]
    with tempfile.TemporaryDirectory(prefix="admin-ipa-audit-") as temp:
        # ditto preserves symlinks and framework layout for codesign verification.
        subprocess.run(["ditto", "-x", "-k", str(ipa_path), temp], check=True, capture_output=True)
        app_paths = list((Path(temp) / "Payload").glob("*.app"))
        require(len(app_paths) == 1, "Expected one app in IPA")
        app = app_paths[0]
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)],
                       check=True, capture_output=True)
        info = plistlib.loads((app / "Info.plist").read_bytes())
        require(info.get("CFBundleIdentifier") == BUNDLE, "Signed bundle mismatch")
        require(info.get("CFBundleVersion") == BUILD, "Signed build mismatch")
        require(info.get("CFBundleShortVersionString") == VERSION, "Signed version mismatch")
        signed = command_plist(["codesign", "--display", "--entitlements", ":-", str(app)])
        check_entitlements(signed)
        require(signed.get("application-identifier") == f"{TEAM}.{BUNDLE}", "Signed app ID mismatch")
        require(signed.get("com.apple.developer.team-identifier") == TEAM, "Signed team mismatch")
        require(signed.get("get-task-allow") is False, "Debug signing enabled")
        profile = command_plist(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")])
        require(TEAM in profile.get("TeamIdentifier", []), "Profile team mismatch")
        require(not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices"),
                "Profile must be App Store distribution")
        require(profile["ExpirationDate"].replace(tzinfo=datetime.timezone.utc) >
                datetime.datetime.now(datetime.timezone.utc), "Profile expired")
        check_entitlements(profile["Entitlements"])
        require(profile["Entitlements"].get("application-identifier") == f"{TEAM}.{BUNDLE}",
                "Profile app mismatch")
        check_updates(plistlib.loads((app / "Expo.plist").read_bytes()))
        constants = json.loads((app / "EXConstants.bundle/app.config").read_text())
        require(constants.get("extra", {}).get("apiBaseUrl") == API_URL, "Signed API mismatch")
        require(constants.get("extra", {}).get("eas", {}).get("projectId") == PROJECT,
                "Signed Expo project mismatch")
        sound_results = sounds(lambda name: (app / name).read_bytes())
        js = (app / "main.jsbundle").read_bytes()
        require(js[:8].hex() == "c61fbc03c103191f", "Embedded bundle is not Hermes bytecode")
        report("admin-ipa-audit.json", {"passed": True, "ipa": ipa_path.name,
               "ipaSha256": digest(ipa_path.read_bytes()), "bundle": BUNDLE, "version": VERSION,
               "build": BUILD, "runtime": VERSION, "channel": "production", "team": TEAM,
               "productionPush": True, "timeSensitive": True, "signatureVerified": True,
               "hermesBundleSha256": digest(js), "sounds": sound_results})


if __name__ == "__main__":
    require(len(sys.argv) == 2 and sys.argv[1] in {"source", "native", "signing", "ipa"},
            "Usage: admin-ios-release-audit.py source|native|signing|ipa")
    globals()[sys.argv[1]]()
