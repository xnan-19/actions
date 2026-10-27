import os
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

# 目标监控规则：日期 -> 起始小时（含）
TARGET_RULES = {
    "2026-11-05": 10,  # 11月5日 10:00 及以后
    "2026-11-24": 14,  # 11月24日 14:00 及以后
}

def send_bark(title: str, content: str):
    """向 iPhone 发送高优先级强提醒"""
    if not BARK_KEY:
        print("未获取到 BARK_KEY，跳过推送")
        return
    url = f"https://api.day.app/{BARK_KEY}/{title}/{content}?sound=bell&level=timeSensitive&group=sagano"
    try:
        resp = requests.get(url, timeout=5)
        print(f"Bark 推送状态: {resp.status_code}")
    except Exception as e:
        print(f"推送失败: {e}")

def check_single_date(page, date_str: str, min_hour: int) -> list:
    """查询指定日期符合时间要求的余票"""
    matched = []
    try:
        # 打开预约首页
        page.goto("https://ars-saganokanko.triplabo.jp/home", timeout=35000, wait_until="networkidle")
        page.wait_for_timeout(2000)

        # 尝试选择指定日期（如果页面有日期输入框或日历按钮）
        date_input = page.locator("input[type='date'], input[name*='date'], .date-picker input").first
        if date_input.count() > 0:
            date_input.fill(date_str)
            page.keyboard.press("Enter")
            page.wait_for_timeout(2000)

        # 扫描页面所有班次卡片与行数据
        items = page.locator(".train-item, tr, [class*='seat'], [class*='train'], [class*='schedule']").all()

        for item in items:
            text = item.inner_text().strip()
            if not text:
                continue

            # 提取班次时间（例如 10:30, 14:05）
            for part in text.split():
                if ":" in part and len(part) == 5:
                    try:
                        hour = int(part.split(":")[0])
                        if hour >= min_hour:
                            # 排除售罄状态，识别有票标记（○、△、有、残席）
                            is_sold_out = any(f in text for f in ["✕", "×", "完売", "満席", "Sold Out"])
                            is_available = any(f in text for f in ["○", "△", "残席", "空席", "予約", "Available"])
                            if is_available and not is_sold_out:
                                matched.append(f"{part}")
                    except ValueError:
                        pass
    except Exception as e:
        print(f"[{date_str}] 查询过程出现波动: {e}")

    return sorted(list(set(matched)))

def run():
    print("=== 开始执行多日期余票巡查 ===")
    overall_alerts = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        try:
            for date_str, min_hour in TARGET_RULES.items():
                print(f"正在扫描: {date_str} (>= {min_hour}:00)...")
                available_times = check_single_date(page, date_str, min_hour)
                if available_times:
                    trains_info = "、".join(available_times)
                    overall_alerts.append(f"{date_str}({trains_info})")
                    print(f"🎉 发现余票: {date_str} -> {trains_info}")
                else:
                    print(f"无票: {date_str} 暂无 {min_hour}:00 后的空位。")

            if overall_alerts:
                summary_content = "；".join(overall_alerts)
                send_bark(
                    "岚山小火车余票提醒",
                    f"刷出可用班次：{summary_content}，速登官网锁定！"
                )
            else:
                print("本次巡查结束，两目标日期均未见有效余票。")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
