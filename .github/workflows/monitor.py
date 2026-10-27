import os
import re
import urllib.parse
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

# 监控目标：日期、显示名称、起始时间（包含）
TARGET_CONFIGS = [
    {"date": "2026-11-05", "label": "11月05日", "min_hour": 10},
    {"date": "2026-11-24", "label": "11月24日", "min_hour": 14},
]

def build_direct_url(date_str: str) -> str:
    """生成带完整参数的 2 人选座直达链接"""
    base_url = "https://file.sagano.linktivity.io/seat/51/down"
    params = {
        "lang": "ja",
        "date": date_str,
        "unitsCount": "2",
        "backUrl": "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL",
        "redirectUrl": "https://ars-saganokanko.triplabo.jp/booking/pay",
        "currentStep": "station"
    }
    return f"{base_url}?{urllib.parse.urlencode(params)}"

def send_bark(title: str, content: str, jump_url: str = ""):
    """向 iPhone Bark 发送强提醒并附带直达抢票链接"""
    if not BARK_KEY:
        print(f"[提示] 未配置 BARK_KEY，跳过推送：{title} - {content}")
        return
    url = f"https://api.day.app/{BARK_KEY}/{title}/{content}?sound=bell&level=timeSensitive&group=sagano"
    if jump_url:
        url += f"&url={urllib.parse.quote(jump_url, safe='')}"
    try:
        resp = requests.get(url, timeout=5)
        print(f"Bark 推送状态: {resp.status_code}")
    except Exception as e:
        print(f"Bark 推送失败: {e}")

def check_date(page, config: dict):
    date_str = config["date"]
    label = config["label"]
    min_hour = config["min_hour"]
    target_url = build_direct_url(date_str)

    print(f"\n==========================================")
    print(f"正在检测: {label} (筛选 >= {min_hour}:00 班次，2 人票)")
    print(f"访问地址: {target_url}")

    matched_trains = []

    try:
        page.goto(target_url, timeout=35000, wait_until="networkidle")
        # 等待车次卡片加载完成
        try:
            page.wait_for_selector("text=/嵯峨野\\s*\\d+号/", timeout=10000)
        except Exception:
            page.wait_for_timeout(3000)

        # 抓取页面上包含车次信息的所有卡片
        train_cards = page.evaluate("""() => {
            const list = [];
            const elements = document.querySelectorAll('*');
            for (const el of elements) {
                const text = el.innerText || "";
                // 精准匹配包含列车名、时间与状态的容器块
                if (/嵯峨野\\s*\\d+号/.test(text) && /\\d{1,2}:\\d{2}/.test(text) && (text.includes("○") || text.includes("×") || text.includes("△") || text.includes("空席") || text.includes("満席"))) {
                    // 只取最内层的独立车次块
                    if (!el.querySelector('*[class*="train"], *[class*="seat"], div') || el.children.length <= 6) {
                        list.push(text.replace(/\\s+/g, ' ').trim());
                    }
                }
            }
            return Array.from(new Set(list));
        }""")

        seen_slots = set()
        for text in train_cards:
            times = re.findall(r"\b(\d{1,2}:\d{2})\b", text)
            train_names = re.findall(r"嵯峨野\s*\d+号", text)
            if not times or not train_names:
                continue

            dep_time = times[0]
            train_name = train_names[0]
            slot_key = f"{dep_time}_{train_name}"
            if slot_key in seen_slots:
                continue
            seen_slots.add(slot_key)

            hour = int(dep_time.split(":")[0])
            is_sold_out = any(k in text for k in ["×", "✕", "満席", "完売"])
            is_available = (any(k in text for k in ["○", "△", "空席"]) and not is_sold_out)

            print(f"  [{label}] 班次: {dep_time} {train_name} | 状态: {'有余票' if is_available else '无票/满席'}")

            if hour >= min_hour and is_available:
                matched_trains.append(f"{dep_time}({train_name})")

    except Exception as e:
        print(f"[{label}] 抓取异常: {e}")

    return matched_trains, target_url

def run():
    print("=== 启动嵯峨野小火车余票检测（直连 Linktivity 2人通道） ===")
    alerts = []
    jump_link = ""

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )
        page = context.new_page()

        try:
            for config in TARGET_CONFIGS:
                matched, direct_url = check_date(page, config)
                if matched:
                    slots_str = "、".join(matched)
                    alerts.append(f"{config['label']}: {slots_str}")
                    if not jump_link:
                        jump_link = direct_url

            if alerts:
                summary = "；".join(alerts)
                print(f"\n🎉 抓到目标余票: {summary}")
                send_bark(
                    "岚山小火车有票提醒(2人)",
                    f"刷出可用班次：{summary}，点击立刻选座！",
                    jump_url=jump_link
                )
            else:
                print("\n本次巡查结束，未发现符合时段要求的余票。")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
