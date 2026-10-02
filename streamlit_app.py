"""Streamlit 배포용 진입점.

앱 자체는 index.html + css + js로 된 정적 페이지다(빌드·서버 불필요).
st.components.v1.html()은 HTML을 iframe에 문자열로 넣기 때문에 상대 경로의
css/js 파일을 불러올 수 없다. 그래서 여기서 CSS와 JS를 읽어 HTML 안에 직접 넣는다.
css/·js/ 폴더를 올리기 어려우면 make_bundle.py로 만든 app_bundle.html 하나만 올려도 된다.
데이터(IndexedDB)와 설정(localStorage)은 지금처럼 각 사용자 브라우저에만 저장된다.
"""

import re
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).parent
APP_HEIGHT = 900  # 아래 CSS가 적용되지 않을 때 쓰는 iframe 기본 높이(px)
BUNDLE = "app_bundle.html"  # make_bundle.py가 만드는 한 파일짜리 앱

st.set_page_config(page_title="철강업 세무동향 모니터", layout="wide")

# 앱이 브라우저 창 전체를 쓰게 한다. iframe 높이가 고정이면 창이 낮을 때
# 상세 패널 아래쪽 버튼(삭제·수정·닫기)이 화면 밖으로 밀려나기 때문이다.
# Streamlit 헤더·여백을 없애고 iframe을 창 높이(100vh)에 맞춘다. 스크롤은 앱 안에서 한다.
# data-testid 선택자는 Streamlit 내부 구조라 버전이 바뀌면 달라질 수 있다(requirements.txt에서 버전 고정).
st.markdown(
    """
    <style>
      header[data-testid="stHeader"], [data-testid="stToolbar"], [data-testid="stDecoration"] { display: none; }
      .block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: 100% !important; }
      [data-testid="stVerticalBlock"] { gap: 0 !important; }
      iframe[data-testid="stIFrame"] { display: block; height: 100vh !important; border: 0; }
    </style>
    """,
    unsafe_allow_html=True,
)


def read(rel_path: str) -> str:
    return (ROOT / rel_path).read_text(encoding="utf-8")


def missing_sources() -> list[str]:
    """index.html이 참조하는 css/js 중 저장소에 없는 파일 목록."""
    if not (ROOT / "index.html").exists():
        return ["index.html"]
    refs = ["css/style.css"] + re.findall(r'<script src="(js/[^"]+)"></script>', read("index.html"))
    return [r for r in refs if not (ROOT / r).exists()]


@st.cache_data
def build_html() -> str:
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


# 원본 파일(index.html, css/, js/)이 다 있으면 그것으로 만들고, 없으면 번들을 쓴다.
missing = missing_sources()
if not missing:
    components.html(build_html(), height=APP_HEIGHT, scrolling=True)
elif (ROOT / BUNDLE).exists():
    components.html(read(BUNDLE), height=APP_HEIGHT, scrolling=True)
else:
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
