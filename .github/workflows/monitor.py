import os
import re
import urllib.parse
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

# 监控目标配置：日期、中文标签、起始时间（包含）、最低人数
TARGET_CONFIGS = [
    {"date": "2026-11-05", "label": "11月05日", "min_hour": 10},
    {"date": "2026-11-24", "label": "11月24日", "min_hour": 14},
]

def build_direct_url(date_str: str) -> str:
    """生成选定 2 人、嵯峨野到龟冈方向的选座页面直达链接"""
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
    """向 iPhone 发送 Bark 通知并附带直达抢票链接"""
    if not BARK_KEY:
        print(f"[提示] 未配置 BARK_KEY，跳过推送：{title} - {content}")
        return
    url = f"https://api.day.app/{BARK_KEY}/{title}/{content}?sound=bell&level=timeSensitive&group=sagano"
    if jump_url:
        url += f"&url={urllib.parse.quote(jump_url, safe='')}"
    try:
        resp = requests.get(url, timeout=5)
        print(f"Bark 推送状态码: {resp.status_code}")
    except Exception as e:
        print(f"Bark 推送失败: {e}")

def check_date_tickets(context, config: dict) -> tuple:
    """针对单一日期进行排查，使用全新页面防止 DOM 缓存污染"""
    date_str = config["date"]
    label = config["label"]
    min_hour = config["min_hour"]
    target_url = build_direct_url(date_str)

    print(f"\n==========================================")
    print(f"【开始检测】{label} (筛选 >= {min_hour}:00 班次，人数: 2人)")
    print(f"请求地址: {target_url}")

    matched_trains = []
    # 为每个日期建立全新的独立页面，彻底避免上一个日期的缓存干扰
    page = context.new_page()

    try:
        page.goto(target_url, timeout=35000, wait_until="domcontentloaded")
        
        # 页面初始化缓冲（等待系统异步请求返回车次数据）
        page.wait_for_timeout(3000)

        # 真实页面状态判断 1：检查是否全天无票
        # 当全天无余位时，系统停留在选站且没有车次列表，绝对不能去点禁用的按钮
        has_train_section = page.locator("text='列車を選択してください'").count() > 0 or \
                            page.locator("text=/嵯峨野\\s*\\d+号/").count() > 0

        if not has_train_section:
            print(f"❌ {label}：页面未加载出任何车次列表（当前全天售罄/无2人余位）")
            return [], target_url

        print(f"✔ {label}：成功加载到车次列表，正在逐一分析各班次...")

        # 真实页面状态判断 2：精准抓取各班次卡片
        train_items = page.evaluate("""() => {
            const results = [];
            const seen = new Set();
            const elements = Array.from(document.querySelectorAll('*'));
            
            for (const el of elements) {
                const txt = (el.innerText || "").trim();
                const match = txt.match(/^嵯峨野\\s*(\\d+)号$/);
                if (match) {
                    const name = match[0].replace(/\\s+/g, '');
                    if (seen.has(name)) continue;

                    // 向上查找包含发车时间及状态的最小外层容器
                    let card = el.parentElement;
                    while (card && card !== document.body) {
                        const cardText = card.innerText || "";
                        if (/\\d{1,2}:\\d{2}/.test(cardText)) break;
                        card = card.parentElement;
                    }

                    if (card && card !== document.body) {
                        seen.add(name);
                        const cText = card.innerText || "";
                        const cHtml = card.innerHTML || "";
                        
                        // 严格判断状态：
                        // 有票标志：○、◯、◎、△
                        // 售罄标志：×、✕、✖、満席、完売，或带有 disabled 样式
                        const hasAvailable = /[○◯◎△]/.test(cText) || cHtml.includes("circle");
                        const hasSoldOut = /[×✕✖✗]|満席|完売/.test(cText) || 
                                           card.className.toLowerCase().includes("disabled");

                        results.push({
                            name: name,
                            raw: cText.replace(/\\s+/g, ' '),
                            isAvailable: hasAvailable && !hasSoldOut
                        });
                    }
                }
            }
            return results;
        }""")

        for item in train_items:
            name = item["name"]
            raw = item["raw"]
            times = re.findall(r"\b(\d{1,2}:\d{2})\b", raw)
            if not times:
                continue

            dep_time = times[0]  # 第一个时间为发车时间
            try:
                hour = int(dep_time.split(":")[0])
            except ValueError:
                continue

            is_avail = item["isAvailable"]
            status_text = "有票(○/△)" if is_avail else "满席(×)"

            # 判断时段条件
            if hour >= min_hour:
                print(f"  -> {dep_time} {name} | 状态: {status_text} | 目标时段: 符合 (>= {min_hour}:00)")
                if is_avail:
                    matched_trains.append(f"{dep_time}({name})")
            else:
                print(f"  -> {dep_time} {name} | 状态: {status_text} | 目标时段: 跳过 (早于 {min_hour}:00)")

    except Exception as e:
        print(f"[{label}] 检测过程发生异常: {e}")
    finally:
        page.close()

    return matched_trains, target_url

def run():
    print("=== 启动岚山嵯峨野小火车余票智能监控 ===")
    alerts = []
    first_jump_url = ""

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            extra_http_headers={"Accept-Language": "ja,ja-JP;q=0.9,en;q=0.8"},
            viewport={"width": 1280, "height": 800}
        )

        try:
            for config in TARGET_CONFIGS:
                matched, direct_url = check_date_tickets(context, config)
                if matched:
                    train_str = "、".join(matched)
                    print(f"🎉【命中余票】{config['label']}: {train_str}")
                    alerts.append(f"{config['label']}: {train_str}")
                    if not first_jump_url:
                        first_jump_url = direct_url
                else:
                    print(f"ℹ️【未见余票】{config['label']} 在要求时段内暂无可用座位。")

            # 汇总推送
            if alerts:
                summary = "；".join(alerts)
                print(f"\n[触发 Bark 推送]: {summary}")
                send_bark(
                    "岚山小火车有票提醒(2人)",
                    f"刷出可用班次：{summary}，点击直接进预订页抢票！",
                    jump_url=first_jump_url
                )
            else:
                print("\n本次巡查结束：两目标时段均无有效余票，不发送干扰通知。")

        finally:
            browser.close()

if __name__ == "__main__":
    run()
