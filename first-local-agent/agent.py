"""Первый локальный агент курса: LangGraph + модель, запущенная Ollama."""

import argparse
import json
import os
import sys
from datetime import datetime
from urllib.error import URLError
from urllib.request import urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_ollama import ChatOllama
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition


MODEL_NAME = os.environ.get("LOCAL_AGENT_MODEL", "qwen3:4b-instruct")
OLLAMA_URL = "http://127.0.0.1:11434"
SYSTEM_PROMPT = (
    "Ты Альфред, полезный локальный ассистент. Отвечай на русском языке. "
    "Когда пользователь спрашивает текущее время, вызывай инструмент времени: "
    "не угадывай его. Для точной арифметики используй арифметический инструмент. "
    "Не утверждай, что использовал инструмент, если не вызвал его."
)


@tool
def get_current_time_in_timezone(timezone: str) -> str:
    """Return the current time in an IANA timezone, e.g. Europe/Moscow.

    Args:
        timezone: IANA timezone name.
    """
    try:
        return datetime.now(ZoneInfo(timezone)).isoformat(timespec="seconds")
    except ZoneInfoNotFoundError:
        return f"Неизвестный часовой пояс: {timezone}. Используйте имя вида Europe/Moscow."


@tool
def multiply(a: int, b: int) -> int:
    """Multiply two integers exactly.

    Args:
        a: First integer.
        b: Second integer.
    """
    return a * b


TOOLS = [get_current_time_in_timezone, multiply]


def build_agent(model):
    """Собрать граф: модель → инструменты → модель, пока не получен ответ."""
    model_with_tools = model.bind_tools(TOOLS)

    def call_model(state: MessagesState):
        reply = model_with_tools.invoke(
            [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
        )
        return {"messages": [reply]}

    graph = StateGraph(MessagesState)
    graph.add_node("assistant", call_model)
    graph.add_node("tools", ToolNode(TOOLS))
    graph.add_edge(START, "assistant")
    graph.add_conditional_edges("assistant", tools_condition)
    graph.add_edge("tools", "assistant")
    return graph.compile()


def check_ollama():
    """Быстро объяснить типичные проблемы до обращения к модели."""
    try:
        with urlopen(f"{OLLAMA_URL}/api/tags", timeout=3) as response:
            models = json.load(response).get("models", [])
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError(
            "Ollama не отвечает на 127.0.0.1:11434. "
            "Проверьте 'systemctl status ollama' и 'curl http://127.0.0.1:11434/api/tags'."
        ) from error
    if not any(item.get("name") == MODEL_NAME for item in models):
        raise RuntimeError(
            f"Модель {MODEL_NAME} не найдена. Выполните: ollama pull {MODEL_NAME}"
        )


def main():
    parser = argparse.ArgumentParser(description="Локальный агент на LangGraph и Ollama")
    parser.add_argument(
        "question", nargs="?", default="Который сейчас час в Europe/Moscow?"
    )
    parser.add_argument("--trace", action="store_true", help="Показать вызовы инструментов")
    args = parser.parse_args()
    try:
        check_ollama()
        model = ChatOllama(model=MODEL_NAME, base_url=OLLAMA_URL, temperature=0)
        result = build_agent(model).invoke(
            {"messages": [HumanMessage(content=args.question)]},
            config={"recursion_limit": 12},
        )
    except Exception as error:
        print(f"Не удалось выполнить запрос: {error}", file=sys.stderr)
        return 1

    if args.trace:
        for message in result["messages"]:
            for call in getattr(message, "tool_calls", []):
                print(f"Действие: {call['name']}({call['args']})")
            if message.type == "tool":
                print(f"Наблюдение: {message.content}")
    print(f"Ответ: {result['messages'][-1].content}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
