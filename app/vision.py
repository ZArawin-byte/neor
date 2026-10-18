"""Care-label reader. OCR first (Perceptron, else Groq vision), then Python regex, then the model fills gaps.

The regex is the source of truth: the model may only fill fields the regex left empty, and every result
is validated with Pydantic. Care steps come from the label symbols plus the fabric knowledge base.
"""
import base64
import logging
import re
import time

from pydantic import BaseModel

from . import ai, config
from .ai_schemas import CareLabelResult, CareSymbols, FiberPart
from .context import care_kb

log = logging.getLogger("neor.ai")

OCR_PROMPT = ("Read this clothing care label exactly. text is the full label text, line by line. "
              "fiber_composition lists each fibre with its percent. care fields are null when the label doesn't say.")

FIBER_RE = re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*%\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ \-]{1,30}?)(?=\s*(?:\d|[.,;:/|\n()]|$))",
                      re.M)
TEMP_RE = re.compile(r"(\d{2})\s*°\s*C?|(\d{2})\s*(?:degrees?\s*)?C\b", re.I)


class _Text(BaseModel):
    text: str


def _norm_fiber(name: str) -> str:
    low = name.strip().lower()
    found = care_kb.fibers_in(low)
    return found[0] if found else low


def parse_label(text: str) -> tuple[list[dict], dict]:
    """Regex pass: '80% WOOL 20% NYLON' -> fibres, plus the common care phrases."""
    fibers, seen = [], set()
    for pct, name in FIBER_RE.findall(text or ""):
        fiber = _norm_fiber(name)
        if fiber and fiber not in seen:
            seen.add(fiber)
            fibers.append({"fiber": fiber, "percent": float(pct.replace(",", "."))})
    low = (text or "").lower()
    care: dict = {k: None for k in CareSymbols.model_fields}
    m = TEMP_RE.search(low)
    if m and ("wash" in low or "°" in low):
        care["wash_temp_c"] = int(m.group(1) or m.group(2))
    if "hand wash" in low or "do not machine wash" in low:
        care["machine_wash"] = False
    elif "machine wash" in low:
        care["machine_wash"] = True
    if re.search(r"(do not|don't|no) bleach", low):
        care["bleach"] = False
    elif "bleach" in low:
        care["bleach"] = True
    if re.search(r"(do not|don't|no) tumble", low):
        care["tumble_dry"] = False
    elif "tumble dry" in low:
        care["tumble_dry"] = True
    if re.search(r"(do not|don't|no) iron", low):
        care["iron"] = False
    elif "iron" in low:
        care["iron"] = True
    if re.search(r"(do not|don't|no) dry.?clean", low):
        care["dry_clean"] = False
    elif re.search(r"dry.?clean", low):
        care["dry_clean"] = True
    return fibers, care


def _ocr_perceptron(image: bytes) -> str:
    from perceptron import configure, image as p_image, ocr

    configure(api_key=config.PERCEPTRON_API_KEY, model=config.PERCEPTRON_MODEL, timeout=config.AI_TIMEOUT_SECONDS)
    return (getattr(ocr(p_image(image)), "text", None) or "").strip()


def _groq_label(image: bytes, mime: str):
    from .ai_schemas import LabelDraft

    prompt = [{"type": "text", "text": OCR_PROMPT},
              {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(image).decode()}"}}]
    return ai._chat_json("care_label", "You transcribe clothing labels precisely.", prompt, LabelDraft,
                         model=config.GROQ_VISION_MODEL, temperature=0, strict=False, max_tokens=ai.VISION_MAX_TOKENS)


def _groq_from_text(text: str):
    from .ai_schemas import LabelDraft

    return ai._chat_json("care_label", "You parse clothing care labels precisely.",
                         f"LABEL TEXT:\n{text[:1500]}\n\nCopy the text into text, list the fibres with percents, "
                         "and fill care fields only if the label says them (else null).", LabelDraft,
                         model=config.GROQ_FAST_MODEL, temperature=0)


def label_steps(care: dict) -> list[str]:
    steps = []
    if care.get("machine_wash") is False:
        steps.append("Hand wash only (label).")
    if care.get("wash_temp_c"):
        steps.append(f"Wash at {care['wash_temp_c']}°C or below (label).")
    if care.get("bleach") is False:
        steps.append("Do not bleach (label).")
    if care.get("tumble_dry") is False:
        steps.append("Do not tumble dry (label).")
    if care.get("iron") is False:
        steps.append("Do not iron (label).")
    if care.get("dry_clean") is True:
        steps.append("Dry cleaning is allowed (label).")
    return steps


def read_label(image: bytes, mime: str, profile: dict) -> dict:
    t0 = time.perf_counter()
    text, engine, draft = "", "offline", None
    if profile.get("ai_consent") is False:
        return _result("", [], {}, "offline", fallback_reason="consent_off")
    if config.USE_PERCEPTRON:
        try:
            text, engine = _ocr_perceptron(image), "perceptron"
            log.info("ai feature=care_label model=%s engine=perceptron latency_ms=%d error=-",
                     config.PERCEPTRON_MODEL, (time.perf_counter() - t0) * 1000)
        except Exception as e:
            log.info("ai feature=care_label model=%s engine=fallback latency_ms=%d error=%s",
                     config.PERCEPTRON_MODEL, (time.perf_counter() - t0) * 1000, type(e).__name__)
            text = ""
    if not text and config.USE_GROQ:
        try:
            draft = _groq_label(image, mime)
            text, engine = draft.text.strip(), "groq"
        except ai.AIFailure:
            draft = None
    if not text:
        return _result("", [], {}, "offline", fallback_reason="no_key" if engine == "offline" and not (
            config.USE_PERCEPTRON or config.USE_GROQ) else "provider_error")

    fibers, care = parse_label(text)
    missing = not fibers or any(v is None for v in care.values())
    if missing and draft is None and config.USE_GROQ:
        try:
            draft = _groq_from_text(text)
        except ai.AIFailure:
            draft = None
    if draft is not None:  # the model only fills what the regex missed
        if not fibers:
            fibers = [{"fiber": _norm_fiber(f.fiber), "percent": f.percent} for f in draft.fiber_composition][:10]
        model_care = draft.care.model_dump()
        care = {k: (v if v is not None else model_care.get(k)) for k, v in care.items()}
    return _result(text, fibers, care, engine)


def _result(text: str, fibers: list[dict], care: dict, engine: str, fallback_reason: str | None = None) -> dict:
    care = {k: care.get(k) for k in CareSymbols.model_fields}
    names = [f["fiber"] for f in fibers]
    steps = list(dict.fromkeys(label_steps(care) + care_kb.care_steps(names)))[:8]
    out = CareLabelResult(text=text[:1000], fiber_composition=[FiberPart(**f) for f in fibers][:10],
                          care=CareSymbols(**care), care_steps=steps, ai=engine)
    data = out.model_dump()
    if fallback_reason:
        data["fallback_reason"] = fallback_reason
    return data
