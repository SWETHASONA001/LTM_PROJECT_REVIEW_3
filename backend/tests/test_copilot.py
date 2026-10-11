"""Copilot agent loop tested against a mocked Anthropic client (no network, no key)."""

from types import SimpleNamespace as NS

from app import copilot_service


class FakeMessages:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})  # snapshot: the loop keeps appending
        return self.script.pop(0)


def _client(script):
    msgs = FakeMessages(script)
    return NS(beta=NS(messages=msgs)), msgs


def test_tool_loop_runs_real_tools_and_returns_answer():
    tool_turn = NS(stop_reason="tool_use", model="claude-opus-5-5", content=[
        NS(type="text", text="Checking."),
        NS(type="tool_use", id="tu1", name="get_turbine_summary", input={"turbine": "R80711"}),
        NS(type="tool_use", id="tu2", name="get_anomaly_events", input={"turbine": "R80711", "month": 11}),
    ])
    final = NS(stop_reason="end_turn", model="claude-opus-5-5", content=[NS(type="text", text="Facts: …")])
    client, msgs = _client([tool_turn, final])
    out = copilot_service.chat("conv-test-1", "Why did R80711 produce less in November?", {}, client=client)
    assert out["answer"] == "Facts: …"
    assert [t["name"] for t in out["tool_calls"]] == ["get_turbine_summary", "get_anomaly_events"]
    second = msgs.calls[1]
    assert second["model"] == "claude-opus-5-5"
    assert second["fallbacks"] == "default"
    results = second["messages"][-1]["content"]
    assert {r["tool_use_id"] for r in results} == {"tu1", "tu2"}  # all results in one user message
    assert all(r["is_error"] is False for r in results)
    assert '"energyMWh"' in results[0]["content"]


def test_instruction_tool_is_captured_as_draft():
    turn = NS(stop_reason="tool_use", model="m", content=[NS(type="tool_use", id="a", name="draft_operator_instruction", input={
        "turbine": "R80790", "change": "Inspect pitch system", "reason": "r", "expected_effect": "e", "constraints": ["c"], "confidence": "low", "source": "s"})])
    final = NS(stop_reason="end_turn", model="m", content=[NS(type="text", text="Draft prepared.")])
    client, msgs = _client([turn, final])
    out = copilot_service.chat("conv-test-2", "Prepare an instruction for R80790", {}, client=client)
    assert out["instruction"]["turbine"] == "R80790"
    assert "NOT EXECUTED" in msgs.calls[1]["messages"][-1]["content"][0]["content"]


def test_unknown_turbine_and_refusal_are_handled():
    turn = NS(stop_reason="tool_use", model="m", content=[NS(type="tool_use", id="a", name="get_turbine_summary", input={"turbine": "P07"})])
    refusal = NS(stop_reason="refusal", model="m", content=[])
    client, msgs = _client([turn, refusal])
    out = copilot_service.chat("conv-test-3", "?", {}, client=client)
    assert "declined" in out["answer"]
    assert msgs.calls[1]["messages"][-1]["content"][0]["is_error"] is True


def test_follow_up_keeps_history():
    a = NS(stop_reason="end_turn", model="m", content=[NS(type="text", text="one")])
    b = NS(stop_reason="end_turn", model="m", content=[NS(type="text", text="two")])
    client, msgs = _client([a, b])
    copilot_service.chat("conv-test-4", "first", {}, client=client)
    copilot_service.chat("conv-test-4", "second", {}, client=client)
    roles = [m["role"] for m in msgs.calls[1]["messages"]]
    assert roles == ["user", "assistant", "user"]
