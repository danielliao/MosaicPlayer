#!/usr/bin/env python3
"""Relocate Mach-O dependencies and reject accidental workstation dependencies."""
import pathlib, subprocess, sys, os, json, re

root = pathlib.Path(sys.argv[1]).resolve()
original = pathlib.Path(sys.argv[2]).resolve()
files = []
for p in root.rglob("*"):
    if p.is_file() and not p.is_symlink():
        if "Mach-O" in subprocess.check_output(["file", "-b", str(p)], text=True):
            files.append(p)

for p in files:
    lines = subprocess.check_output(["otool", "-L", str(p)], text=True).splitlines()[1:]
    for line in lines:
        old = line.strip().split(" (")[0]
        if old.startswith(str(original)+"/"):
            target = root / pathlib.Path(old).relative_to(original)
            new = "@loader_path/" + os.path.relpath(target, p.parent)
            subprocess.run(["install_name_tool", "-change", old, new, str(p)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # A dylib's LC_ID is not a dependency, but remove the build-machine path as well.
    ids = subprocess.check_output(["otool", "-D", str(p)], text=True).splitlines()
    if len(ids) > 1 and ids[1].startswith("/"):
        subprocess.run(["install_name_tool", "-id", "@rpath/"+p.name, str(p)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["codesign", "--force", "--sign", "-", str(p)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

errors, evidence = [], []
for p in files:
    deps = [l.strip().split(" (")[0] for l in subprocess.check_output(["otool","-L",str(p)],text=True).splitlines()[1:] if l.startswith("\t")]
    ids = subprocess.check_output(["otool","-D",str(p)],text=True).splitlines()[1:]
    for dep in deps:
        if dep in ids:
            continue
        if dep.startswith("/") and not dep.startswith(("/usr/lib/","/System/Library/")):
            errors.append(f"{p}: external dependency {dep}")
        elif dep.startswith("@loader_path/") and not (p.parent / dep.removeprefix("@loader_path/")).exists():
            errors.append(f"{p}: missing {dep}")
        elif dep.startswith("@rpath/") and not list(root.rglob(pathlib.Path(dep).name)):
            errors.append(f"{p}: unresolved {dep}")
    commands=subprocess.check_output(["otool","-l",str(p)],text=True)
    minimums=re.findall(r"\bminos (\d+\.\d+)",commands)
    if any(tuple(map(int,v.split("."))) > (14,0) for v in minimums):
        errors.append(f"{p}: requires macOS {minimums}")
    subprocess.run(["codesign","--verify",str(p)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    evidence.append({"path":str(p.relative_to(root)),"dependencies":deps,"minimumOS":minimums})
if errors:
    raise SystemExit("\n".join(errors))
print(json.dumps({"ok": True,"binaries":evidence},indent=2))
