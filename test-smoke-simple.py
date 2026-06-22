import json
import urllib.request
import urllib.error

BASE = "http://localhost:3038"

def req(path, method="GET", body=None):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf8")
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode("utf8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf8"))
        except:
            return e.code, {"error": str(e)}

def p(label, val):
    print(f"  {label}: {val}")

print("=" * 60)
print("🔥 简化版端到端冒烟测试（无认证）")
print("=" * 60)

print("\n[1] /api/health/status 自检")
code, d = req("/api/health/status")
assert code == 200, f"code={code}"
h = d["health"]
p("overallStatus", h.get("overallStatus"))
p("schemaVersion", f"v{h.get('schemaVersion')}/v{h.get('expectedVersion')}")
p("checks", f"OK={sum(1 for c in h['checks'] if c['status']=='ok')}/{len(h['checks'])}")
p("snapshots.count", len(d.get("snapshots", [])))
p("state.currentVersion", f"v{d.get('state', {}).get('currentVersion')}")

print("\n[2] GET / 主页 HTML")
url = urllib.request.Request(BASE + "/")
with urllib.request.urlopen(url) as resp:
    html = resp.read().decode("utf8")
    p("status", resp.status)
    p("contains 古船模型帆索校准", "YES" if "古船模型帆索校准" in html else "NO")
    p("contains tabHealth button", "YES" if "tabHealth" in html else "NO")
    p("contains 系统自检 page link", "YES" if "/health" in html else "NO")

print("\n[3] GET /health 自检页面 HTML")
url2 = urllib.request.Request(BASE + "/health")
with urllib.request.urlopen(url2) as resp:
    health_html = resp.read().decode("utf8")
    p("status", resp.status)
    p("contains schemaVersion", "YES" if "schemaVersion" in health_html or "Schema 版本" in health_html else "NO")
    p("contains 快照 Snapshot", "YES" if ("快照" in health_html or "Snapshot" in health_html) else "NO")
    p("contains 迁移 Migration", "YES" if ("迁移" in health_html or "Migration" in health_html) else "NO")

print("\n[4] GET /api/items 模型列表")
code, items = req("/api/items")
assert code == 200, f"code={code}"
assert isinstance(items, list), f"items is {type(items)}"
p("模型数", len(items))
if items:
    first = items[0]
    p("第1个 code", first.get("code", "?"))
    p("第1个 id", "YES" if first.get("id") else "NO")
    p("第1个 createdAt", "YES" if first.get("createdAt") else "NO")
    p("第1个 auditRefs", type(first.get("auditRefs", "MISSING")).__name__)
    p("第1个 logCount", first.get("logCount", "?"))

print("\n[5] GET /api/tasks 任务列表")
code, tasks = req("/api/tasks")
assert code == 200
p("任务数", len(tasks))
if tasks:
    t0 = tasks[0]
    p("第1个 position", t0.get("position", "?"))
    p("第1个 modelRef", "YES" if t0.get("modelRef") else "NO")
    p("第1个 modelCode", "YES" if t0.get("modelCode") else "NO")

print("\n[6] GET /api/tasks/filters")
code, f = req("/api/tasks/filters")
assert code == 200
p("owners 数", len(f.get("owners", [])))
p("tensions 数", len(f.get("tensions", [])))
p("models 数", len(f.get("models", [])))
p("statuses", f.get("statuses"))

print("\n[7] GET /api/items/calendar 日历（30天范围）")
import datetime
today = datetime.date.today()
start = (today - datetime.timedelta(days=30)).isoformat()
end = (today + datetime.timedelta(days=60)).isoformat()
code, cal = req(f"/api/items/calendar?start={start}&end={end}")
assert code == 200
p("范围内模型数", len(cal))

print("\n[8] POST 创建模型")
import time
ts = int(time.time())
body = {
    "code": f"MR-SMK-{ts}",
    "shipType": "冒烟沙船",
    "scale": "1:72",
    "mastCount": 2,
    "riggingMaterial": "棉线",
    "owner": "测试员",
    "dueDate": "2026-12-31",
    "status": "待检查"
}
code, created = req("/api/items", "POST", body)
assert code == 201, f"code={code} err={created}"
new_id = created["id"]
p("创建成功 id", new_id)
p("createdAt", "YES" if created.get("createdAt") else "NO")
p("tasks", len(created.get("tasks", [])))
p("auditRefs", type(created.get("auditRefs")).__name__)

print("\n[9] POST 追加帆索任务")
task_body = {"position": "主桅横桁侧支索", "tension": "标准", "note": "冒烟测试新增任务"}
code, result = req(f"/api/items/{urllib.parse.quote(new_id)}/action", "POST", task_body)
assert code == 201, f"code={code} err={result}"
p("返回的是模型?", "YES" if result.get("tasks") else "NO")
p("任务数变为", len(result.get("tasks", [])))
p("模型状态联动为", result.get("status"))

print("\n[10] PATCH 修改模型状态")
code, patched = req(f"/api/items/{urllib.parse.quote(new_id)}", "PATCH", {"status": "校准中"})
assert code == 200, f"code={code} err={patched}"
p("新状态", patched.get("status"))
p("logs 增加了?", len(patched.get("logs", [])) > 1)

print("\n[11] POST 追加备注日志")
code, logged = req(f"/api/items/{urllib.parse.quote(new_id)}/logs", "POST", {"step": "备注", "note": "冒烟测试备注"})
assert code == 201, f"code={code} err={logged}"
p("logs 数", len(logged.get("logs", [])))

print("\n[12] GET /api/stats 状态统计")
code, stats = req("/api/stats")
assert code == 200
p("统计", str(stats))

print("\n[13] GET /api/risk 风险评估")
code, risk = req("/api/risk")
assert code == 200, f"code={code}"
p("items 数", len(risk.get("items", [])))
p("summary keys", list(risk.get("summary", {}).keys()) if risk.get("summary") else "?")
p("highRisk 数", len(risk.get("highRiskList", [])))

print("\n[14] GET /api/risk/summary + /high + /meta")
code, s = req("/api/risk/summary"); assert code == 200; p("summary.levels", len(s.get("byLevel", {})))
code, h = req("/api/risk/high"); assert code == 200; p("highRisk count", len(h))
code, m = req("/api/risk/meta"); assert code == 200; p("meta levels", len(m.get("levels", [])))

print("\n[15] /api/migrations/state 迁移状态")
code, ms = req("/api/migrations/state")
assert code == 200
p("currentVersion", f"v{ms.get('currentVersion')}")
p("history", len(ms.get("history", [])))
if ms.get("history"):
    last = ms["history"][-1]
    p("last range", f"v{last.get('fromVersion')}→v{last.get('toVersion')}")

print("\n[16] /api/migrations/registered 已注册迁移")
code, mr = req("/api/migrations/registered")
assert code == 200, f"code={code} body={mr}"
p("目标版本", f"v{mr.get('current')}")
for m in mr.get("migrations", []):
    p(f"  迁移 v{m['from']}→v{m['to']}", m.get("name", "?"))

print("\n[17] /api/snapshots 快照列表")
code, snaps = req("/api/snapshots")
assert code == 200
p("总数", len(snaps))
tags = {}
for s in snaps:
    t = s.get("tag") or "UNTAGGED"
    tags[t] = tags.get(t, 0) + 1
p("按标签", str(tags))
valid = sum(1 for s in snaps if s.get("checksumValid"))
p("校验通过", f"{valid}/{len(snaps)}")

print("\n[18] POST /api/snapshots 创建新快照")
sb = {"reason": f"冒烟测试快照 {time.strftime('%H:%M:%S')}", "tag": "SMOKE_SIMPLE"}
code, ns = req("/api/snapshots", "POST", sb)
assert code == 201, f"code={code} err={ns}"
p("新快照 id", ns.get("id", "?")[:32] + "..")
p("模型数", ns.get("modelCount"))

print("\n[19] GET /api/health/raw 原始健康数据")
code, hr = req("/api/health/refresh")  # refresh 直接返回 runSystemHealthCheck 结果
assert code == 200
p("overallStatus", hr.get("overallStatus"))
p("checks 数量", len(hr.get("checks", [])))

print("\n" + "=" * 60)
print("✅ 简化版 19 项冒烟测试全部通过！")
print("=" * 60)
