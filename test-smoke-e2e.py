import json
import urllib.request
import urllib.error
import sys

BASE = "http://localhost:3038"

def req(path, method="GET", body=None, token=None):
    url = BASE + path
    data = None
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))

def p(label, val):
    print(f"  {label}: {val}")

print("=" * 60)
print("🔥 端到端冒烟测试")
print("=" * 60)

print("\n[1] 登录 admin/admin123")
code, d = req("/api/auth/login", "POST", {"username": "admin", "password": "admin123"})
assert code == 200, f"登录失败 code={code}"
token = d["token"]
p("token", token[:24] + "...")
p("用户", d["user"]["displayName"] + " (" + d["user"]["role"] + ")")

print("\n[2] /api/health/status 自检")
code, d = req("/api/health/status", token=token)
assert code == 200
h = d["health"]
p("整体状态", h["overallStatus"])
p("schemaVersion", f"v{h['schemaVersion']}/v{h['expectedVersion']}")
p("检查项数量", len(h["checks"]))
ok = sum(1 for c in h["checks"] if c["status"] == "ok")
warn = sum(1 for c in h["checks"] if c["status"] == "warning")
err = sum(1 for c in h["checks"] if c["status"] == "error")
print(f"    OK={ok}  WARN={warn}  ERR={err}")

print("\n[3] /api/items 模型列表")
code, d = req("/api/items", token=token)
assert code == 200, f"code={code}"
items = d["items"]
p("模型总数", len(items))
first = items[0] if items else None
if first:
    p("第1个 code", first.get("code", "?"))
    p("第1个 id 存在", "YES" if first.get("id") else "NO (异常)")
    p("第1个 createdAt 存在", "YES" if first.get("createdAt") else "NO (异常)")
    p("第1个 tasks 数", len(first.get("tasks", [])))
    p("第1个 logCount", first.get("logCount", "?"))
    p("第1个 auditRefs", type(first.get("auditRefs")).__name__)
p("allOwners 数量", len(d.get("allOwners", [])))
p("stats", str(d.get("stats", {})))

print("\n[4] /api/tasks 任务列表")
code, tasks = req("/api/tasks", token=token)
assert code == 200
p("任务总数", len(tasks))
if tasks:
    t0 = tasks[0]
    p("第1个 position", t0.get("position", "?"))
    p("第1个 modelRef 存在", "YES" if t0.get("modelRef") else "NO")
    p("第1个 modelCode 存在", "YES" if t0.get("modelCode") else "NO")
    p("第1个 status", t0.get("status", "?"))

print("\n[5] /api/items/<id> 详情页 timeline")
if first and first.get("id"):
    code, det = req("/api/items/" + urllib.parse.quote(first["id"]), token=token)
    assert code == 200
    p("timeline 条数", len(det.get("timeline", [])))
    p("timelineTypes", str(det.get("timelineTypes", [])))
    p("createdAt 存在", "YES" if det.get("createdAt") else "NO")
else:
    p("跳过（无数据）", "-")

print("\n[6] POST 创建新模型 + 验证")
new_body = {
    "code": "MR-SMOKE-" + str(int(__import__("time").time())),
    "shipType": "冒烟测试船",
    "scale": "1:100",
    "mastCount": 2,
    "riggingMaterial": "测试材料",
    "owner": "周宁",
    "dueDate": "2026-12-31",
    "status": "待检查"
}
code, created = req("/api/items", "POST", new_body, token)
assert code == 201, f"创建失败 code={code} err={created}"
new_id = created["id"]
p("已创建 id", new_id)
p("已创建 createdAt", "YES" if created.get("createdAt") else "NO")
p("已创建 auditRefs", type(created.get("auditRefs")).__name__)

code, d2 = req("/api/items", token=token)
p("创建后模型总数", len(d2["items"]))

print("\n[7] 给该模型新增帆索任务")
task_body = {"position": "冒烟测试索具", "tension": "偏松", "note": "冒烟测试任务"}
code, tr = req(f"/api/items/{urllib.parse.quote(new_id)}/tasks", "POST", task_body, token)
assert code == 201, f"code={code}"
task_id = tr["task"]["id"]
p("创建任务 id", task_id)
p("任务 modelRef", tr["task"].get("modelRef", "?"))
p("任务 logs 数", len(tr["task"].get("logs", [])))

print("\n[8] 修改任务状态 → 联动模型状态")
code, sr = req(f"/api/tasks/{urllib.parse.quote(task_id)}/status?itemId=" + urllib.parse.quote(new_id), "PATCH", {"status": "调整中"}, token)
assert code == 200, f"code={code} err={sr}"
p("任务状态变更后", sr["task"]["status"])
p("联动后模型状态", sr["item"]["status"])
assert sr["item"]["status"] == "校准中", f"模型应联动为校准中，实际为 {sr['item']['status']}"

print("\n[9] /api/migrations/state 迁移状态")
code, ms = req("/api/migrations/state", token=token)
assert code == 200
p("state.currentVersion", f"v{ms.get('currentVersion')}")
p("history 条数", len(ms.get("history", [])))
migs = [h for h in ms.get("history", []) if h.get("type") == "migration"]
if migs:
    last = migs[-1]
    p("最后一次迁移", f"v{last.get('fromVersion')}→v{last.get('toVersion')}")
    p("preSnapshotId", (last.get("preSnapshotId") or "?")[:24] + "..")
    p("postSnapshotId", (last.get("postSnapshotId") or "?")[:24] + "..")

print("\n[10] /api/snapshots 快照列表")
code, snaps = req("/api/snapshots", token=token)
assert code == 200
p("快照总数", len(snaps))
tags = {}
for s in snaps:
    t = s.get("tag") or "UNTAGGED"
    tags[t] = tags.get(t, 0) + 1
p("按标签统计", str(tags))
valid = sum(1 for s in snaps if s.get("checksumValid"))
p("校验通过数", f"{valid}/{len(snaps)}")

print("\n[11] POST 手动创建快照")
import time
snap_body = {"reason": "冒烟测试手动快照 " + time.strftime("%H:%M:%S"), "tag": "SMOKETEST"}
code, ns = req("/api/snapshots", "POST", snap_body, token)
assert code == 201, f"code={code}"
p("新快照id", ns.get("id", "?")[:32] + "..")
p("新快照modelCount", ns.get("modelCount", "?"))

print("\n[12] 验证新快照完整性")
code, vr = req("/api/snapshots/" + urllib.parse.quote(ns["id"]) + "/verify", token=token)
assert code == 200
p("校验结果", vr.get("valid"))

print("\n[13] /api/migrations/registered 迁移注册")
code, mr = req("/api/migrations/registered", token=token)
assert code == 200
p("目标版本", f"v{mr['current']}")
for m in mr["migrations"]:
    p(f"  · v{m['from']}→v{m['to']}", m.get("name", "?"))

print("\n[14] 第二次登录（普通用户 zhouning）→ 权限隔离")
code, d = req("/api/auth/login", "POST", {"username": "zhouning", "password": "zhou123"})
assert code == 200
zt = d["token"]
p("zhouning token", zt[:24] + "...")
code, zitems = req("/api/items?owner=" + urllib.parse.quote("周宁"), token=zt)
assert code == 200
p("zhouning 可见模型数", len(zitems["items"]))
for it in zitems["items"][:3]:
    p(f"  · {it.get('code')}", f"owner={it.get('owner')}")

print("\n" + "=" * 60)
print("✅ 全部端到端冒烟测试通过！")
print("=" * 60)
