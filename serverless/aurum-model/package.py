"""Package AURUM with the text adapters and shared vault client from a deployed Jianwei worker zip."""
import json
import re
import sys
import zipfile
from pathlib import Path

directory = Path(__file__).resolve().parent
site = directory.parents[1]
worker, output = sys.argv[1:]
catalog = json.loads((directory / "official-models.json").read_text())
roots = ["store.cjs", "codex-accounts.cjs", "model-control.cjs", "model-completion.cjs", "kimi.cjs"]
excluded = {"openai-siwc.cjs", "model-vision.cjs"}

with zipfile.ZipFile(worker) as source, zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
    providers = json.loads(source.read("providers.json"))
    profiles = json.loads(source.read("model-profiles.json"))
    official = providers["openai-codex"]
    profile_map = profiles["providers"]["openai-codex"]
    official["catalog"] = list(dict.fromkeys([model["id"] for model in catalog] + official["catalog"]))
    for model in catalog:
        name, efforts, identifier = model["name"], model["efforts"], model["id"]
        template = profile_map.get(identifier, profile_map["gpt-6.1-sol"])
        profile_map[identifier] = {
            **template,
            "name": name,
            "efforts": {effort: effort for effort in efforts},
            "note": "可用性按所选账号权限与额度为准。"
        }

    adjusted = {"providers.json": providers, "model-profiles.json": profiles}
    written = set()
    while roots:
        name = roots.pop()
        if name in written or name in excluded:
            continue
        data = source.read(name)
        if name.endswith(".cjs"):
            roots.extend(dep.decode() for dep in re.findall(rb"""require\(['"]\./([\w.-]+)['"]\)""", data))
        target.writestr(name, json.dumps(adjusted[name], ensure_ascii=False) if name in adjusted else data)
        written.add(name)
    for name in ("server.cjs", "scf_bootstrap"):
        target.write(directory / name, name)
    target.write(site / "scripts/research-prompt.mjs", "research-prompt.mjs")
