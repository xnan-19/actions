import os
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")
TARGET_DATE = "2026-11-24"
MIN_HOUR = 14  # 筛选 14:00 之后的班次

def send_bark(title, content):
    if not BARK_KEY:
        return
    url = f"https://api.day.app/{BARK_KEY}/{title}/{content}?sound=bell&level=timeSensitive&group=sagano"
    try:
        requests.get(url, timeout=5)
    except Exception as e:
        print(f"推送失败: {e}")

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()
        try:
            page.goto("https://ars-saganokanko.triplabo.jp/home", timeout=30000, wait_until="networkidle")
            page.wait_for_timeout(2500)

            items = page.locator(".train-item, tr, [class*='seat'], [class*='train']").all()
            available_trains = []

            for item in items:
                text = item.inner_text().strip()
                if not text:
                    continue
                for part in text.split():
                    if ":" in part and len(part) == 5:
                        try:
                            hour = int(part.split(":")[0])
                            if hour >= MIN_HOUR:
                                is_sold_out = any(f in text for f in ["✕", "×", "完売", "満席", "Sold Out"])
                                is_available = any(f in text for f in ["○", "△", "残席", "空席"])
                                if is_available and not is_sold_out:
                                    available_trains.append(f"{part}班次")
                        except ValueError:
                            pass

            if available_trains:
                trains_str = "、".join(set(available_trains))
                send_bark("岚山小火车有票提醒", f"11月24日14点后发现余票：{trains_str}，速去官网抢！")
                print(f"已发现余票并推送: {trains_str}")
            else:
                print("暂无余票。")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
