(function () {
  // 1) 淡入動畫（scroll reveal）
  const els = document.querySelectorAll(".fade-up");
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add("show");
    });
  }, { threshold: 0.12 });
  els.forEach(el => io.observe(el));

  // 2) 導覽列：高亮目前頁面
  const path = location.pathname.split("/").pop() || "index.htm";
  document.querySelectorAll("[data-nav]").forEach(a => {
    if (a.getAttribute("href") === path) {
      a.style.color = "var(--text)";
      a.style.borderColor = "var(--line)";
      a.style.background = "rgba(255,255,255,.04)";
    }
  });

  // 3)（可選）快捷鍵：按 / 聚焦搜尋（如果未來加搜尋框可用）
})();
