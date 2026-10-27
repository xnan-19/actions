import os
import re
import urllib.parse
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

# 监控目标配置
TARGET_CONFIGS = [
    {"day": "5", "date": "2026-11-05", "label": "11月05日", "min_hour": 10},
    {"day": "24", "date": "2026-11-24", "label": "11月24日", "min_hour": 14},
]

CALENDAR_URL = "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL"

def build_direct_url(date_str: str) -> str:
    base_url = "https://file.sagano.linktivity.io/seat/51/down"
    params = {
        "lang": "ja",
        "date": date_str,
        "unitsCount": "2",
        "backUrl": CALENDAR_URL,
        "redirectUrl": "https://ars-saganokanko.triplabo.jp/booking/pay",
        "currentStep": "station"
    }
    return f"{base_url}?{urllib.parse.urlencode(params)}"

def send_bark(title: str, content: str, jump_url: str = ""):
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

def check_calendar_status(page) -> dict:
    """第一道防线：读取主页日历状态（○ 有票，△ 紧张，× 售罄）"""
    print(">>> 正在访问官网日历核验每日总状态...")
    page.goto(CALENDAR_URL, timeout=45000, wait_until="networkidle")
    page.wait_for_timeout(2500)

    # 提取日历中各天的符号
    calendar_data = page.evaluate("""() => {
        const statusMap = {};
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
            const text = (el.innerText || "").trim();
            // 匹配格式如：日期数字紧跟状态符号，或同一单元格内包含日期和符号
            if (el.children.length === 0 && text) {
                // 向上两层寻找日历格子
                const parent = el.parentElement;
                const grand = parent ? parent.parentElement : null;
                const containerText = ((parent ? parent.innerText : "") + " " + (grand ? grand.innerText : "")).replace(/\\s+/g, ' ');
                
                for (let d = 1; d <= 31; d++) {
                    const regex = new RegExp('(?:^|\\\\s)' + d + '(?:\\\\s+|$)');
                    if (regex.test(containerText)) {
                        if (containerText.includes('○')) statusMap[d.toString()] = '○';
                        else if (containerText.includes('△')) statusMap[d.toString()] = '△';
                        else if (containerText.includes('×') || containerText.includes('✕')) {
                            if (!statusMap[d.toString()]) statusMap[d.toString()] = '×';
                        }
                    }
                }
            }
        }
        return statusMap;
    }""")
    print(f"日历状态抓取结果: {calendar_data}")
    return calendar_data

def handle_station_selection(page):
    """自动完成车站选择并推进到车次详情"""
    selects = page.locator("select").all()
    if len(selects) >= 2:
        try:
            selects[0].select_option(label="トロッコ嵯峨")
            selects[1].select_option(label="トロッコ亀岡")
        except Exception:
            pass

    # 处理自定义下拉
    dep_btn = page.locator("text='乗車駅を選択してください'").first
    if dep_btn.count() > 0 and dep_btn.is_visible():
        try:
            dep_btn.click(timeout=2000)
        except Exception:
            dep_btn.locator("..").click(timeout=2000)
        page.wait_for_timeout(500)
        page.locator("text='トロッコ嵯峨'").last.click(timeout=2000)
        page.wait_for_timeout(500)

    arr_btn = page.locator("text='降車駅を選択してください'").first
    if arr_btn.count() > 0 and arr_btn.is_visible():
        try:
            arr_btn.click(timeout=2000)
        except Exception:
            arr_btn.locator("..").click(timeout=2000)
        page.wait_for_timeout(500)
        page.locator("text='トロッコ亀岡'").last.click(timeout=2000)
        page.wait_for_timeout(500)

    next_btn = page.locator("button:has-text('次へ'), div:has-text('次へ')").last
    if next_btn.count() > 0 and next_btn.is_visible():
        next_btn.click(timeout=3000)
        page.wait_for_timeout(3000)

def check_train_details(page, config: dict) -> list:
    """第二道防线：精准解析车次与 ○ / △ 状态"""
    date_str = config["date"]
    label = config["label"]
    min_hour = config["min_hour"]
    target_url = build_direct_url(date_str)

    page.goto(target_url, timeout=45000, wait_until="domcontentloaded")
    page.wait_for_timeout(2000)

    if "乗車駅を選択してください" in page.content() or page.locator("text='次へ'").count() > 0:
        handle_station_selection(page)

    try:
        page.wait_for_selector("text=/嵯峨野\\s*\\d+号/", timeout=10000)
    except Exception:
        page.wait_for_timeout(2000)

    # 提取真实 DOM 中的列车卡片
    cards_data = page.evaluate("""() => {
        const results = [];
        const seen = new Set();
        const allEls = Array.from(document.querySelectorAll('*'));
        
        for (const el of allEls) {
            const txt = (el.innerText || "").trim();
            const match = txt.match(/^嵯峨野\\s*\\d+号$/);
            if (match) {
                const name = match[0].replace(/\\s+/g, '');
                if (seen.has(name)) continue;

                // 寻找包含发车时间的卡片父容器
                let card = el.parentElement;
                while (card && card !== document.body) {
                    const cText = card.innerText || "";
                    if (/\\d{1,2}:\\d{2}/.test(cText)) break;
                    card = card.parentElement;
                }

                if (card && card !== document.body) {
                    seen.add(name);
                    const cardText = card.innerText || "";
                    const cardHtml = card.innerHTML || "";
                    
                    // 严格检测：必须包含 ○ 或 △，且不能包含 ×、✕、満席、disabled
                    const hasCircle = cardText.includes("○") || cardText.includes("△") || cardHtml.includes("circle");
                    const hasCross = cardText.includes("×") || cardText.includes("✕") || cardText.includes("✖") || 
                                     cardText.includes("満席") || cardText.includes("完売") ||
                                     card.className.toLowerCase().includes("disabled") ||
                                     card.getAttribute("disabled") !== null;

                    results.push({
                        name: name,
                        rawText: cardText.replace(/\\s+/g, ' '),
                        hasCircle: hasCircle,
                        hasCross: hasCross
                    });
                }
            }
        }
        return results;
    }""")

    matched = []
    for item in cards_data:
        raw = item["rawText"]
        name = item["name"]
        times = re.findall(r"\b(\d{1,2}:\d{2})\b", raw)
        if not times:
            continue
        dep_time = times[0]
        hour = int(dep_time.split(":")[0])

        # 真正有票的标准：有圈/三角，且绝无叉号/禁用
        is_truly_available = item["hasCircle"] and not item["hasCross"]
        status_text = "有余票(○/△)" if is_truly_available else "无票/满席(×)"
        print(f"  [{label}] 班次: {dep_time} {name} | 状态: {status_text} | 原始摘要: {raw[:40]}")

        if hour >= min_hour and is_truly_available:
            matched.append(f"{dep_time}({name})")

    return matched

def run():
    print("=== 启动嵯峨野小火车严谨余票巡查 ===")
    alerts = []
    first_jump_url = CALENDAR_URL

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
            # 1. 第一步先查日历总表
            calendar_status = check_calendar_status(page)

            for config in TARGET_CONFIGS:
                day_key = config["day"]
                label = config["label"]
                cal_symbol = calendar_status.get(day_key, "未知")

                print(f"\n------------------------------------------")
                print(f"排查目标: {label} (日历当前标记: 【{cal_symbol}】)")

                # 如果日历明确显示 ×（满席），坚决不进详情页，避免任何误报
                if cal_symbol in ["×", "✕"]:
                    print(f"❌ {label} 日历明确显示为售罄（×），跳过车次检索，确定无票。")
                    continue

                # 只有日历显示 ○ 或 △ 时，才进一步进入车次列表核查时间段
                print(f"✔ {label} 日历显示有位（{cal_symbol}），深入检索符合时段的车次...")
                matched_trains = check_train_details(page, config)

                if matched_trains:
                    slots_str = "、".join(matched_trains)
                    print(f"🎉 {label} 命中有效车次: {slots_str}")
                    alerts.append(f"{label}: {slots_str}")
                    if first_jump_url == CALENDAR_URL:
                        first_jump_url = build_direct_url(config["date"])
                else:
                    print(f"ℹ️ {label} 虽有余位，但未在要求时段（>={config['min_hour']}:00）找到符合车次。")

            # 汇总推送
            if alerts:
                content = "；".join(alerts)
                print(f"\n[真实余票报警]: {content}")
                send_bark("岚山小火车有票提醒", f"刷出可用班次：{content}，速去选座！", jump_url=first_jump_url)
            else:
                print("\n本次巡查结束：未发现符合时段的有效余票。")

        finally:
            browser.close()

if __name__ == "__main__":
    run()
