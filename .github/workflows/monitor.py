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
        page.goto(target_url, timeout=45000, wait_until="domcontentloaded")
        
        # 等待页面车次列表区域加载
        try:
            page.wait_for_selector("text=列車を選択してください", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(3000)

        # 通过 TreeWalker 精准定位每趟车，互不干扰
        train_cards = page.evaluate("""() => {
            const results = [];
            const seen = new Set();
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
                const text = node.nodeValue.trim();
                const match = text.match(/嵯峨野\\s*\\d+号/);
                if (match) {
                    const trainName = match[0].replace(/\\s+/g, '');
                    if (seen.has(trainName)) continue;
                    
                    // 向上寻找只包含这趟车信息的最小卡片容器
                    let card = node.parentElement;
                    while (card && card !== document.body) {
                        const cText = card.innerText || "";
                        if (/\\d{1,2}:\\d{2}/.test(cText) && (cText.includes("空席") || cText.includes("満席") || cText.includes("○") || cText.includes("×") || cText.includes("△"))) {
                            break;
                        }
                        card = card.parentElement;
                    }
                    
                    if (card && card !== document.body) {
                        seen.add(trainName);
                        results.push({
                            name: trainName,
                            cardText: card.innerText
                        });
                    }
                }
            }
            return results;
        }""")

        if not train_cards:
            print(f"⚠️ 未解析到车次卡片，当前页面文字摘要:\n{page.locator('body').inner_text()[:200]}")
            return [], target_url

        for item in train_cards:
            name = item["name"]
            c_text = item["cardText"]
            
            # 卡片中的第一个时间为发车时间
            times = re.findall(r"\b(\d{1,2}:\d{2})\b", c_text)
            if not times:
                continue
            dep_time = times[0]
            
            # 状态判定
            is_sold_out = any(k in c_text for k in ["×", "✕", "満席", "完売"])
            is_available = (any(k in c_text for k in ["○", "△", "空席"]) and not is_sold_out)
            
            status_desc = "有余票" if is_available else "无票/满席"
            print(f"  [{label}] 班次: {dep_time} {name} | 状态: {status_desc}")

            try:
                hour = int(dep_time.split(":")[0])
                if hour >= min_hour and is_available:
                    matched_trains.append(f"{dep_time}({name})")
            except ValueError:
                pass

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
