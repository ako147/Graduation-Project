import requests
from bs4 import BeautifulSoup

def fetch_one_page():
    url = "https://vocus.cc/article/64666127fd89780001d26e51"
    resp = requests.get(url)
    resp.encoding = resp.apparent_encoding  # 避免亂碼

    html = resp.text
    soup = BeautifulSoup(html, "lxml")

    # 下面這行先不要急著寫，等你看完 HTML 結構再改
    question_blocks = soup.select("CSS選擇器")  # 例如 ".question" 或 "div.qtext"

    for block in question_blocks:
        title = block.get_text(strip=True)
        print("---- 題目 ----")
        print(title)

if __name__ == "__main__":
    fetch_one_page()
