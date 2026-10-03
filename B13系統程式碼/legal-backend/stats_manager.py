from datetime import datetime
from typing import List, Tuple, Optional

from sqlmodel import select, func

from db import get_session
from models import MissedKeywordLog


def log_missed_keywords(
    question_id: int,
    keywords: List[str],
    user_code: str,
) -> None:
    """
    將這次作答「漏掉的關鍵字」記錄到資料庫。
    一題可能漏掉多個 keyword，就一個一行寫入。
    依 user_code 區分不同使用者。
    """
    if not keywords:
        return

    user = (user_code or "").strip() or "guest"

    with get_session() as session:
        for kw in keywords:
            if not kw:
                continue
            log = MissedKeywordLog(
                user_code=user,
                question_id=question_id,
                keyword=kw,
                created_at=datetime.utcnow(),
            )
            session.add(log)
        session.commit()


def get_top_missed_keywords(
    top_n: int = 3,
    user_code: Optional[str] = None,
) -> List[Tuple[str, int]]:
    """
    從資料庫做 group by，抓出「最常被漏寫的關鍵字 Top N」。
    若有傳 user_code，則只統計該使用者的紀錄。
    回傳格式：[("無因管理", 12), ("代理權", 8), ...]
    """
    norm_code = (user_code or "").strip()

    with get_session() as session:
        stmt = select(
            MissedKeywordLog.keyword,
            func.count(MissedKeywordLog.id),
        )

        if norm_code:
            stmt = stmt.where(MissedKeywordLog.user_code == norm_code)

        stmt = (
            stmt.group_by(MissedKeywordLog.keyword)
            .order_by(func.count(MissedKeywordLog.id).desc())
            .limit(top_n)
        )

        rows = session.exec(stmt).all()

    return [(kw, cnt) for kw, cnt in rows]
