import os
import re
import urllib.parse
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

# 监控目标：日期、显示名称、起始时间（包含）
TARGET_CONFIGS = [
    {"day": "5", "date": "2026-11-05", "label": "11月05日", "min_hour": 10},
    {"day": "24", "date": "2026-11-24", "label": "11月24日", "min_hour": 14},
]

CALENDAR_URL = "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL"

def build_direct_url(date_str: str) -> str:
    """生成原生日语参数的 2 人选座直达链接"""
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
        print(f"[スキップ] 未配置 BARK_KEY: {title} - {content}")
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
    """快速核验日历总状态（使用 domcontentloaded，防止网络探针导致超时）"""
    status_map = {}
    print(">>> 正在访问官网日历快速核验（防止超时模式）...")
    try:
        page.goto(CALENDAR_URL, timeout=20000, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        status_map = page.evaluate("""() => {
            const map = {};
            const elements = Array.from(document.querySelectorAll('*'));
            for (const el of elements) {
                const txt = (el.innerText || "").trim();
                if (el.children.length === 0 && txt) {
                    const parent = el.parentElement;
                    const grand = parent ? parent.parentElement : null;
                    const fullText = ((parent ? parent.innerText : "") + " " + (grand ? grand.innerText : "")).replace(/\\s+/g, ' ');
                    
                    for (let d = 1; d <= 31; d++) {
                        const reg = new RegExp('(?:^|\\\\s)' + d + '(?:\\\\s+|$)');
                        if (reg.test(fullText)) {
                            if (fullText.includes('○')) map[d.toString()] = '○';
                            else if (fullText.includes('△')) map[d.toString()] = '△';
                            else if (fullText.includes('×') || fullText.includes('✕')) {
                                if (!map[d.toString()]) map[d.toString()] = '×';
                            }
                        }
                    }
                }
            }
            return map;
        }""")
        print(f"日历状态获取成功: {status_map}")
    except Exception as e:
        print(f"日历页面快速扫描跳过（已做降级，直接通过直达通道排查）: {e}")
    
    return status_map

def handle_station_selection(page):
    """自动完成日语站名选定：トロッコ嵯峨 -> トロッコ亀岡"""
    # 尝试原生 select
    selects = page.locator("select").all()
    if len(selects) >= 2:
        try:
            selects[0].select_option(label="トロッコ嵯峨")
            selects[1].select_option(label="トロッコ亀岡")
        except Exception:
            pass

    # 处理 Linktivity 日语自定义下拉组件
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

    # 点击【次へ】推进到车次详情页
    next_btn = page.locator("button:has-text('次へ'), div:has-text('次へ')").last
    if next_btn.count() > 0 and next_btn.is_visible():
        next_btn.click(timeout=3000)
        page.wait_for_timeout(3000)

def check_train_details(page, config: dict) -> list:
    """进入列车详情，精准按照日语状态判断是否真正有余席"""
    date_str = config["date"]
    label = config["label"]
    min_hour = config["min_hour"]
    target_url = build_direct_url(date_str)

    page.goto(target_url, timeout=30000, wait_until="domcontentloaded")
    page.wait_for_timeout(2000)

    # 检查是否需要选站并点击【次へ】
    if "乗車駅を選択してください" in page.content() or page.locator("text='次へ'").count() > 0:
        handle_station_selection(page)

    try:
        page.wait_for_selector("text=/嵯峨野\\s*\\d+号/", timeout=12000)
    except Exception:
        page.wait_for_timeout(2000)

    # 解析车次卡片
    cards_data = page.evaluate("""() => {
        const results = [];
        const seen = new Set();
        const allEls = Array.from(document.querySelectorAll('*'));
        
        for (const el of allEls) {
            const txt = (el.innerText || "").trim();
            // 匹配日语列车名：嵯峨野1号、嵯峨野3号...
            const match = txt.match(/^嵯峨野\\s*\\d+号$/);
            if (match) {
                const name = match[0].replace(/\\s+/g, '');
                if (seen.has(name)) continue;

                // 寻找包含发车时间的独立卡片父容器
                let card = el.parentElement;
                while (card && card !== document.body) {
                    const cText = card.innerText || "";
                    if (/\\d{1,2}:\\d{2}/.test(cText)) break;
                    card = card.parentElement;
                }

                if (card && card !== document.body) {
                    seen.add(name);
                    const cardText = card.innerText || "";
                    
                    // 日语原生状态判定：
                    // 空席あり：○、◯、◎、△
                    // 満席・完売：×、✕、✖、満席、完売、受付終了
                    const hasAvailableMark = /[○◯◎△]/.test(cardText);
                    const hasSoldOutMark = /[×✕✖✗]|満席|完売|受付終了/.test(cardText);

                    results.push({
                        name: name,
                        rawText: cardText.replace(/\\s+/g, ' '),
                        hasAvailableMark: hasAvailableMark,
                        hasSoldOutMark: hasSoldOutMark
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

        # 真正有票的唯一准则：有 ○/△ 且绝无 ×/満席
        is_truly_available = item["hasAvailableMark"] and not item["hasSoldOutMark"]
        status_text = "【空席あり ○/△】" if is_truly_available else "【満席 ×】"
        print(f"  [{label}] {name} ({dep_time}発) -> {status_text}")

        if hour >= min_hour and is_truly_available:
            matched.append(f"{name}({dep_time}発)")

    return matched

def run():
    print("=== 嵯峨野トロッコ列車・空席状況監視システム起動 ===")
    alerts = []
    first_jump_url = CALENDAR_URL

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"]
        )
        # 全面适配日本本土浏览器环境与语言设置
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            extra_http_headers={
                "Accept-Language": "ja,ja-JP;q=0.9,en;q=0.8"
            },
            viewport={"width": 1280, "height": 800}
        )
        page = context.new_page()

        try:
            # 1. 尝试日历前置检查（抗超时）
            calendar_status = check_calendar_status(page)

            for config in TARGET_CONFIGS:
                day_key = config["day"]
                label = config["label"]
                cal_symbol = calendar_status.get(day_key, "未知")

                print(f"\n------------------------------------------")
                print(f"確認対象: {label} (カレンダー表示: 【{cal_symbol}】)")

                # 如果日历明确是 ×，绝不深入检索，直接跳过防误报
                if cal_symbol in ["×", "✕"]:
                    print(f"❌ {label} はカレンダー上で満席（×）です。スキップします。")
                    continue

                # 深入车次列表做严谨双重核验
                matched_trains = check_train_details(page, config)

                if matched_trains:
                    slots_str = "、".join(matched_trains)
                    print(f"🎉 {label} 条件合致の空席あり: {slots_str}")
                    alerts.append(f"{label}: {slots_str}")
                    if first_jump_url == CALENDAR_URL:
                        first_jump_url = build_direct_url(config["date"])
                else:
                    print(f"ℹ️ {label} は指定時間（{config['min_hour']}:00以降）の空席がありません。")

            # 汇总推送 Bark
            if alerts:
                content = "；".join(alerts)
                print(f"\n[通知送信]: {content}")
                send_bark(
                    "嵐山トロッコ空席通知(2名)",
                    f"空席発見：{content}！タップして予約へ！",
                    jump_url=first_jump_url
                )
            else:
                print("\n今回の確認では、条件に合う空席は見つかりませんでした。")

        finally:
            browser.close()

if __name__ == "__main__":
    run()
