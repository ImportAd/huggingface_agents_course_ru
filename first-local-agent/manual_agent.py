"""Ручной цикл «решение → действие → наблюдение → ответ» до LangGraph."""

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ollama import Client


def get_current_time_in_timezone(timezone: str) -> str:
    """Return the current time in an IANA timezone.

    Args:
        timezone: IANA timezone such as Europe/Moscow.
    """
    try:
        return datetime.now(ZoneInfo(timezone)).isoformat(timespec="seconds")
    except ZoneInfoNotFoundError:
        return f"Неизвестный часовой пояс: {timezone}"


def run(question: str, client=None):
    """Модель предлагает вызов, Python выполняет его, модель видит наблюдение."""
    client = client or Client(host="http://127.0.0.1:11434")
    messages = [
        {"role": "system", "content": "Ты Альфред. Для текущего времени вызови инструмент. Отвечай по-русски."},
        {"role": "user", "content": question},
    ]
    first = client.chat(
        model="qwen3:4b-instruct", messages=messages,
        tools=[get_current_time_in_timezone],
    )
    calls = first.message.tool_calls or []
    if not calls:
        return first.message.content, []
    messages.append(first.message)
    observations = []
    for call in calls:
        if call.function.name != "get_current_time_in_timezone":
            raise ValueError(f"Неизвестный инструмент: {call.function.name}")
        value = get_current_time_in_timezone(**call.function.arguments)
        observations.append(value)
        messages.append({
            "role": "tool", "tool_name": call.function.name, "content": value,
        })
    final = client.chat(model="qwen3:4b-instruct", messages=messages)
    return final.message.content, observations


if __name__ == "__main__":
    answer, observations = run("Который сейчас час в Europe/Moscow?")
    for item in observations:
        print("Наблюдение:", item)
    print("Ответ:", answer)
