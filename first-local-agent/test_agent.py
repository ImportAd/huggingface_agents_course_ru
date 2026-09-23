import unittest
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage

from agent import build_agent, get_current_time_in_timezone, multiply
from manual_agent import run as run_manual


class FakeModel:
    def bind_tools(self, tools):
        self.tools = tools
        return self

    def invoke(self, messages):
        if not any(message.type == "tool" for message in messages):
            return AIMessage(content="", tool_calls=[{
                "name": "multiply", "args": {"a": 17, "b": 4}, "id": "test-call"
            }])
        return AIMessage(content=f"Результат: {messages[-1].content}")


class LocalAgentTest(unittest.TestCase):
    def test_action_observation_answer_cycle(self):
        model = FakeModel()
        result = build_agent(model).invoke({
            "messages": [HumanMessage(content="Сколько будет 17 умножить на 4?")]
        })
        self.assertEqual([message.type for message in result["messages"]],
                         ["human", "ai", "tool", "ai"])
        self.assertEqual(result["messages"][2].content, "68")
        self.assertEqual(result["messages"][-1].content, "Результат: 68")
        self.assertEqual(len(model.tools), 2)

    def test_tools(self):
        self.assertEqual(multiply.invoke({"a": 7, "b": 6}), 42)
        self.assertIn("+03:00", get_current_time_in_timezone.invoke({
            "timezone": "Europe/Moscow"
        }))
        self.assertIn("Неизвестный", get_current_time_in_timezone.invoke({
            "timezone": "Not/A_Real_Zone"
        }))

    def test_manual_loop_passes_observation_back_to_model(self):
        class FakeClient:
            def __init__(self):
                self.calls = []

            def chat(self, *, model, messages, tools=None):
                self.calls.append((model, list(messages), tools))
                if tools:
                    call = SimpleNamespace(function=SimpleNamespace(
                        name="get_current_time_in_timezone",
                        arguments={"timezone": "Europe/Moscow"},
                    ))
                    message = SimpleNamespace(content="", tool_calls=[call])
                else:
                    message = SimpleNamespace(content="В Москве сейчас местное время.", tool_calls=[])
                return SimpleNamespace(message=message)

        client = FakeClient()
        answer, observations = run_manual("Который час в Москве?", client)
        self.assertIn("Москве", answer)
        self.assertEqual(len(observations), 1)
        self.assertIn("+03:00", observations[0])
        self.assertEqual(client.calls[1][1][-1]["role"], "tool")
        self.assertEqual(client.calls[1][1][-1]["content"], observations[0])


if __name__ == "__main__":
    unittest.main()
