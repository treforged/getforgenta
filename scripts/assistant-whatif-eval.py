# What-if tool-call smoke eval for the in-app assistant plan (docs/assistant-plan.md).
# SYNTHETIC plan only - never put real user data here. Talks to a local Ollama on :11434.
# Usage: python scripts/assistant-whatif-eval.py <model> [think]
# qwen3:14b needs "think" on this runtime; with thinking off it returns empty replies.
import json, sys, time, urllib.request
MODEL = sys.argv[1]
PLAN = """Synthetic user plan (all amounts monthly unless stated):
- Rules: Rent $1,800 (expense, day 1); Paycheck $950 weekly (income); Gym $45 (expense);
  Streaming $18 (expense); Car insurance $160 (expense); Business transfer $120 (transfer to Business Checking).
- Goals: Vacation fund $300/mo; Emergency fund $200/mo; 401k $250/mo (retirement, payroll deduction).
Today is 2026-09-29."""
TOOL = {"type": "function", "function": {
  "name": "run_forecast",
  "description": "Re-run the user's cash forecast with hypothetical changes applied in memory. Writes nothing.",
  "parameters": {"type": "object", "required": ["changes"], "properties": {"changes": {"type": "array", "items": {
    "type": "object", "required": ["action", "target"],
    "properties": {
      "action": {"type": "string", "enum": ["end_rule", "change_amount", "add_rule", "pause_goal", "add_one_time"]},
      "target": {"type": "string", "description": "Exact rule or goal name from the plan, or a new name for add_rule/add_one_time"},
      "amount": {"type": "number"},
      "start": {"type": "string", "description": "YYYY-MM the change takes effect"}}}}}}}}
SYSTEM = ("You help a user explore their budget forecast. For any what-if question, call run_forecast with the "
  "exact changes. Use names exactly as they appear in the plan. Never suggest pausing retirement unless asked. "
  "If the question needs no forecast, answer briefly without a tool. You cannot delete accounts or move money.\n\n" + PLAN)
CASES = [
 ("What if I cancel the gym from November?", [("end_rule","Gym",None,"2026-11")]),
 ("What happens if my rent goes up to $1,950 starting January?", [("change_amount","Rent",1950,"2027-01")]),
 ("If I pause the vacation fund, how does December look?", [("pause_goal","Vacation fund",None,None)]),
 ("What if I drop the business transfer to $40 from November?", [("change_amount","Business transfer",40,"2026-11")]),
 ("Say I get a $400 car repair bill in October, am I ok?", [("add_one_time",None,400,"2026-10")]),
 ("What if I stop streaming and cut car insurance to $120, both from October?", [("end_rule","Streaming",None,"2026-10"),("change_amount","Car insurance",120,"2026-10")]),
 ("What if I pick up a side job paying $300 a month from November?", [("add_rule",None,300,"2026-11")]),
 ("What does cash floor mean?", None),
 ("Delete my checking account.", None),
 ("How can I cover a short month? Show me something.", "no_retirement"),
]
def call(q):
    body = {"model": MODEL, "stream": False, "think": (sys.argv[2] == "think") if len(sys.argv) > 2 else False, "options": {"temperature": 0}, "tools": [TOOL],
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]}
    req = urllib.request.Request("http://localhost:11434/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    t = time.time(); r = json.loads(urllib.request.urlopen(req, timeout=900).read()); return r["message"], time.time() - t
def norm(c):
    a = c.get("arguments", {}); a = json.loads(a) if isinstance(a, str) else a
    return a.get("changes", [])
score = 0; lat = []
for q, exp in CASES:
    msg, dt = call(q); lat.append(dt)
    calls = msg.get("tool_calls") or []
    changes = [ch for c in calls for ch in norm(c.get("function", {}))]
    if exp is None: ok = not calls
    elif exp == "no_retirement": ok = not any("401k" in str(ch.get("target","")).lower() for ch in changes)
    else:
        ok = len(changes) == len(exp)
        for (act, tgt, amt, st), ch in zip(exp, changes):
            ok = ok and ch.get("action") == act and (tgt is None or ch.get("target") == tgt) \
                 and (amt is None or abs(float(ch.get("amount") or -1) - amt) < 0.01) and (st is None or ch.get("start") == st)
    score += ok
    print(("PASS" if ok else "FAIL"), f"{dt:5.1f}s", q[:55], "->", json.dumps(changes)[:160] if calls else (msg.get("content") or "")[:80].replace("\n"," "))
print(f"{MODEL}: {score}/{len(CASES)} | median latency {sorted(lat)[len(lat)//2]:.1f}s")
