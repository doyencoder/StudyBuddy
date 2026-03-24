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
- Prefer "y = f(x)" in "equations", but for curves like rotated ellipses where
  that split is impractical, you may return a single implicit equation that Nova can trace.
- For generic ellipse requests, default to a centered ellipse. Use:
    equations: ["y = 2 * sqrt(1 - x^2 / 9)", "y = -2 * sqrt(1 - x^2 / 9)"]
    display_equation: "x^2/9 + y^2/4 = 1"
- For a generic rotated ellipse, use a concrete angle like pi/6 and concrete axis lengths.
  Example:
    equations: ["((x*cos(pi/6) + y*sin(pi/6))^2)/9 + ((y*cos(pi/6) - x*sin(pi/6))^2)/4 = 1"]
    display_equation: "((x*cos(pi/6) + y*sin(pi/6))^2)/9 + ((y*cos(pi/6) - x*sin(pi/6))^2)/4 = 1"
- For generic parabola requests, default to a clean quadratic like y = x^2.
  Do NOT use projectile-motion formulas such as -4.9*x^2/... unless the user
  explicitly asks for a physics trajectory or gives those numbers.
- The display_equation must describe the SAME graph as the equations list.
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


def _looks_like_explicit_math(text: str) -> bool:
    tokens = ("=", "^", "sqrt", "sin", "cos", "tan", "cot", "log", "ln", "(", ")")
    return any(token in text for token in tokens)


def _default_rotated_ellipse() -> dict:
    equation = "((x*cos(pi/6) + y*sin(pi/6))^2)/9 + ((y*cos(pi/6) - x*sin(pi/6))^2)/4 = 1"
    return {
        "equations": [equation],
        "display_equation": equation,
        "label": "Rotated ellipse",
        "x_range": [-4.5, 4.5],
    }


def _postprocess_graph_result(user_input: str, result: dict) -> dict:
    text = user_input.strip().lower()
    if _looks_like_explicit_math(text):
        return result

    if "ellipse" in text:
        if any(word in text for word in ("rotated", "tilted", "angle")):
            return _default_rotated_ellipse()
        vertical = "vertical" in text
        if vertical:
            return {
                "equations": ["y = 3 * sqrt(1 - x^2 / 4)", "y = -3 * sqrt(1 - x^2 / 4)"],
                "display_equation": "x^2/4 + y^2/9 = 1",
                "label": "Ellipse",
                "x_range": [-3, 3],
            }
        return {
            "equations": ["y = 2 * sqrt(1 - x^2 / 9)", "y = -2 * sqrt(1 - x^2 / 9)"],
            "display_equation": "x^2/9 + y^2/4 = 1",
            "label": "Ellipse",
            "x_range": [-4, 4],
        }

    if "parabola" in text:
        opens_down = "down" in text or "downward" in text
        return {
            "equations": ["y = -x^2" if opens_down else "y = x^2"],
            "display_equation": "y = -x^2" if opens_down else "y = x^2",
            "label": "Parabola",
            "x_range": [-5, 5],
        }

    if "circle" in text:
        return {
            "equations": ["y = sqrt(1 - x^2)", "y = -sqrt(1 - x^2)"],
            "display_equation": "x^2 + y^2 = 1",
            "label": "Unit circle",
            "x_range": [-1.5, 1.5],
        }

    return result


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
        result = _postprocess_graph_result(request.input, result)

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