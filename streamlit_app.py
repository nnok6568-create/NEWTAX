"""Streamlit 배포용 진입점.

앱 자체는 index.html + css + js로 된 정적 페이지다(빌드 불필요). 여기서는
1) CSS·JS를 HTML 한 파일에 넣어 Streamlit 컴포넌트로 띄우고,
2) 앱이 보낸 법제처·AI API 요청을 서버에서 대신 호출한다.
API 키는 Streamlit Secrets(ANTHROPIC_API_KEY, OPENAI_API_KEY, LAW_OC)에만 두고 브라우저로 보내지 않는다.
서버가 호출하므로 법제처 API의 CORS 제한도 받지 않는다.

통신 방식(js/server.js와 짝): 앱이 {seq, reqs:[{id, op, payload}]}를 컴포넌트 값으로 보내면
스크립트가 다시 실행되어 요청을 처리하고, 결과를 args.response={seq, responses:{id: ...}}로 돌려준다.
css/·js/ 폴더를 올리기 어려우면 make_bundle.py로 만든 app_bundle.html 하나만 올려도 된다.
데이터(IndexedDB)와 설정(localStorage)은 지금처럼 각 사용자 브라우저에만 저장된다.
"""

import json
import os
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).parent
BUNDLE = "app_bundle.html"  # make_bundle.py가 만드는 한 파일짜리 앱

LAW_URL = "https://www.law.go.kr/DRF/"
LAW_PATHS = {"lawSearch.do", "lawService.do"}
LAW_PARAMS = {"target", "type", "query", "display", "page", "prncYd", "explYd", "ID"}
AI_ENDPOINTS = {
    "anthropic": "https://api.anthropic.com/v1/messages",
    "openai": "https://api.openai.com/v1/chat/completions",
}
ANTHROPIC_BETAS = {"server-side-fallback-2026-07-01"}
MAX_OUTPUT_TOKENS = 16000
AI_TIMEOUT = 300  # 초. 분석 한 건이 오래 걸릴 수 있다.
LAW_TIMEOUT = 30

st.set_page_config(page_title="철강업 세무동향 모니터", layout="wide")

# 앱이 브라우저 창 전체를 쓰게 한다. iframe 높이가 고정이면 창이 낮을 때
# 상세 패널 아래쪽 버튼(삭제·수정·닫기)이 화면 밖으로 밀려나기 때문이다.
# Streamlit 헤더·여백을 없애고 iframe을 창 높이(100vh)에 맞춘다. 스크롤은 앱 안에서 한다.
# data-testid 선택자는 Streamlit 내부 구조라 버전이 바뀌면 달라질 수 있다(requirements.txt에서 버전 고정).
st.markdown(
    """
    <style>
      header[data-testid="stHeader"], [data-testid="stToolbar"], [data-testid="stDecoration"],
      [data-testid="stStatusWidget"] { display: none; }
      .block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: 100% !important; }
      [data-testid="stVerticalBlock"] { gap: 0 !important; }
      iframe[data-testid="stIFrame"], iframe[data-testid="stCustomComponentV1"] {
        display: block; height: 100vh !important; border: 0;
      }
    </style>
    """,
    unsafe_allow_html=True,
)


# ---------- 키 ----------
def secret(name: str) -> str:
    """Streamlit Secrets → 환경변수 순으로 찾는다. secrets.toml이 없어도 오류 없이 빈 값."""
    try:
        value = st.secrets.get(name)
    except Exception:
        value = None
    return str(value or os.environ.get(name) or "").strip()


KEYS = {
    "anthropic": secret("ANTHROPIC_API_KEY"),
    "openai": secret("OPENAI_API_KEY"),
    "law": secret("LAW_OC"),
}


# ---------- HTML ----------
def read(rel_path: str) -> str:
    return (ROOT / rel_path).read_text(encoding="utf-8")


def missing_sources() -> list[str]:
    """index.html이 참조하는 css/js 중 저장소에 없는 파일 목록."""
    if not (ROOT / "index.html").exists():
        return ["index.html"]
    refs = ["css/style.css"] + re.findall(r'<script src="(js/[^"]+)"></script>', read("index.html"))
    return [r for r in refs if not (ROOT / r).exists()]


def inline_sources() -> str:
    html = read("index.html")

    css_tag = '<link rel="stylesheet" href="css/style.css">'
    if css_tag not in html:
        raise RuntimeError("index.html에서 css/style.css 링크를 찾지 못했습니다.")
    html = html.replace(css_tag, f"<style>\n{read('css/style.css')}\n</style>")

    # <script src="js/...">를 파일 내용으로 바꾼다. 순서는 index.html 그대로 유지된다.
    html = re.sub(
        r'<script src="(js/[^"]+)"></script>',
        lambda m: f"<script>\n{read(m.group(1))}\n</script>",
        html,
    )
    if re.search(r'<script src="js/', html):
        raise RuntimeError("인라인하지 못한 스크립트가 남아 있습니다.")
    return html


@st.cache_resource
def app_component(server_config: str):
    """앱 HTML에 서버 설정(어떤 키가 있는지, 키 값은 아님)을 넣어 임시 폴더에 쓰고 컴포넌트로 등록한다."""
    html = inline_sources() if not missing_sources() else read(BUNDLE)
    html = html.replace("<head>", f"<head>\n<script>window.STM_SERVER = {server_config};</script>", 1)
    folder = Path(tempfile.mkdtemp(prefix="stm_component_"))
    (folder / "index.html").write_text(html, encoding="utf-8")
    return components.declare_component("steel_tax_monitor", path=str(folder))


# ---------- 중계 ----------
def call_law(payload: dict) -> dict:
    if not KEYS["law"]:
        return {"status": 400, "text": "LAW_OC가 설정되지 않았습니다."}
    path = payload.get("path")
    if path not in LAW_PATHS:
        return {"status": 400, "text": "허용되지 않은 경로입니다."}
    params = {k: str(v) for k, v in (payload.get("params") or {}).items() if k in LAW_PARAMS}
    params["OC"] = KEYS["law"]
    r = requests.get(LAW_URL + path, params=params, timeout=LAW_TIMEOUT)
    return {"status": r.status_code, "text": r.text}


def call_ai(payload: dict) -> dict:
    provider = payload.get("provider")
    key = KEYS.get(provider) if provider in AI_ENDPOINTS else None
    if not key:
        return {"status": 401, "text": json.dumps({"error": {"message": "서버에 API 키가 설정되지 않았습니다."}})}
    body = payload.get("body")
    if not isinstance(body, dict):
        return {"status": 400, "text": json.dumps({"error": {"message": "잘못된 요청입니다."}})}

    if provider == "anthropic":
        body["max_tokens"] = min(int(body.get("max_tokens") or 1024), MAX_OUTPUT_TOKENS)
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        if payload.get("beta") in ANTHROPIC_BETAS:
            headers["anthropic-beta"] = payload["beta"]
    else:
        body["max_completion_tokens"] = min(int(body.get("max_completion_tokens") or 1024), MAX_OUTPUT_TOKENS)
        headers = {"authorization": f"Bearer {key}"}

    r = requests.post(AI_ENDPOINTS[provider], json=body, headers=headers, timeout=AI_TIMEOUT)
    return {"status": r.status_code, "text": r.text, "retryAfter": r.headers.get("retry-after")}


def handle(req: dict) -> dict:
    try:
        payload = req.get("payload") or {}
        if req.get("op") == "law":
            return call_law(payload)
        if req.get("op") == "ai":
            return call_ai(payload)
        return {"status": 400, "text": "알 수 없는 요청입니다."}
    except requests.RequestException:
        return {"status": 0, "error": "network"}  # 앱이 네트워크 오류로 보고 재시도한다
    except Exception as e:  # 예상 못한 오류도 응답은 돌려줘야 앱이 기다리지 않는다
        return {"status": 500, "text": json.dumps({"error": {"message": f"서버 오류: {type(e).__name__}"}})}


def process(value) -> None:
    """새 요청 묶음이면 처리해서 session_state에 결과를 남긴다. 같은 seq는 다시 처리하지 않는다."""
    if not isinstance(value, dict) or not value.get("seq"):
        return
    last = st.session_state.get("stm_response")
    if last and last["seq"] == value["seq"]:
        return
    reqs = [r for r in (value.get("reqs") or []) if isinstance(r, dict) and r.get("id")][:20]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(handle, reqs))
    st.session_state["stm_response"] = {
        "seq": value["seq"],
        "responses": {r["id"]: res for r, res in zip(reqs, results)},
    }


# ---------- 실행 ----------
missing = missing_sources()
if missing and not (ROOT / BUNDLE).exists():
    # 업로드가 잘못됐을 때 무엇이 빠졌고 저장소에 실제로 무엇이 있는지 화면에 보여 준다.
    present = sorted(
        f.relative_to(ROOT).as_posix()
        for f in ROOT.rglob("*")
        if f.is_file() and ".git" not in f.relative_to(ROOT).parts
    )
    st.error(f"앱 파일이 저장소에 없습니다. {BUNDLE} 하나를 올리거나, 빠진 파일을 같은 폴더 구조로 올려 주세요.")
    st.markdown("**빠진 파일**")
    st.code("\n".join(missing))
    st.markdown("**저장소에 있는 파일**")
    st.code("\n".join(present) or "(없음)")
    st.stop()

server_config = json.dumps({name: bool(value) for name, value in KEYS.items()})
app = app_component(server_config)
process(st.session_state.get("stm_app"))
app(response=st.session_state.get("stm_response"), key="stm_app", default=None)
