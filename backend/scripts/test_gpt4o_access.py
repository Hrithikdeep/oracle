import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: F401 - loads .env into the environment
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI


def main():
    llm = ChatOpenAI(model="gpt-4o")
    try:
        response = llm.invoke([HumanMessage(content="Say 'gpt-4o is accessible' and nothing else")])
        print("SUCCESS")
        print(f"Response: {response.content}")
    except Exception as exc:
        print("FAILED")
        print(f"Exception type: {type(exc).__name__}")
        print(f"Error message: {exc}")


if __name__ == "__main__":
    main()
