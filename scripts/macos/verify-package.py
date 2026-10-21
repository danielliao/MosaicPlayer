#!/usr/bin/env python3
"""Inspect an expanded distribution and compare it to the integration-tested payload."""
from pathlib import Path
import hashlib, json, subprocess, sys

root = Path(__file__).resolve().parents[2]
out = root / "output/releases/macos-server"
expanded = Path(sys.argv[1]).resolve()
tested = Path(sys.argv[2]).resolve()
relative = Path("component.pkg/Payload/Library/MosaicServer/versions/0.2.0-macos.1")
release, tested_release = expanded / relative, tested / relative
def sha(p):
    with p.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()

for folder in ["app", "runtime", "downloads"]:
    actual = {str(p.relative_to(release)):sha(p) for p in (release/folder).rglob("*") if p.is_file() and not p.is_symlink()}
    expected = {str(p.relative_to(tested_release)):sha(p) for p in (tested_release/folder).rglob("*") if p.is_file() and not p.is_symlink()}
    assert actual == expected, f"Final {folder} differs from tested payload"
for name in ["admin.mjs", "service.mjs"]:
    assert sha(release/"app/scripts/macos"/name) == sha(root/"scripts/macos"/name)
for name in ["preinstall", "postinstall"]:
    script = expanded/"component.pkg/Scripts"/name
    assert sha(script) == sha(root/"packaging/macos"/name)
    subprocess.run(["/bin/bash","-n",str(script)],check=True)
for p in release.rglob("*"):
    assert p.name not in ["commercial.env","admin-login.txt","database.json",".signing",".data"], str(p)
    assert not (p.is_symlink() and not p.resolve().is_relative_to(release)), str(p)
evidence = root/"output/macos-server-build/evidence"
evidence.mkdir(exist_ok=True)
for mode in ["app","postgres"]:
    result = subprocess.check_output([str(release/"runtime/node/bin/node"),str(release/"app/scripts/macos/admin.mjs"),"plist",mode])
    dest = evidence/f"system-{mode}.plist"
    dest.write_bytes(result)
    subprocess.run(["/usr/bin/plutil","-lint",str(dest)],check=True)
    assert ("_mosaicdb" if mode=="postgres" else "_mosaic").encode() in result
package = out/"MosaicServer-0.2.0-macos.1-AppleSilicon.pkg"
digest = sha(package)
assert digest == (out/"SHA256SUMS.txt").read_text().split()[0]
assert 'min="14.0"' in (expanded/"Distribution").read_text()
result = {
    "ok":True,"package":package.name,"bytes":package.stat().st_size,"sha256":digest,
    "runtimeMatchesIntegrationTestedPayload":True,"packageScriptsMatchSource":True,
    "applicationScriptsMatchSource":True,"noInstanceCredentialsOrCustomerData":True,
    "systemPlistsValid":True,"minimumOS":"14.0","architecture":"arm64",
    "developerIdSigned":False,"notarized":False
}
(out/"package-verification.json").write_text(json.dumps(result,indent=2)+"\n")
print(json.dumps(result,indent=2))
