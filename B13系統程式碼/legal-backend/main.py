from datetime import datetime
from typing import List, Dict, Any, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlmodel import select

from stats_manager import log_missed_keywords, get_top_missed_keywords
from question_bank import QUESTION_BANK
from db import init_db, get_session
from models import AnswerRecordDB


app = FastAPI()


# ---------- 啟動事件：建立資料表 ----------

@app.on_event("startup")
def on_startup():
    """
    後端啟動時建立（如果不存在）所有資料表。
    """
    init_db()


# ---------- CORS 設定 ----------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- 深度係數計算 ----------
def compute_depth_factor(answer_text: str, min_chars: int) -> float:
    text = answer_text.strip()
    length = len(text)

    # --- A：字數限制（強制壓深度） ---
    # < 50% → 最多 0.3
    if length < min_chars * 0.5:
        return 0.3
    
    # 50%～100% → 最多 0.5
    if length < min_chars:
        return 0.5

def compute_depth_factor(answer_text: str, min_chars: int) -> float:
    """
    粗略評估答案的「深度」，先用形式面指標算一個 0.3～1.0 的基礎值：
    - 0.3：很淺，幾乎只有列關鍵字或單一句子
    - 0.5：略有展開
    - 0.6：有基本說明，但較少例子
    - 0.8：有條理說明，也有部分理由或結構
    - 1.0：有完整說明、理由、例子或法條串接
    （真正的「垃圾內容壓分」會在外層再做 A+B 兩段式過濾）
    """
    text = answer_text.strip()
    length = len(text)

    # 1. 句子與結構感
    sentence_marks = ["。", "；", "?", "？", "!", "！"]
    sentence_count = 1
    for m in sentence_marks:
        sentence_count += text.count(m)

    # 2. 說理用語
    reasoning_tokens = ["因而", "因此", "所以", "是以", "惟", "然而", "此外", "另外", "再者", "首先", "其次"]
    has_reasoning = any(tok in text for tok in reasoning_tokens)

    # 3. 舉例／說明標記
    example_tokens = ["例如", "舉例", "如：", "如「", "如同"]
    has_example = any(tok in text for tok in example_tokens)

    # 4. 法條／學理引用
    law_tokens = ["民法第", "刑法第", "行政法第", "學說", "實務見解", "通說", "多數見解", "少數見解"]
    has_law_ref = any(tok in text for tok in law_tokens)

    # 5. 篇幅是否達標
    length_ok = length >= min_chars

    score = 0
    if length >= min_chars * 0.5:
        score += 1
    if length_ok:
        score += 1
    if sentence_count >= 3:
        score += 1
    if has_reasoning:
        score += 1
    if has_example:
        score += 1
    if has_law_ref:
        score += 1

    if score <= 1:
        return 0.3
    elif score == 2:
        return 0.5
    elif score == 3:
        return 0.6
    elif score == 4:
        return 0.8
    else:
        return 1.0


# ---------- 題目設定（核心關鍵字 / 加分關鍵字 / 最低篇幅） ----------

QUESTION_CONFIG: Dict[int, Dict[str, Any]] = {
    1: {
        "core": ["代理權", "內部授權", "外部授權"],
        "bonus": ["基本法律關係", "債之發生原因"],
        "min_chars": 200,
    },
    2: {
        "core": ["代理權", "消滅", "撤回", "民法第108條"],
        "bonus": ["基本法律關係", "不得撤回"],
        "min_chars": 200,
    },
    3: {
        "core": ["表見代理", "授權的表見", "代理權繼續存在的表見"],
        "bonus": ["善意第三人", "無權代理", "民法第169條"],
        "min_chars": 220,
    },
    4: {
        "core": ["承諾遲到", "撤回要約", "遲到通知"],
        "bonus": ["觀念通知", "民法第159條", "民法第162條", "民法第163條"],
        "min_chars": 200,
    },
    5: {
        "core": ["民法第153條", "債權契約", "物權契約"],
        "bonus": ["身分法上契約", "債務承認", "民法第144條"],
        "min_chars": 220,
    },
    6: {
        "core": ["債務約束", "債務承認", "時效完成"],
        "bonus": ["自然債務", "民法第144條", "民法第195條"],
        "min_chars": 220,
    },
    7: {
        "core": ["懸賞廣告", "報酬請求權", "民法第164條", "民法第165條"],
        "bonus": ["信賴利益", "不當得利", "清償", "善意受領人"],
        "min_chars": 250,
    },
    8: {
        "core": ["無因管理", "適法管理", "不適法管理", "急迫管理"],
        "bonus": ["適當管理", "不適當管理", "注意義務", "求償範圍"],
        "min_chars": 250,
    },
    9: {
        "core": ["殺人罪", "刑法第271條", "教唆犯", "幫助犯", "正當防衛", "偶然防衛"],
        "bonus": ["共犯從屬", "連鎖共犯", "假釋期間", "不法從屬"],
        "min_chars": 400,
    },
}


# ---------- Pydantic 模型（2.0 結構） ----------

class MetricScore(BaseModel):
    name: str                         # "keyword_coverage" | "length" | "depth" ...
    score: float                      # 0 ~ 1
    details: Dict[str, Any] = Field(default_factory=dict)


class HitKeywordDetail(BaseModel):
    keyword: str
    kind: str                         # "core" or "bonus"
    count: int                        # 出現次數


class EvaluateRequest(BaseModel):
    question_id: int
    answer_text: str
    user_code: Optional[str] = None   # 可選：使用者代碼（不填就當 guest）


class EvaluateResponse(BaseModel):
    # ---- 舊版欄位（保留相容） ----
    score: float
    hit_keywords: List[str]
    missing_keywords: List[str]
    message: str

    # ---- 2.0 新增欄位 ----
    raw_score: Optional[float] = None         # 深度係數前的分數
    final_score: Optional[float] = None       # 深度係數後的最終分數（= score）
    metric_scores: List[MetricScore] = Field(default_factory=list)
    hit_keyword_details: List[HitKeywordDetail] = Field(default_factory=list)
    depth_factor: Optional[float] = None


class AnswerRecord(BaseModel):
    id: int
    question_id: int
    question_title: str
    score: float
    created_at: datetime


class StatsResponse(BaseModel):
    total_answers: int
    average_score: float
    per_question: List[Dict[str, Any]]


class CoachRequest(BaseModel):
    question_id: int
    answer_text: str
    user_code: Optional[str] = None   # 目前未使用，但預留


class CoachResponse(BaseModel):
    missing_core: List[str]
    missing_bonus: List[str]
    depth_factor: float
    coach_message: str


# ---------- 共用小工具：關鍵字分析 ----------

def analyze_keywords(
    answer_text: str,
    core_keywords: List[str],
    bonus_keywords: List[str],
):
    hit_core: List[str] = []
    miss_core: List[str] = []
    hit_bonus: List[str] = []
    miss_bonus: List[str] = []

    for kw in core_keywords:
        if kw and kw in answer_text:
            hit_core.append(kw)
        else:
            miss_core.append(kw)

    for kw in bonus_keywords:
        if kw and kw in answer_text:
            hit_bonus.append(kw)
        else:
            miss_bonus.append(kw)

    return hit_core, miss_core, hit_bonus, miss_bonus


# ---------- /questions：取得題目列表 ----------

@app.get("/questions")
def get_questions():
    """
    回傳題目清單（含題目全文、相關法條、解題方向），方便前端顯示題目說明區。
    """
    return [
        {
            "id": q["id"],
            "subject": q["subject"],
            "title": q["title"],
            "body": q.get("body", ""),
            "related_articles": q.get("related_articles", []),
            "hint": q.get("hint", ""),
        }
        for q in QUESTION_BANK
    ]


# ---------- /evaluate：評分 & 寫入作答紀錄（支援 user_code） ----------

@app.post("/evaluate", response_model=EvaluateResponse)
def evaluate_answer(req: EvaluateRequest):
    # 1. 找題目
    question = next((q for q in QUESTION_BANK if q["id"] == req.question_id), None)
    if question is None:
        return EvaluateResponse(
            score=0,
            hit_keywords=[],
            missing_keywords=[],
            message="找不到這一題，請重新選擇題目。",
            raw_score=0,
            final_score=0,
            metric_scores=[],
            hit_keyword_details=[],
            depth_factor=0,
        )

    answer_text = (req.answer_text or "").strip()
    # user_code：若沒填就當 "guest"
    user_code = (req.user_code or "").strip() or "guest"

    # 2. 讀取題目設定
    config = QUESTION_CONFIG.get(req.question_id)
    if not config:
        return EvaluateResponse(
            score=0,
            hit_keywords=[],
            missing_keywords=[],
            message="本題尚未設定評分規則，暫無法提供參考分數。",
            raw_score=0,
            final_score=0,
            metric_scores=[],
            hit_keyword_details=[],
            depth_factor=0,
        )

    core_keywords: List[str] = config.get("core", [])
    bonus_keywords: List[str] = config.get("bonus", [])
    min_chars: int = config.get("min_chars", 0)

    # 3. 關鍵字分析
    hit_core, miss_core, hit_bonus, miss_bonus = analyze_keywords(
        answer_text, core_keywords, bonus_keywords
    )

    # 4. 篇幅
    length = len(answer_text)
    if min_chars > 0:
        length_ratio = max(0.0, min(1.0, length / min_chars))
    else:
        length_ratio = 1.0

    # 5. 分數計算（核心 70 + 加分 20 + 篇幅 10）
    core_ratio = len(hit_core) / len(core_keywords) if core_keywords else 0.0
    bonus_ratio = len(hit_bonus) / len(bonus_keywords) if bonus_keywords else 0.0

    core_score = 70.0 * core_ratio
    bonus_score = 20.0 * bonus_ratio
    length_score = 10.0 * length_ratio

    # 防線 1：篇幅過短 → 限縮核心得分
    if length < (min_chars * 0.5):
        core_score = min(core_score, 70.0 * 0.3)

    # 6. 關鍵字堆疊檢查
    stuffing_flag = False
    distinct_hit_keywords = len(set(hit_core + hit_bonus))
    keyword_density = length / distinct_hit_keywords if distinct_hit_keywords > 0 else 9999

    # 防線 2：極短但命中多關鍵字
    if length < 60 and distinct_hit_keywords >= 2:
        stuffing_flag = True
        core_score = min(core_score, 70 * 0.25)
        bonus_score = min(bonus_score, 20 * 0.20)

    # 防線 3：keyword density 過低
    if distinct_hit_keywords >= 4 and keyword_density < 40:
        stuffing_flag = True
        core_score = min(core_score, 70 * 0.3)
        bonus_score = min(bonus_score, 20 * 0.3)

    # ---------- 7. 深度係數：基礎 + A+B 兩段式過濾 ----------

    # 7-1 先用原本的形式指標算一個基礎深度
    depth_factor = compute_depth_factor(answer_text, min_chars)

    # A. 法律語彙簽章檢查：完全沒有法律相關詞 → 視為垃圾內容，深度上限壓低
    legal_tokens = [
        "民法", "刑法", "行政法", "公法", "私法",
        "構成要件", "要件", "效果", "法律關係",
        "違法", "責任", "權利", "義務",
        "學說", "實務見解", "通說", "多數見解", "少數見解",
    ]
    has_legal = any(tok in answer_text for tok in legal_tokens)

    if not has_legal:
        # 沒有任何法律語彙 → 不論句子再怎麼多，深度最高 0.2
        depth_factor = min(depth_factor, 0.2)

    # B. 與本題核心／加分關鍵字的語意關聯：完全沒碰到主題 → 再扣一輪
    relevant_tokens = [kw for kw in (core_keywords + bonus_keywords) if kw]
    has_relevance = any(tok in answer_text for tok in relevant_tokens)

    if not has_relevance:
        # 沒有觸及本題主題 → 直接把深度打 0.3 折扣
        depth_factor = depth_factor * 0.3

    # 深度防呆：限制在 0 ~ 1 範圍
    depth_factor = max(0.0, min(1.0, depth_factor))

    # 用調整後的深度係數計算內容分
    content_score = (core_score + bonus_score) * depth_factor

    # 8. 合計
    raw_score = core_score + bonus_score + length_score
    total_score = content_score + length_score
    total_score = max(0.0, min(100.0, round(total_score, 1)))

    # 9. 指標 metric_scores
    metric_scores: List[MetricScore] = []

    keyword_metric_score = (core_score + bonus_score) / 90.0 if (70 + 20) > 0 else 0.0

    metric_scores.append(
        MetricScore(
            name="keyword_coverage",
            score=round(keyword_metric_score, 3),
            details={
                "core_ratio": core_ratio,
                "bonus_ratio": bonus_ratio,
                "core_score": core_score,
                "bonus_score": bonus_score,
                "distinct_hit_keywords": distinct_hit_keywords,
                "stuffing_flag": stuffing_flag,
            },
        )
    )

    metric_scores.append(
        MetricScore(
            name="length",
            score=round(length_ratio, 3),
            details={"length": length, "min_chars": min_chars},
        )
    )

    metric_scores.append(
        MetricScore(
            name="depth",
            score=round(depth_factor, 3),
            details={
                "computed_by": "compute_depth_factor + legal/relevance filters",
                "has_legal_terms": has_legal,
                "has_relevance": has_relevance,
            },
        )
    )

    # 10. hit_keyword_details
    hit_keyword_details: List[HitKeywordDetail] = []
    for kw in hit_core:
        hit_keyword_details.append(
            HitKeywordDetail(
                keyword=kw,
                kind="core",
                count=answer_text.count(kw),
            )
        )
    for kw in hit_bonus:
        hit_keyword_details.append(
            HitKeywordDetail(
                keyword=kw,
                kind="bonus",
                count=answer_text.count(kw),
            )
        )

    # 11. 訊息組裝
    messages: List[str] = []

    if len(hit_core) == len(core_keywords) and len(core_keywords) > 0:
        messages.append("本題的核心概念都有提到，方向正確。")
    elif len(hit_core) > 0:
        messages.append("部分核心概念已寫到，但仍有重要關鍵字未被提及。")
    else:
        messages.append("目前幾乎沒有觸及本題的核心關鍵詞，建議重新審題。")

    if len(hit_bonus) > 0:
        messages.append("有提到進階或加分概念，可再強化論述深度。")
    else:
        messages.append("如能再補充進一步的學說、實務或進階觀點，可讓答案更完整。")

    if length < min_chars:
        messages.append(
            f"目前作答篇幅略顯不足（約 {length} 字），建議至少寫到約 {min_chars} 字。"
        )

    if core_keywords and depth_factor <= 0.5 and len(hit_core) >= max(1, len(core_keywords) // 2):
        messages.append(
            "目前答案雖有提及若干核心概念，但說理、法條適用或具體例子較少，"
            "建議補充理由說明與事實／法條串聯，以提升答案深度。"
        )

    if stuffing_flag:
        messages.append("系統偵測到可能為關鍵字堆疊，已調整評分避免不實際高分。")

    # 新增：如果幾乎沒有法律詞或與本題主題無關，給一段提示
    if not has_legal:
        messages.append("系統偵測到本次內容幾乎未出現法律相關語彙，深度係數已大幅下調。")
    elif not has_relevance:
        messages.append("本次內容與本題核心概念關聯度偏低，深度係數已調整，建議回到題目主題重新作答。")

    if total_score >= 90:
        messages.append("整體表現優良，已接近完整參考答案水準。")
    elif total_score >= 70:
        messages.append("表現不錯，但仍有補強空間。")
    elif total_score >= 50:
        messages.append("已有基本方向，但與完整答案仍有差距。")
    else:
        messages.append("與本題重點落差較大，建議重新建立答題架構。")

    full_message = " ".join(messages)

    hit_keywords = hit_core + hit_bonus
    missing_keywords = miss_core + miss_bonus

    # 12. 漏寫關鍵字 log（含 user_code）
    log_missed_keywords(req.question_id, missing_keywords, user_code=user_code)

    # 13. 作答紀錄寫入 DB（含 user_code）
    with get_session() as session:
        db_record = AnswerRecordDB(
            user_code=user_code,
            question_id=question["id"],
            question_title=question["title"],
            score=total_score,
            created_at=datetime.utcnow(),
        )
        session.add(db_record)
        session.commit()
        session.refresh(db_record)

    # 14. 回傳
    return EvaluateResponse(
        score=total_score,
        hit_keywords=hit_keywords,
        missing_keywords=missing_keywords,
        message=full_message,
        raw_score=round(raw_score, 1),
        final_score=total_score,
        metric_scores=metric_scores,
        hit_keyword_details=hit_keyword_details,
        depth_factor=round(depth_factor, 3),
    )


# ---------- /coach：AI 教練 ----------

@app.post("/coach", response_model=CoachResponse)
def coach_answer(req: CoachRequest):
    """
    AI 教練：不給分數，只給「缺哪些概念＋答案深度建議」。
    """
    question = next((q for q in QUESTION_BANK if q["id"] == req.question_id), None)
    if question is None:
        return CoachResponse(
            missing_core=[],
            missing_bonus=[],
            depth_factor=0.0,
            coach_message="找不到這一題，請重新選擇題目。",
        )

    answer_text = (req.answer_text or "").strip()
    config = QUESTION_CONFIG.get(req.question_id)
    if not config:
        return CoachResponse(
            missing_core=[],
            missing_bonus=[],
            depth_factor=0.0,
            coach_message="本題尚未設定評分規則，暫無法提供教練建議。",
        )

    core_keywords: List[str] = config.get("core", [])
    bonus_keywords: List[str] = config.get("bonus", [])
    min_chars: int = config.get("min_chars", 0)

    hit_core, miss_core, hit_bonus, miss_bonus = analyze_keywords(
        answer_text, core_keywords, bonus_keywords
    )

    # 先算基礎深度
    depth_factor = compute_depth_factor(answer_text, min_chars)

    # 同步套用 A+B 兩段式過濾，讓教練顯示的深度係數跟評分一致
    legal_tokens = [
        "民法", "刑法", "行政法", "公法", "私法",
        "構成要件", "要件", "效果", "法律關係",
        "違法", "責任", "權利", "義務",
        "學說", "實務見解", "通說", "多數見解", "少數見解",
    ]
    has_legal = any(tok in answer_text for tok in legal_tokens)

    if not has_legal:
        depth_factor = min(depth_factor, 0.2)

    relevant_tokens = [kw for kw in (core_keywords + bonus_keywords) if kw]
    has_relevance = any(tok in answer_text for tok in relevant_tokens)

    if not has_relevance:
        depth_factor = depth_factor * 0.3

    depth_factor = max(0.0, min(1.0, depth_factor))

    parts: List[str] = []

    if hit_core:
        parts.append(f"你已經有提到部分核心概念：{ '、'.join(hit_core) }。")
    if miss_core:
        parts.append(f"建議補充下列核心關鍵詞的說明：{ '、'.join(miss_core) }。")

    if hit_bonus:
        parts.append(
            f"另外有觸及進階或加分概念：{ '、'.join(hit_bonus) }，可以再把理由和法條連結寫得更完整。"
        )
    if miss_bonus:
        parts.append(
            f"若時間允許，也可嘗試加入：{ '、'.join(miss_bonus) } 等進階概念，拉高答案層次。"
        )

    if not has_legal:
        parts.append("目前內容幾乎沒有法律相關語彙，建議重新以法律概念與條文為主體進行作答。")
    elif not has_relevance:
        parts.append("本次內容與題目主題的關聯度偏低，建議回到題目關鍵字重新架構答案。")
    else:
        if depth_factor <= 0.5:
            parts.append("目前答案篇幅或說理深度偏少，建議補充『為何如此』的理由、適用之法條以及簡單例子。")
        elif depth_factor < 0.8:
            parts.append("整體架構尚可，但可再加強論證步驟與條文適用的串接，使答案更有層次感。")
        else:
            parts.append("答案在結構與深度上已有一定水準，可以再檢查是否有遺漏關鍵詞或重要爭點。")

    coach_message = (
        " ".join(parts)
        if parts
        else "目前字數或內容偏少，建議先依題目逐點搭出完整架構再作答。"
    )

    return CoachResponse(
        missing_core=miss_core,
        missing_bonus=miss_bonus,
        depth_factor=round(depth_factor, 2),
        coach_message=coach_message,
    )


# ---------- /answers/recent：取得最近作答紀錄（可依 user_code 過濾） ----------

@app.get("/answers/recent", response_model=List[AnswerRecord])
def get_recent_answers(
    limit: int = 20,
    user_code: Optional[str] = None,
):
    """
    回傳最近幾筆作答紀錄，預設 20 筆（依照時間由新到舊）。
    若有 user_code，僅回傳該使用者的紀錄。
    """
    norm_code = (user_code or "").strip()

    with get_session() as session:
        stmt = select(AnswerRecordDB)
        if norm_code:
            stmt = stmt.where(AnswerRecordDB.user_code == norm_code)

        stmt = stmt.order_by(AnswerRecordDB.created_at.desc()).limit(limit)
        records = list(session.exec(stmt))

    return [
        AnswerRecord(
            id=r.id,
            question_id=r.question_id,
            question_title=r.question_title,
            score=r.score,
            created_at=r.created_at,
        )
        for r in records
    ]


# ---------- /stats/summary：整體統計（可依 user_code 過濾） ----------

@app.get("/stats/summary", response_model=StatsResponse)
def get_stats_summary(
    user_code: Optional[str] = None,
):
    """
    整體練習統計：
    - 作答總次數
    - 平均分數
    - 各題被作答次數與平均分數
    若有 user_code，僅統計該使用者。
    """
    norm_code = (user_code or "").strip()

    with get_session() as session:
        stmt = select(AnswerRecordDB)
        if norm_code:
            stmt = stmt.where(AnswerRecordDB.user_code == norm_code)
        records = list(session.exec(stmt))

    total_answers = len(records)
    if total_answers == 0:
        return StatsResponse(
            total_answers=0,
            average_score=0.0,
            per_question=[],
        )

    avg_score = round(
        sum(r.score for r in records) / total_answers, 1
    )

    per_q: Dict[int, Dict[str, Any]] = {}
    for r in records:
        qid = r.question_id
        if qid not in per_q:
            per_q[qid] = {
                "question_id": qid,
                "question_title": r.question_title,
                "count": 0,
                "avg_score": 0.0,
                "scores": [],
            }
        per_q[qid]["count"] += 1
        per_q[qid]["scores"].append(r.score)

    for info in per_q.values():
        info["avg_score"] = round(
            sum(info["scores"]) / len(info["scores"]), 1
        )
        del info["scores"]

    return StatsResponse(
        total_answers=total_answers,
        average_score=avg_score,
        per_question=list(per_q.values()),
    )


# ---------- /stats/missed_keywords：最常被漏寫的關鍵字（可依 user_code 過濾） ----------

@app.get("/stats/missed_keywords")
def get_missed_keywords(
    top_n: int = 3,
    user_code: Optional[str] = None,
):
    """
    回傳：最常被漏寫的關鍵字 Top N。
    若有 user_code，僅統計該使用者的漏寫情況。
    """
    norm_code = (user_code or "").strip() or None
    raw = get_top_missed_keywords(top_n=top_n, user_code=norm_code)
    return {
        "top_missed": [
            {"keyword": kw, "count": cnt} for kw, cnt in raw
        ]
    }
