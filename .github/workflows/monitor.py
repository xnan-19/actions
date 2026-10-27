import os
import random
import re
import time
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

# 监控目标：日期、显示名称、起始时间（包含）
TARGET_CONFIGS = [
    {"day": "5", "date": "2026-11-05", "label": "11月05日", "min_hour": 10},
    {"day": "24", "date": "2026-11-24", "label": "11月24日", "min_hour": 14},
]

BOOKING_URL = "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL"

def send_bark(title: str, content: str, jump_url: str = ""):
    if not BARK_KEY:
        print(f"[提示] 未配置 BARK_KEY: {title} - {content}")
        return
    import urllib.parse
    url = f"https://api.day.app/{BARK_KEY}/{title}/{content}?sound=bell&level=timeSensitive&group=sagano"
    if jump_url:
        url += f"&url={urllib.parse.quote(jump_url, safe='')}"
    try:
        resp = requests.get(url, timeout=5)
        print(f"Bark 推送状态: {resp.status_code}")
    except Exception as e:
        print(f"Bark 推送失败: {e}")

def human_click(page, locator):
    """模拟人类鼠标移动、停留并点击"""
    locator.scroll_into_view_if_needed()
    time.sleep(random.uniform(0.3
