import os
import random
import urllib.parse
import uuid
import re
from datetime import datetime, timezone, timedelta
import requests

BARK_KEY = os.getenv("BARK_KEY", "")

API_SEARCH_URL = "https://common-api.sagano.linktivity.io/v1/search-inventory"
MAIN_PAGE_URL = "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL"

HEADERS = {
    "accept": "*/*",
    "accept-language": "ja,zh-CN,zh;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "content-type": "application/json",
    "origin": "https://file.sagano.linktivity.io",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "referer": "https://file.sagano.linktivity.io/",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

def inspect_linktivity_app():
    print("\n--- 正在分析 file.sagano.linktivity.io 前端应用结构 ---")
    try:
        url = "https://file.sagano.linktivity.io/?lang=ja&date=2026-11-10&unitsCount=2"
        res = requests.get(url, headers={"user-agent": HEADERS["user-agent"]}, timeout=10)
        print(f"HTML Status: {res.status_code}, Length: {len(res.text)}")
        scripts = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', res.text)
        print(f"Found scripts: {scripts}")

        for s in scripts:
            s_url = urllib.parse.urljoin("https://file.sagano.linktivity.io/", s)
            s_res = requests.get(s_url, timeout=10)
            print(f"Script: {s}, Status: {s_res.status_code}, Length: {len(s_res.text)}")
            txt = s_res.text
            # 搜索车次选择、座位选择的组件
            matches = re.findall(r'([a-zA-Z0-9_\-\$]{3,20}(?:Service|Train|Seat|Reservation|Choose|Picker|Select)[a-zA-Z0-9_\-\$]*)', txt)
            unique_matches = list(set(matches))[:30]
            print(f"  Key tokens: {unique_matches}")
            
            # 搜索页面上的按钮文本、下一步、确定
            text_matches = re.findall(r'["\']([^"\']*(?:確定|次へ|進む|予約|座席|号車|車次|選択)[^"\']*)["\']', txt)
            print(f"  UI Texts: {list(set(text_matches))[:30]}")
    except Exception as e:
        print(f"Inspect error: {e}")

if __name__ == "__main__":
    inspect_linktivity_app()
