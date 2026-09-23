# Первый агент на своём Ubuntu сервере

Этот проект сопровождает [обновлённый урок](../course-translations/ru-RU/unit1/tutorial.mdx) локального курса. Агент выполняется на вашем Ubuntu сервере: LangGraph управляет циклом вызовов инструментов, Ollama обслуживает модель `qwen3:4b-instruct`. Учётная запись Hugging Face, Space и API токен для упражнения не нужны. Интернет требуется один раз для установки пакетов и загрузки модели.

На Ubuntu установите Python 3.10+ и средства для виртуального окружения. Ollama установите по [официальной инструкции для Linux](https://docs.ollama.com/linux), затем:

```bash
sudo systemctl status ollama --no-pager
ollama pull qwen3:4b-instruct
curl http://127.0.0.1:11434/api/tags
sudo apt update
sudo apt install python3 python3-venv python3-pip
cd first-local-agent
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python agent.py 'Который час в Europe/Moscow и сколько будет 17 умножить на 4?' --trace
```

Если Ollama установлена без сервиса, запустите `ollama serve` в отдельном терминале. `curl /api/tags` должен показать загруженную модель. `--trace` выводит вызовы инструментов и наблюдения; модель может по-разному формулировать окончательный ответ. Для самопроверки графа без загрузки модели выполните `python -m unittest -v`.

Модель занимает около 2,5 ГБ на диске; для работы потребуется дополнительная оперативная память. На небольшом CPU сервере первый ответ может появиться не сразу. Ollama по умолчанию слушает локальный адрес `127.0.0.1:11434`; не открывайте его публично для этого упражнения. Если вы управляете сервером по SSH, запускайте Python на сервере в той же виртуальной среде. Файлы проекта можно перенести на сервер любым удобным способом, например `scp -r first-local-agent user@server:~/` из родительской папки.

Интеграция [ChatOllama](https://docs.langchain.com/oss/python/integrations/chat/ollama), [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/quickstart) и [модель Qwen3](https://ollama.com/library/qwen3:4b-instruct) сверены с документацией 23 сентября 2026 года.
