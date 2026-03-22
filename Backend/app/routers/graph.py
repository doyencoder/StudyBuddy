import json
import os
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/graph", tags=["Graph"])

_PROVIDER = os.getenv("AI_PROVIDER", "azure").strip().lower()


class GraphParseRequest(BaseModel):
    input: str


class GraphParseResponse(BaseModel):
    equations: list[str]          # y = f(x) forms for actual graphing
    display_equation: str | None  # pretty implicit form e.g. "x^2/4 + y^2/9 = 1"
    label: str
    x_range: list[float]
    error: str | None = None


SYSTEM_PROMPT = """You are a math equation parser for a graphing calculator called Nova.
The user describes what they want to graph. Return ONLY a JSON object with these fields:
CRITICAL: Never use symbolic variables like a, b, h, k in equations.
Always substitute concrete numbers. If the user doesn't specify values,
use sensible defaults (e.g. for hyperbola use a=3, b=2).
- "equations": list of "y = <expr>" strings for graphing. For closed curves (ellipse,
  circle, hyperbola) split into two: one for the top half (positive sqrt) and one for
  the bottom half (negative sqrt).
- "display_equation": the single clean implicit/standard form for display in the UI.
  For ellipses use "x^2/a^2 + y^2/b^2 = 1", circles use "x^2 + y^2 = r^2",
  for lines use "y = mx + b", for parabolas use "y = ax^2 + bx + c".
  If the curve naturally has y = form, just put that. Never put the split sqrt form here.
- "label": 3-5 word friendly name
- "x_range": suggested [min, max] for x axis


Rules for equations:
- Use mathjs-compatible syntax: x^2, sqrt(x), sin(x), cos(x), abs(x), pi, e
- Never use implicit form in "equations" — always y = f(x)
- For ellipse x^2/a^2 + y^2/b^2 = 1:
    equations: ["y = b * sqrt(1 - x^2 / a^2)", "y = -b * sqrt(1 - x^2 / a^2)"]
    display_equation: "x^2/a^2 + y^2/b^2 = 1"

Examples:
Input: "ellipse with a=3 b=2"
Output: {
  "equations": ["y = 2 * sqrt(1 - x^2 / 9)", "y = -2 * sqrt(1 - x^2 / 9)"],
  "display_equation": "x^2/9 + y^2/4 = 1",
  "label": "Ellipse a=3 b=2",
  "x_range": [-4, 4]
}

Input: "unit circle"
Output: {
  "equations": ["y = sqrt(1 - x^2)", "y = -sqrt(1 - x^2)"],
  "display_equation": "x^2 + y^2 = 1",
  "label": "Unit circle",
  "x_range": [-1.5, 1.5]
}

Input: "parabola y = x squared"
Output: {
  "equations": ["y = x^2"],
  "display_equation": "y = x^2",
  "label": "Parabola",
  "x_range": [-5, 5]
}

Input: "sine wave"
Output: {
  "equations": ["y = sin(x)"],
  "display_equation": "y = sin(x)",
  "label": "Sine wave",
  "x_range": [-10, 10]
}

Return ONLY the JSON. No markdown, no backticks, no explanation."""


async def _call_azure(user_input: str) -> dict:
    from openai import AsyncAzureOpenAI
    client = AsyncAzureOpenAI(
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
        api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
        api_version="2024-02-01",
    )
    response = await client.chat.completions.create(
        model=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT", "studybuddy-chat"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_input},
        ],
        temperature=0.1,
        max_tokens=400,
    )
    raw = response.choices[0].message.content.strip()
    return json.loads(raw)


async def _call_gemini(user_input: str) -> dict:
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))
    model = genai.GenerativeModel("gemini-2.5-flash")
    response = await model.generate_content_async(
        f"{SYSTEM_PROMPT}\n\nUser input: {user_input}"
    )
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)


@router.post("/ai-parse", response_model=GraphParseResponse)
async def parse_graph_input(request: GraphParseRequest):
    if not request.input.strip():
        return GraphParseResponse(equations=[], display_equation=None, label="", x_range=[-10, 10])

    try:
        if _PROVIDER == "gemini":
            result = await _call_gemini(request.input)
        else:
            result = await _call_azure(request.input)

        return GraphParseResponse(
            equations=result.get("equations", []),
            display_equation=result.get("display_equation") or None,
            label=result.get("label", "Graph"),
            x_range=result.get("x_range", [-10, 10]),
        )

    except json.JSONDecodeError:
        return GraphParseResponse(
            equations=[], display_equation=None, label="", x_range=[-10, 10],
            error="Could not parse AI response.",
        )
    except Exception as e:
        return GraphParseResponse(
            equations=[], display_equation=None, label="", x_range=[-10, 10],
            error=str(e),
        )