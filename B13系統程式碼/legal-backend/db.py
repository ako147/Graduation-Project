from sqlmodel import SQLModel, create_engine, Session

# SQLite 檔會建立在 backend/ 同一層
DATABASE_URL = "sqlite:///./legal_practice.db"

# echo=True 時會印出 SQL，debug 用；平常可以設 False
engine = create_engine(DATABASE_URL, echo=False)


def init_db() -> None:
    """
    在啟動 FastAPI 的時候呼叫，建立所有資料表。
    （實際的 table 定義在 models.py 裡）
    """
    from models import AnswerRecordDB, MissedKeywordLog  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    """
    每次操作資料庫時，用這個拿到 Session。
    建議搭配 with 使用：
        with get_session() as session:
            ...
    """
    return Session(engine)
