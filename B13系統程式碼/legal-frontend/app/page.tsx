"use client";

import { useEffect, useState } from "react";

// Chart.js 相關
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  RadialLinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type ChartData,
} from "chart.js";
import { Bar, Radar } from "react-chartjs-2";

// 註冊 Chart.js 元件
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  RadialLinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

type Question = {
  id: number;
  subject: string;
  title: string;
  body: string;
  related_articles: string[];
  hint: string;
};

type MetricScore = {
  name: string;
  score: number;
  details: Record<string, any>;
};

type HitKeywordDetail = {
  keyword: string;
  kind: "core" | "bonus";
  count: number;
};

type EvaluateResult = {
  score: number;
  hit_keywords: string[];
  missing_keywords: string[];
  message: string;

  raw_score?: number;
  final_score?: number;
  metric_scores?: MetricScore[];
  hit_keyword_details?: HitKeywordDetail[];
  depth_factor?: number;
};

type AnswerRecord = {
  id: number;
  question_id: number;
  question_title: string;
  score: number;
  created_at: string;
};

type PerQuestionStat = {
  question_id: number;
  question_title: string;
  count: number;
  avg_score: number;
};

type StatsSummary = {
  total_answers: number;
  average_score: number;
  per_question: PerQuestionStat[];
};

type CoachResult = {
  missing_core: string[];
  missing_bonus: string[];
  depth_factor: number;
  coach_message: string;
};

type MissedKeywordStat = {
  keyword: string;
  count: number;
};

export default function Home() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EvaluateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [darkMode, setDarkMode] = useState(true);

  // 使用者代碼
  const [userCode, setUserCode] = useState<string>("");

  // 練習紀錄 & 統計
  const [recentAnswers, setRecentAnswers] = useState<AnswerRecord[]>([]);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  // AI 教練 & 常見漏寫關鍵字
  const [coach, setCoach] = useState<CoachResult | null>(null);
  const [topMissed, setTopMissed] = useState<MissedKeywordStat[]>([]);

  const activeUserCode = (userCode || "").trim() || "guest";

  // 從 localStorage 載入主題與使用者
  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedTheme = window.localStorage.getItem("legal-dark-mode");
    if (savedTheme === "dark") setDarkMode(true);
    else if (savedTheme === "light") setDarkMode(false);

    const savedUser = window.localStorage.getItem("legal-user-code");
    if (savedUser) setUserCode(savedUser);
  }, []);

  // 取得題目
  useEffect(() => {
    fetch("http://localhost:8000/questions")
      .then((res) => res.json())
      .then((data: Question[]) => {
        setQuestions(data);
        if (data.length > 0) {
          const randomIndex = Math.floor(Math.random() * data.length);
          setSelectedId(data[randomIndex].id);
        } else {
          setSelectedId(null);
        }
      })
      .catch(() => {
        setQuestions([]);
        setSelectedId(null);
        setError("無法連線到後端，請確認後端是否有啟動在 8000 port。");
      });
  }, []);

  // 抓統計 & 漏寫關鍵字
  const refreshStats = async (code: string) => {
    try {
      const encoded = encodeURIComponent(code);

      const [recentRes, statsRes, missedRes] = await Promise.all([
        fetch(`http://localhost:8000/answers/recent?user_code=${encoded}`),
        fetch(`http://localhost:8000/stats/summary?user_code=${encoded}`),
        fetch(`http://localhost:8000/stats/missed_keywords?user_code=${encoded}`),
      ]);

      const recentData: AnswerRecord[] = await recentRes.json();
      const statsData: StatsSummary = await statsRes.json();
      const missedData: { top_missed: MissedKeywordStat[] } =
        await missedRes.json();

      setRecentAnswers(recentData);
      setStats(statsData);
      setTopMissed(missedData.top_missed || []);
      setStatsError(null);
    } catch {
      setStatsError("取得練習紀錄與統計時發生錯誤。");
    }
  };

  // 與後端 QUESTION_CONFIG 對應的最低建議字數
  const minCharsMap: Record<number, number> = {
    1: 200,
    2: 200,
    3: 220,
    4: 200,
    5: 220,
    6: 220,
    7: 250,
    8: 250,
    9: 400,
  };

  useEffect(() => {
    refreshStats(activeUserCode);
  }, [activeUserCode]);

  // 隨機題目
  const handleRandomQuestion = () => {
    if (questions.length === 0) return;
    const randomIndex = Math.floor(Math.random() * questions.length);
    const randomQ = questions[randomIndex];
    setSelectedId(randomQ.id);
    setAnswer("");
    setResult(null);
    setCoach(null);
    setError(null);
  };

  // 送出評分
  const handleSubmit = async () => {
    if (!selectedId) {
      setError("請先選擇一題。");
      return;
    }
    if (!answer.trim()) {
      setError("請先輸入你的答案。");
      return;
    }

    setError(null);
    setLoading(true);
    setResult(null);
    setCoach(null);

    try {
      const res = await fetch("http://localhost:8000/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: selectedId,
          answer_text: answer,
          user_code: activeUserCode,
        }),
      });
      const data: EvaluateResult = await res.json();
      setResult(data);

      // AI 教練
      try {
        const coachRes = await fetch("http://localhost:8000/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_id: selectedId,
            answer_text: answer,
          }),
        });
        if (coachRes.ok) {
          const coachData: CoachResult = await coachRes.json();
          setCoach(coachData);
        }
      } catch {
        /* ignore coach error */
      }

      refreshStats(activeUserCode);
    } catch {
      setError("評分時發生錯誤，請稍後再試。");
    } finally {
      setLoading(false);
    }
  };

  // 深 / 淺色切換
  const handleToggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("legal-dark-mode", next ? "dark" : "light");
      }
      return next;
    });
  };

  // 使用者名稱輸入
  const handleUserCodeChange = (value: string) => {
    setUserCode(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("legal-user-code", value);
    }
  };

  // 顏色樣式
  const mainClass = darkMode
    ? "bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 text-slate-50"
    : "bg-gradient-to-b from-slate-100 via-slate-50 to-slate-100 text-slate-900";

  const headerClass = darkMode
    ? "w-full border-b border-white/10 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 text-slate-50"
    : "w-full border-b border-slate-200 bg-gradient-to-r from-sky-700 via-sky-600 to-sky-700 text-slate-50";

    const chartTextColor = "#1f2937"; 

  const sideCardClass = darkMode
    ? "bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 shadow-[0_18px_45px_rgba(15,23,42,0.45)] p-4"
    : "bg-white rounded-2xl border border-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.12)] p-4";

  const sideCard2Class = darkMode
    ? "bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 text-xs md:text-sm text-slate-200/90 space-y-1.5"
    : "bg-white rounded-2xl border border-slate-200 p-4 text-xs md:text-sm text-slate-700 space-y-1.5";

  const mainCardClass = darkMode
    ? "bg-slate-50 text-slate-900 rounded-2xl shadow-[0_18px_45px_rgba(15,23,42,0.35)] border border-slate-200/90 p-5 space-y-4"
    : "bg-white text-slate-900 rounded-2xl shadow-[0_18px_45px_rgba(15,23,42,0.18)] border border-slate-200 p-5 space-y-4";

  const resultCardClass = mainCardClass;

  const footerClass = darkMode
    ? "w-full border-t border-white/10 bg-slate-950/90 text-slate-300"
    : "w-full border-t border-slate-200 bg-white/90 text-slate-500";

  const statCard1Class = darkMode
    ? "rounded-xl bg-slate-900 text-slate-50 px-4 py-3 flex flex-col justify-center"
    : "rounded-xl bg-sky-100 text-sky-800 px-4 py-3 flex flex-col justify-center border border-sky-300";

  const statCard2Class = darkMode
    ? "rounded-xl bg-amber-400 text-slate-900 px-4 py-3 flex flex-col justify-center border border-amber-300"
    : "rounded-xl bg-amber-50 text-amber-800 px-4 py-3 flex flex-col justify-center border border-amber-300";

  const statCard3Class = darkMode
    ? "rounded-xl bg-slate-800 text-slate-100 px-4 py-3 flex flex-col justify-center border border-slate-600"
    : "rounded-xl bg-slate-100 text-slate-800 px-4 py-3 flex flex-col justify-center border border-slate-300";

  const formatDateTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("zh-TW", { hour12: false });
    } catch {
      return iso;
    }
  };

  const currentQuestion =
    questions.find((q) => q.id === selectedId) || null;

  const keywordMetric = result?.metric_scores?.find(
    (m) => m.name === "keyword_coverage"
  );
  const lengthMetric = result?.metric_scores?.find((m) => m.name === "length");
  const depthMetric = result?.metric_scores?.find((m) => m.name === "depth");

  const displayScore = result
    ? (result.final_score ?? result.score ?? 0).toFixed(1)
    : "0.0";
    // 百分比顯示用
  const keywordPercent = keywordMetric
    ? Math.round(keywordMetric.score * 100)
    : 0;

  const lengthPercent = lengthMetric
    ? Math.round(lengthMetric.score * 100)
    : 0;

  // 深度係數保持 0~1，下面用 toFixed(2) 顯示
  const depthPercent =
    typeof (depthMetric?.score ?? result?.depth_factor) === "number"
      ? (depthMetric?.score ?? result?.depth_factor)!
      : 0;


  // --------------- 圖表資料與 options（跟著 darkMode 變色） ---------------

  // 各題平均分數長條圖
  const barData: ChartData<"bar"> | null =
    stats && stats.per_question.length > 0
      ? {
          labels: stats.per_question.map((q) => q.question_title),
          datasets: [
            {
              label: "平均分數",
              data: stats.per_question.map((q) => q.avg_score),
              borderRadius: 12,
              backgroundColor: darkMode
                ? "rgba(103, 164, 245, 0.6)" // amber-400
                : "rgba(251, 191, 36, 0.7)",
              borderColor: darkMode
                ? "rgba(113, 186, 255, 1)" // amber-500
                : "rgba(247, 195, 104, 0.84)",
              borderWidth: 1,
            },
          ],
        }
      : null;

      const barOptions: ChartOptions<"bar"> = {
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          legend: {
            labels: {
              color: chartTextColor,
              font: { size: 12 },
            },
          },
          tooltip: {
            titleColor: darkMode ? "#e5e7eb" : "#1f2937",
            bodyColor: darkMode ? "#f3f4f6" : "#1f2937",
            backgroundColor: darkMode ? "rgba(30,30,30,0.8)" : "rgba(255,255,255,0.9)",
            borderColor: darkMode ? "#fbbf24" : "#fab744bb",
            borderWidth: 1,
            titleFont: { size: 13, weight: "bold" },
            bodyFont: { size: 12 },
          },
        },

        scales: {
          x: {
            ticks: {
              color: chartTextColor,
              font: { size: 11 },
            },
            grid: {
              color: darkMode
                ? "rgba(148,163,184,0.3)"
                : "rgba(209,213,219,0.8)", // slate-300，加深線條
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: chartTextColor,
              font: { size: 11 },
            },
            grid: {
              color: darkMode
                ? "rgba(148,163,184,0.3)"
                : "rgba(136, 145, 155, 0.7)",
            },
          },
        },
      };


  // 單次作答雷達圖（關鍵字覆蓋 / 篇幅 / 深度）
  const hasRadarData = keywordMetric || lengthMetric || depthMetric;

  const radarData: ChartData<"radar"> | null = hasRadarData
    ? {
        labels: ["關鍵字覆蓋度", "篇幅達成度", "深度係數"],
        datasets: [
          {
            label: "本次作答指標（0~1）",
            data: [
              keywordMetric?.score ?? 0,
              lengthMetric?.score ?? 0,
              depthMetric?.score ?? result?.depth_factor ?? 0,
            ],
            backgroundColor: darkMode
              ? "rgba(103, 164, 245, 0.6)"
              : "rgba(251, 191, 36, 0.35)",
            borderColor: darkMode
              ? "rgba(103, 164, 245, 0.6)"
              : "rgba(245, 158, 11, 1)",
            borderWidth: 2,
            pointBackgroundColor: darkMode
              ? "rgba(113, 186, 255, 1)"
              : "rgba(245, 158, 11, 1)",
          },
        ],
      }
    : null;

  const radarOptions: ChartOptions<"radar"> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        beginAtZero: true,
        min: 0,
        max: 1,
        ticks: {
          stepSize: 0.25,
          display: false,
        },
        angleLines: {
          color: darkMode
            ? "rgba(148,163,184,0.4)"
            : "rgba(148,163,184,0.3)",
        },
        grid: {
          color: darkMode
            ? "rgba(148,163,184,0.4)"
            : "rgba(148,163,184,0.3)",
        },
        pointLabels: {
          color:chartTextColor,
          font: { size: 11 },
        },
      },
    },
    plugins: {
      legend: {
        labels: {
          color:chartTextColor,
          font: { size: 11 },
        },
      },
    },
  };

  // --------------------------- JSX ---------------------------

  return (
    <div className={mainClass + " min-h-screen flex flex-col"}>
      {/* Header */}
      <div className={headerClass}>
        <header className="max-w-6xl mx-auto py-6 px-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="px-3 py-1 text-[11px] tracking-[0.2em] uppercase rounded-full bg-white/5 border border-white/15 shadow-sm">
              B13 法律擬答專題
            </span>

            {/* 使用者名稱輸入 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] md:text-xs opacity-90">
                目前使用者：
              </span>
              <input
                value={userCode}
                onChange={(e) => handleUserCodeChange(e.target.value)}
                placeholder="未輸入則為 guest"
                className="px-3 py-1 rounded-full border border-white/40 bg-white/90 text-slate-800 text-[11px] md:text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300"
              />
            </div>
          </div>

          <div>
            <h1 className="text-3xl font-semibold tracking-wide mb-1">
              法律申論題 AI 智能擬答系統
            </h1>
            <div className="h-[2px] w-20 bg-gradient-to-r from-amber-400 via-amber-300 to-transparent rounded-full mb-2" />
            <p
              className={
                darkMode
                  ? "text-sm text-slate-200/90 max-w-3xl leading-relaxed"
                  : "text-sm text-slate-100 max-w-3xl leading-relaxed"
              }
            >
              透過 AI 協助分析申論答案是否掌握關鍵法條與核心論點，
              以即時回饋與數據化分析，協助考生從「背答案」進一步走向「理解法律與調整答題策略」。
            </p>
          </div>
        </header>
      </div>

      {/* Main */}
      <div className="w-full max-w-6xl mx-auto py-7 px-5 flex-1">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 左側說明 */}
          <div className="space-y-4 md:col-span-1">
            <section className={sideCardClass}>
              <h2
                className={
                  darkMode
                    ? "text-sm font-semibold mb-2 text-slate-50"
                    : "text-sm font-semibold mb-2 text-slate-900"
                }
              >
                操作流程說明
              </h2>
              <ol
                className={
                  darkMode
                    ? "list-decimal list-inside text-xs md:text-sm text-slate-200/90 space-y-1.5 leading-relaxed"
                    : "list-decimal list-inside text-xs md:text-sm text-slate-700 space-y-1.5 leading-relaxed"
                }
              >
                <li>在右側選擇或隨機抽出一題申論題。</li>
                <li>在文字框中輸入或貼上你的完整作答內容。</li>
                <li>按下「送出評分」，系統會依關鍵法條與概念計算參考分數。</li>
                <li>根據「尚未寫到的關鍵字」與 AI 教練建議，調整答題方向，再進行下一次練習。</li>
              </ol>
            </section>

            <section className={sideCard2Class}>
              <h3
                className={
                  darkMode
                    ? "text-sm font-semibold mb-1 text-slate-50"
                    : "text-sm font-semibold mb-1 text-slate-900"
                }
              >
                系統亮點
              </h3>
              <p>・以關鍵法條與概念為核心，不直接提供標準答案。</p>
              <p>・即時回饋命中與缺漏重點，協助檢視答題盲點。</p>
              <p>・AI 教練會依「深度係數」提供補強方向。</p>
              <p>・適合作為法律系學生與國考考生的自我練習工具。</p>
            </section>
          </div>

          {/* 右側操作區 */}
          <div className="space-y-4 md:col-span-2">
            {/* 練習卡片 */}
            <section className={mainCardClass}>
              <h2 className="text-base font-semibold mb-1 text-slate-900">
                練習區：選題與作答
              </h2>

              {/* 題目選擇 */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-800">
                  選擇練習題目：
                </label>
                {questions.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    題目載入中，或後端尚未啟動。
                  </p>
                ) : (
                  <select
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition"
                    value={selectedId ?? ""}
                    onChange={(e) => setSelectedId(Number(e.target.value))}
                  >
                    {questions.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 題目全文＋法條＋提示 */}
              {currentQuestion && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-700">
                    題目說明：
                  </p>
                  <p className="text-xs md:text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                    {currentQuestion.body}
                  </p>

                  {currentQuestion.related_articles &&
                    currentQuestion.related_articles.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mt-2 mb-1">
                          🔍 可能相關法條：
                        </p>
                        <ul className="list-disc list-inside text-xs md:text-sm text-slate-700 space-y-0.5">
                          {currentQuestion.related_articles.map((art) => (
                            <li key={art}>{art}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {currentQuestion.hint && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-slate-700 mb-1">
                        💡 解題方向提示：
                      </p>
                      <p className="text-xs md:text-sm text-slate-700 leading-relaxed">
                        {currentQuestion.hint}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 作答輸入框 */}
              <div className="space-y-1 mt-3">
                <label className="text-sm font-medium text-slate-800">
                  輸入你的申論答案：
                </label>
                <textarea
                  className="w-full border border-slate-300 rounded-xl p-3 text-sm min-h-[230px] leading-relaxed resize-vertical bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition"
                  placeholder="請在此輸入或貼上你的作答內容，例如先點出本題主要考驗之法律概念，再依序說明構成要件、適用條文與結論。"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </div>
              {/* 字數顯示區 */}
              {selectedId && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-500">
                    <span>
                      目前字數：{answer.length} 字
                    </span>
                    <span>
                      建議至少：{minCharsMap[selectedId]} 字
                    </span>
                  </div>

                  {/* 字數進度條 */}
                  <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full mt-1 overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all duration-300"
                      style={{
                        width: `${Math.min(
                          100,
                          (answer.length / minCharsMap[selectedId]) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              
              {/* 深度係數提示 */}
              {selectedId && (
                <>
                  {answer.length < minCharsMap[selectedId] * 0.5 && (
                    <p className="mt-1 text-xs text-red-500">
                      ⚠️ 字數未達建議篇幅 50%，深度係數將被限制在 0.3。
                    </p>
                  )}

                  {answer.length >= minCharsMap[selectedId] * 0.5 &&
                    answer.length < minCharsMap[selectedId] && (
                      <p className="mt-1 text-xs text-amber-600">
                        ⚠️ 字數接近建議篇幅，但仍未達標，深度係數最高為 0.5。
                      </p>
                    )}

                  {answer.length >= minCharsMap[selectedId] && (
                    <p className="mt-1 text-xs text-green-600">
                      ✔ 字數達標，可獲得完整深度係數評分。
                    </p>
                  )}
                </>
              )}

              <div className="flex items-center justify-between flex-wrap gap-2 mt-1">
                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                  type="button"
                  onClick={handleRandomQuestion}
                  className="px-4 py-2 rounded-full border border-slate-300 text-xs md:text-sm text-slate-700 hover:bg-slate-100 transition"
                >
                  隨機下一題
                </button>

                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="ml-auto px-6 py-2.5 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-900 text-sm font-medium shadow-md shadow-amber-200/80 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "評分中..." : "送出評分"}
                </button>
              </div>
            </section>

            {/* 評分結果卡片 */}
            {result && (
              <section className={resultCardClass}>
                <h2 className="text-base font-semibold text-slate-900">
                  AI 評分結果與重點分析
                </h2>

                {/* 總分顯示 */}
                <div className="flex flex-wrap items-baseline gap-3">
                  <p className="text-sm text-slate-700">
                    參考分數：
                    <span className="text-2xl font-semibold text-amber-500 ml-1">
                      {displayScore}
                    </span>
                    <span className="text-sm text-slate-500 ml-1">分</span>
                  </p>

                  {typeof result.raw_score === "number" && (
                    <p className="text-xs text-slate-500">
                      原始分數（未套用深度）：{result.raw_score.toFixed(1)} 分
                    </p>
                  )}

                  <p className="text-xs text-slate-500 w-full">
                    （分數為依關鍵字、篇幅與深度係數計算之練習參考值）
                  </p>
                </div>

                {/* 上方三項指標卡片：關鍵字覆蓋度 / 篇幅達成度 / 深度係數 */}
                {(keywordMetric || lengthMetric || depthMetric) && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    {/* 關鍵字覆蓋度 */}
                    <div className="rounded-2xl bg-slate-100 text-slate-800 px-4 py-3 border border-slate-200">
                      <p className="text-xs font-semibold mb-1">
                        關鍵字覆蓋度
                      </p>
                      <p className="text-2xl font-semibold leading-tight">
                        {keywordMetric ? `${keywordPercent}%` : "-"}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        核心＋加分關鍵字的整體命中比例
                      </p>
                    </div>

                    {/* 篇幅達成度 */}
                    <div className="rounded-2xl bg-slate-100 text-slate-800 px-4 py-3 border border-slate-200">
                      <p className="text-xs font-semibold mb-1">
                        篇幅達成度
                      </p>
                      <p className="text-2xl font-semibold leading-tight">
                        {lengthMetric ? `${lengthPercent}%` : "-"}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        與建議字數下限相比的完成程度
                      </p>
                    </div>

                    {/* 深度係數 */}
                    <div className="rounded-2xl bg-slate-100 text-slate-800 px-4 py-3 border border-slate-200">
                      <p className="text-xs font-semibold mb-1">深度係數</p>
                      <p className="text-2xl font-semibold leading-tight">
                        {depthMetric ? depthPercent.toFixed(2) : "-"}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        是否有說理、法條串接與例子等深度展開
                      </p>
                    </div>
                  </div>
                )}

                {/* 指標雷達圖（放在卡片下面） */}
                {radarData && (
                  <div className="mt-5 h-56 md:h-64">
                    <Radar data={radarData} options={radarOptions} />
                  </div>
                )}

                <p className="text-sm text-slate-700 mt-3">
                  系統訊息：{result.message}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-2">
                  <div>
                    <p className="font-semibold mb-1 text-slate-900">
                      已寫到的關鍵字：
                    </p>
                    {result.hit_keywords.length === 0 ? (
                      <p className="text-slate-500">
                        目前尚未命中任何關鍵字。
                      </p>
                    ) : (
                      <ul className="list-disc list-inside space-y-1 text-slate-700">
                        {result.hit_keywords.map((kw) => (
                          <li key={kw}>{kw}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold mb-1 text-slate-900">
                      尚未寫到、建議補強的關鍵字：
                    </p>
                    {result.missing_keywords.length === 0 ? (
                      <p className="text-slate-500">
                        很好，本題的主要關鍵字幾乎都已涵蓋。
                      </p>
                    ) : (
                      <ul className="list-disc list-inside space-y-1 text-slate-700">
                        {result.missing_keywords.map((kw) => (
                          <li key={kw}>{kw}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* AI 教練 */}
                {coach && (
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold text-slate-900">
                        🧑‍🏫 AI 教練建議
                      </p>
                      <p className="text-[11px] text-slate-500">
                        答案深度係數：{coach.depth_factor}
                      </p>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed mb-2">
                      {coach.coach_message}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs md:text-sm">
                      <div>
                        <p className="font-semibold text-slate-900 mb-1">
                          尚未完整展開的核心概念：
                        </p>
                        {coach.missing_core.length === 0 ? (
                          <p className="text-slate-500">
                            核心概念多已涵蓋，可著重在說理與結構優化。
                          </p>
                        ) : (
                          <ul className="list-disc list-inside space-y-1 text-slate-700">
                            {coach.missing_core.map((kw) => (
                              <li key={kw}>{kw}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 mb-1">
                          可加分的進階概念建議：
                        </p>
                        {coach.missing_bonus.length === 0 ? (
                          <p className="text-slate-500">
                            若再補充學說或實務見解，可讓答案更有層次。
                          </p>
                        ) : (
                          <ul className="list-disc list-inside space-y-1 text-slate-700">
                            {coach.missing_bonus.map((kw) => (
                              <li key={kw}>{kw}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}


            {/* 統計 + 最近紀錄 */}
            <section className={mainCardClass}>
              <h2 className="text-base font-semibold mb-2 text-slate-900">
                練習統計與紀錄總覽
              </h2>

              <p className="text-xs text-slate-500 mb-1.5">
                目前顯示的統計使用者：{" "}
                <span className="font-semibold">
                  {activeUserCode === "guest"
                    ? "guest（訪客模式）"
                    : activeUserCode}
                </span>
              </p>

              {statsError && (
                <p className="text-sm text-red-600 mb-2">{statsError}</p>
              )}

              {/* 各題平均分數長條圖 */}
              {barData && (
                <div className="mb-4 h-64">
                  <Bar data={barData} options={barOptions} />
                </div>
              )}

              {/* 上面：總覽數字 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 text-sm">
                <div className={statCard1Class}>
                  <span className="text-xs opacity-80">累計作答次數</span>
                  <span className="text-xl font-semibold">
                    {stats ? stats.total_answers : 0}
                  </span>
                </div>
                <div className={statCard2Class}>
                  <span className="text-xs opacity-80">整體平均分數</span>
                  <span className="text-xl font-semibold">
                    {stats ? stats.average_score : 0}
                  </span>
                </div>
                <div className={statCard3Class}>
                  <span className="text-xs opacity-80">練習題目數</span>
                  <span className="text-xl font-semibold">
                    {stats ? stats.per_question.length : 0}
                  </span>
                </div>
              </div>

              {/* 中間：各題統計 */}
              <div className="mb-3">
                <p className="text-xs font-semibold text-slate-700 mb-1">
                  各題練習情況
                </p>
                {stats && stats.per_question.length > 0 ? (
                  <div className="space-y-1 max-h-40 overflow-auto pr-1 text-xs md:text-sm">
                    {stats.per_question.map((q) => (
                      <div
                        key={q.question_id}
                        className="flex justify-between items-center border-b border-slate-200/70 py-1"
                      >
                        <div className="mr-2">
                          <p className="font-medium text-slate-800 line-clamp-1">
                            {q.question_title}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            練習 {q.count} 次．平均 {q.avg_score} 分
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    目前尚無統計資料，請先進行幾次練習。
                  </p>
                )}
              </div>

              {/* 下：最近紀錄 + 常見漏寫關鍵字 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-1">
                    最近練習紀錄
                  </p>
                  {recentAnswers.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      尚未有作答紀錄，完成第一次評分後即可在此查看。
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-auto pr-1 text-xs md:text-sm">
                      {recentAnswers.map((r) => (
                        <div
                          key={r.id}
                          className="flex justify-between items-center border-b border-slate-200/70 py-1"
                        >
                          <div className="mr-2">
                            <p className="font-medium text-slate-800 line-clamp-1">
                              {r.question_title}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {formatDateTime(r.created_at)}
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-amber-600">
                            {r.score} 分
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-1">
                    近期最常被漏寫的關鍵字
                  </p>
                  {topMissed.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      目前尚未累積足夠資料，練習幾次後會顯示常見盲點。
                    </p>
                  ) : (
                    <ul className="space-y-1 text-xs md:text-sm">
                      {topMissed.map((item) => (
                        <li
                          key={item.keyword}
                          className="flex items-center justify-between border-b border-slate-200/70 py-1"
                        >
                          <span className="text-slate-800">
                            {item.keyword}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            被漏寫 {item.count} 次
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className={footerClass}>
        <div className="max-w-6xl mx-auto py-3 px-5 flex items-center justify-between text-xs">
          <span>© 2024 法律申論題 AI 智能擬答系統</span>
          <span>@11144231</span>
        </div>
      </footer>

      {/* 深/淺色切換按鈕 */}
      <button
        onClick={handleToggleDarkMode}
        className="fixed bottom-4 right-4 z-50 text-[11px] px-3 py-2 rounded-full border border-slate-400/40 bg-slate-900/80 text-slate-50 shadow-lg shadow-slate-900/60 hover:bg-slate-800 transition md:text-xs"
      >
        {darkMode ? "切換為淺色模式" : "切換為深色模式"}
      </button>
    </div>
  );
}
