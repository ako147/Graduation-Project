from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class AnswerRecordDB(SQLModel, table=True):
    """
    存每一次評分紀錄：
    - 哪一題
    - 幾分
    - 什麼時候作答
    - 哪一位使用者（user_code）
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    user_code: str = Field(index=True)  # 學號 / 暱稱
    question_id: int
    question_title: str
    score: float
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MissedKeywordLog(SQLModel, table=True):
    """
    存「漏寫的關鍵字」log：
    讓 /stats/missed_keywords 可以從 DB 做聚合統計。
    也有 user_code，讓每個人看到自己的盲點。
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    user_code: str = Field(index=True)
    question_id: int
    keyword: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
