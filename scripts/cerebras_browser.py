#!/usr/bin/env python3
"""
Cerebras + Browser-Use Sandbox Wrapper
Invoked by the Beatrice backend to delegate browser automation tasks
to a Cerebras-powered Browser-Use agent.

Usage:
  python3 scripts/cerebras_browser.py --task "Go to example.com and extract the headline" [--model "gpt-oss-120b"] [--timeout 60]

Returns JSON with {ok: bool, result: str, pages_visited: int, error?: str}
"""

import argparse
import json
import os
import sys
import traceback
from dotenv import load_dotenv

# ── Load .env from project root ──
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dotenv_path = os.path.join(project_root, '.env')
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)

CEREBRAS_API_KEY = os.getenv('CEREBRAS_API_KEY', '')
CEREBRAS_BASE_URL = os.getenv('CEREBRAS_BASE_URL', 'https://api.cerebras.ai/v2')


def create_cerebras_llm(model: str = "gpt-oss-120b"):
    """
    Create a Cerebras-compatible LangChain ChatOpenAI instance.
    browser_use.Agent expects a BaseChatModel with a .provider attribute.
    """
    if not CEREBRAS_API_KEY:
        raise ValueError(
            "CEREBRAS_API_KEY not set. "
            "Add it to your .env file: CEREBRAS_API_KEY=<your-key>"
        )
    try:
        from langchain_openai import ChatOpenAI
    except ImportError:
        raise ImportError("langchain-openai not installed. Run: pip install langchain-openai")

    llm = ChatOpenAI(
        model=model,
        api_key=CEREBRAS_API_KEY,
        base_url=CEREBRAS_BASE_URL,
        temperature=0.1,
        max_retries=2,
        timeout=120,
    )
    # browser_use.Agent accesses .provider and .model attributes
    object.__setattr__(llm, 'provider', 'cerebras')
    object.__setattr__(llm, 'model', model)
    return llm


def run_browser_task(task: str, model: str = "gpt-oss-120b", timeout: int = 60) -> dict:
    """
    Execute a browser automation task using Browser-Use + Cerebras.

    Args:
        task: Natural language description of what to do in the browser.
        model: Cerebras model name (gpt-oss-120b or zai-glm-4.7).
        timeout: Max execution time in seconds.

    Returns:
        dict with ok, result, pages_visited, etc.
    """
    try:
        from browser_use import Agent
    except ImportError:
        return {
            "ok": False,
            "error": (
                "browser-use not installed. Run:\n"
                "  pip install browser-use && playwright install"
            ),
        }

    pages_visited = 0

    llm_instance = create_cerebras_llm(model=model)

    try:
        import asyncio

        async def run_agent():
            nonlocal pages_visited
            agent = Agent(
                task=task,
                llm=llm_instance,
                use_vision=False,
                max_actions_per_step=5,
            )
            history = await agent.run(max_steps=30)
            
            # Try to extract a human-readable result from history
            try:
                hist_list = list(history.history) if hasattr(history, 'history') else []
                for h in hist_list:
                    try:
                        if h.result:
                            return str(h.result)[:8000]
                    except Exception:
                        pass
            except Exception:
                pass
            
            return "Task completed in browser."

        result = asyncio.run(run_agent())

        return {
            "ok": True,
            "result": str(result)[:8000],
            "pages_visited": pages_visited,
            "model_used": model,
        }

    except Exception as e:
        return {
            "ok": False,
            "error": str(e)[:500],
        }

    except Exception as e:
        return {
            "ok": False,
            "error": f"Browser task failed: {str(e)[:500]}",
        }


def main():
    parser = argparse.ArgumentParser(description="Cerebras Browser-Use Sandbox")
    parser.add_argument("--task", required=True, help="Browser automation task description")
    parser.add_argument("--model", default="gpt-oss-120b", help="Cerebras model (gpt-oss-120b or zai-glm-4.7)")
    parser.add_argument("--timeout", type=int, default=60, help="Max execution time in seconds")
    args = parser.parse_args()

    result = run_browser_task(args.task, args.model, args.timeout)
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
