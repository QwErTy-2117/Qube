import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assessPackageState,
  buildPackageInstallHint,
  familyFor,
  parseOsRelease,
  type PackageState,
} from "../lib/system/package-info";

const FEDORA = `NAME="Fedora Linux"
VERSION="44 (Forty Four)"
ID=fedora
ID_LIKE="rhel centos"
PRETTY_NAME="Fedora Linux 44 (Forty Four)"
VERSION_ID=44`;

const UBUNTU = `NAME="Ubuntu"
VERSION="24.04.1 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
PRETTY_NAME="Ubuntu 24.04.1 LTS"
VERSION_ID="24.04"`;

function state(overrides: Partial<Parameters<typeof assessPackageState>[0]> = {}): PackageState {
  return assessPackageState({
    platform: "linux",
    arch: "x64",
    osRelease: FEDORA,
    deb: null,
    rpm: { installed: true, version: "0.0.125-1" },
    dpkgOwnsBinary: false,
    rpmOwnsBinary: true,
    bundleType: "rpm",
    ...overrides,
  });
}

describe("updater: distro and package awareness", () => {
  it("parses Fedora and Ubuntu os-release files", () => {
    const fedora = parseOsRelease(FEDORA);
    assert.equal(fedora.id, "fedora");
    assert.equal(fedora.family, "rpm");
    assert.deepEqual(fedora.like, ["rhel", "centos"]);
    assert.equal(fedora.name, "Fedora Linux 44 (Forty Four)");

    const ubuntu = parseOsRelease(UBUNTU);
    assert.equal(ubuntu.family, "debian");
    assert.deepEqual(ubuntu.like, ["debian"]);
  });

  it("classifies unknown distros as other", () => {
    assert.equal(familyFor("arch"), "other");
    assert.equal(familyFor("weird", ["something"]), "other");
    assert.equal(parseOsRelease("").family, "other");
  });

  it("detects the user's mixed .deb + .rpm state on Fedora", () => {
    const s = state({
      deb: { installed: true, version: "0.0.125", status: "install ok unpacked" },
      dpkgOwnsBinary: true,
      bundleType: "deb",
    });
    assert.equal(s.mixed, true);
    assert.equal(s.mismatch, true);
    assert.equal(s.recommended, "rpm");
    assert.equal(s.binaryOwner, "both");
    assert.equal(s.bundleType, "deb");
  });

  it("detects a .deb-only install on Fedora as a mismatch", () => {
    const s = state({ deb: { installed: true, version: "0.0.125" }, rpm: null, dpkgOwnsBinary: true, rpmOwnsBinary: false, bundleType: "deb" });
    assert.equal(s.mismatch, true);
    assert.equal(s.mixed, false);
    assert.equal(s.recommended, "rpm");
  });

  it("does not flag a matching install", () => {
    const s = state();
    assert.equal(s.mismatch, false);
    assert.equal(s.mixed, false);
  });

  it("detects an .rpm-only install on Ubuntu as a mismatch", () => {
    const s = state({
      osRelease: UBUNTU,
      deb: null,
      rpm: { installed: true, version: "0.0.125-1" },
      dpkgOwnsBinary: false,
      rpmOwnsBinary: true,
      bundleType: "rpm",
    });
    assert.equal(s.mismatch, true);
    assert.equal(s.recommended, "deb");
  });

  it("tells a Fedora user with a .deb to purge it and install the RPM once", () => {
    const s = state({
      deb: { installed: true, version: "0.0.125", status: "install ok unpacked" },
      dpkgOwnsBinary: true,
      bundleType: "deb",
    });
    const hint = buildPackageInstallHint("Failed to install package", s);
    assert.match(hint, /Debian package on Fedora Linux 44/);
    assert.match(hint, /sudo dpkg --purge --force-all qube/);
    assert.match(hint, /sudo dnf install/);
    assert.match(hint, /Qube-<version>-1\.x86_64\.rpm/);
    assert.doesNotMatch(hint, /apt install/);
  });

  it("uses aarch64 filenames on ARM and zypper on openSUSE", () => {
    const arm = state({
      arch: "arm64",
      deb: { installed: true, version: "0.0.125", status: "install ok unpacked" },
      dpkgOwnsBinary: true,
      bundleType: "deb",
    });
    assert.match(buildPackageInstallHint("Failed to install package", arm), /Qube-<version>-1\.aarch64\.rpm/);

    const suse = state({
      osRelease: 'ID=opensuse-leap\nID_LIKE="suse opensuse"\nPRETTY_NAME="openSUSE Leap 16"',
      deb: { installed: true, version: "0.0.125", status: "install ok unpacked" },
      dpkgOwnsBinary: true,
      bundleType: "deb",
    });
    const hint = buildPackageInstallHint("Failed to install package", suse);
    assert.match(hint, /sudo zypper install/);
    assert.match(hint, /Qube-<version>-1\.x86_64\.rpm/);
    assert.doesNotMatch(hint, /dnf install/);
  });

  it("stops blocking once the RPM binary is running, even with a stale dpkg entry", () => {
    // The user installed the RPM over the .deb. dpkg still lists the old
    // files, but the running binary is now RPM-patched, so the updater works.
    const s = state({
      deb: { installed: true, version: "0.0.125", status: "install ok unpacked" },
      dpkgOwnsBinary: true,
      bundleType: "rpm",
    });
    assert.equal(s.mismatch, false);
    assert.equal(s.mixed, true);
    const hint = buildPackageInstallHint("Failed to install package", s);
    assert.match(hint, /sudo dnf install/);
    assert.doesNotMatch(hint, /Debian package on Fedora/);
  });

  it("tells an Ubuntu user with an .rpm to purge it and install the .deb once", () => {
    const s = state({
      osRelease: UBUNTU,
      rpm: { installed: true, version: "0.0.125-1" },
      dpkgOwnsBinary: false,
      rpmOwnsBinary: true,
      bundleType: "rpm",
    });
    const hint = buildPackageInstallHint("Failed to install package", s);
    assert.match(hint, /sudo rpm -e qube/);
    assert.match(hint, /sudo apt install/);
    assert.match(hint, /Qube_<version>_amd64\.deb/);
    assert.doesNotMatch(hint, /dnf install/);
  });

  it("uses the native command for a matching install and leaves web errors alone", () => {
    const hint = buildPackageInstallHint("Failed to install package", state());
    assert.match(hint, /sudo dnf install/);
    assert.doesNotMatch(hint, /apt install/);
    assert.equal(buildPackageInstallHint("plain error", null), "plain error");
    assert.equal(buildPackageInstallHint("plain error", { ...state(), platform: "win32" }), "plain error");
  });
});
