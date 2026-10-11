"""새로 개막하는 뮤지컬: KOPIS(공연예술통합전산망) Open API.

서비스 키는 https://www.kopis.or.kr/por/cs/openapi/openApiInfo.do 에서 무료로 발급받아
환경변수 KOPIS_API_KEY 로 넘긴다.
"""
import os
from datetime import timedelta

from bs4 import BeautifulSoup

from common import clean, fetch, now_kst

API = "http://www.kopis.or.kr/openApi/restful"
MUSICAL = "GGGA"  # KOPIS 장르 코드: 뮤지컬
PAST_DAYS = 30    # 최근 30일 안에 개막한 공연
FUTURE_DAYS = 30  # 30일 안에 개막할 공연


def _text(node, name):
    found = node.find(name)
    return clean(found.get_text()) if found else ""


def _https(url):
    return url.replace("http://", "https://", 1) if url else url


def _list(key, start, end):
    shows, page = [], 1
    while page <= 10:
        res = fetch(f"{API}/pblprfr", params={
            "service": key, "stdate": start.strftime("%Y%m%d"), "eddate": end.strftime("%Y%m%d"),
            "cpage": page, "rows": 100, "shcate": MUSICAL,
        })
        soup = BeautifulSoup(res.content, "xml")
        rows = soup.find_all("db")
        if not rows:
            if page == 1 and soup.find("returncode"):
                raise RuntimeError(_text(soup, "errmsg") or "KOPIS 오류 응답")
            break
        for db in rows:
            shows.append({
                "id": _text(db, "mt20id"),
                "title": _text(db, "prfnm"),
                "start": _text(db, "prfpdfrom").replace(".", "-"),
                "end": _text(db, "prfpdto").replace(".", "-"),
                "venue": _text(db, "fcltynm"),
                "area": _text(db, "area"),
                "poster": _https(_text(db, "poster")),
                "state": _text(db, "prfstate"),
                "openrun": _text(db, "openrun") == "Y",
            })
        if len(rows) < 100:
            break
        page += 1
    return shows


def _detail(key, show_id):
    res = fetch(f"{API}/pblprfr/{show_id}", params={"service": key})
    db = BeautifulSoup(res.content, "xml").find("db")
    if not db:
        return {}
    links = []
    for rel in db.find_all("relate"):
        url = _text(rel, "relateurl")
        if url:
            links.append({"name": _text(rel, "relatenm") or "예매", "url": url})
    return {
        "synopsis": _text(db, "sty"),
        "synopsisImages": [_https(clean(u.get_text())) for u in db.find_all("styurl")][:4],
        "cast": _text(db, "prfcast"),
        "crew": _text(db, "prfcrew"),
        "runtime": _text(db, "prfruntime"),
        "age": _text(db, "prfage"),
        "price": _text(db, "pcseguidance"),
        "producer": _text(db, "entrpsnm") or _text(db, "entrpsnmP"),
        "schedule": _text(db, "dtguidance"),
        "links": links[:4],
        "kopis": f"https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00020&mt20Id={show_id}",
    }


def collect(previous):
    """previous: 지난번 shows.json 의 items (상세정보를 다시 받지 않으려고 재사용)."""
    key = os.environ.get("KOPIS_API_KEY")
    if not key:
        return None, ["KOPIS_API_KEY가 설정되지 않아 새 공연 정보를 건너뜀"]

    today = now_kst().date()
    lo, hi = today - timedelta(days=PAST_DAYS), today + timedelta(days=FUTURE_DAYS)
    # KOPIS는 한 번에 31일까지만 조회되므로 둘로 나눠 묻는다
    found = _list(key, lo, today) + _list(key, today + timedelta(days=1), hi)

    cache = {s["id"]: s for s in previous}
    errors, result, seen = [], [], set()
    for s in found:
        if not s["id"] or s["id"] in seen or s["openrun"]:
            continue
        seen.add(s["id"])
        if not (lo.isoformat() <= s["start"] <= hi.isoformat()):
            continue  # 오래전에 개막해 계속 공연 중인 작품은 제외
        old = cache.get(s["id"])
        if old and "synopsis" in old:
            detail = {k: old[k] for k in old if k not in s}
        else:
            try:
                detail = _detail(key, s["id"])
            except Exception as e:  # noqa: BLE001
                errors.append(f"{s['title']} 상세: {e}")
                detail = {}
        result.append({**s, **detail})
    result.sort(key=lambda s: s["start"], reverse=True)
    return result, errors
