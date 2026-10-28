import os
import re
import time
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

# 监控目标：日期、显示名称、起始时间（包含）
TARGET_CONFIGS = [
    {"day": "5", "label": "11月05日", "min_hour": 10},
    {"day": "24", "label": "11月24日", "min_hour": 14},
]

ACTIVITY_URL = "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL"

def send_bark(title: str, content: str, jump_url: str = ""):
    """向 iPhone 发送 Bark 强提醒"""
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

def ensure_november_calendar(page):
    """确保日历翻页切换到 11 月"""
    for _ in range(5):
        current_month = page.locator(".DateTable_dateTableCurrent_r3SWS").first.inner_text()
        if "11月" in current_month:
            print("✔ 已定位到 11 月日历！")
            return True
        print(f"当前月份显示为 [{current_month.strip()}]，点击向右箭头切换至 11 月...")
        next_btn = page.locator(".DateTable_dateTableNext_P9obZ").first
        if next_btn.count() > 0:
            next_btn.click()
            page.wait_for_timeout(1000)
        else:
            break
    return "11月" in page.locator(".DateTable_dateTableCurrent_r3SWS").first.inner_text()

def get_day_status(page, day_str: str) -> tuple:
    """根据真实 DOM 中的 SVG 图标（#icon-circle, #icon-triangle, #icon-close）提取状态"""
    day_button = page.locator(f".DateTable_dateTableDayButton_RqCPN:has(span:text-is('{day_str}'))").first
    if day_button.count() == 0:
        return "未找到", None

    is_disabled = day_button.get_attribute("disabled") is not None
    svg_use = day_button.locator("use").first
    icon_href = svg_use.get_attribute("xlink:href") or svg_use.get_attribute("href") or ""

    if "#icon-circle" in icon_href:
        return "○", day_button
    elif "#icon-triangle" in icon_href:
        return "△", day_button
    elif "#icon-close" in icon_href or is_disabled:
        return "×", day_button
    return "未知", day_button

def check_single_date(context, config: dict) -> list:
    day_str = config["day"]
    label = config["label"]
    min_hour = config["min_hour"]

    print(f"\n==========================================")
    print(f"【开始检测】{label} (筛选 >= {min_hour}:00 班次，人数: 2人)")

    page = context.new_page()
    matched_trains = []

    try:
        page.goto(ACTIVITY_URL, timeout=35000, wait_until="domcontentloaded")
        page.wait_for_selector(".DateTable_dateTableCurrent_r3SWS", timeout=15000)
        page.wait_for_timeout(1500)

        # 1. 确保翻到 11 月日历
        if not ensure_november_calendar(page):
            print("❌ 无法切换到 11 月日历")
            return []

        # 2. 检查当天在 11 月日历上的真实 SVG 状态
        status, day_btn = get_day_status(page, day_str)
        print(f"日历状态确认: {label} 真实标识为 【{status}】")

        if status == "×":
            print(f"❌ {label}：日历明确显示为售罄（×），直接跳过。")
            return []
        elif status not in ["○", "△"]:
            print(f"⚠️ {label} 状态非空席（{status}），跳过。")
            return []

        # 3. 点击该日期
        print(f"🖱️ 点击 11 月日历中的 [{day_str}号]...")
        day_btn.click()
        page.wait_for_timeout(1000)

        # 4. 选择路线：嵯峨駅／嵐山駅 → 亀岡駅
        print("🖱️ 选择路线：嵯峨駅／嵐山駅 → 亀岡駅...")
        route_btn = page.locator(".PlanPicker_planPicker_KCJLc:has-text('嵯峨駅')").first
        route_btn.click()
        page.wait_for_timeout(1000)

        # 5. 调整人数至 2 人
        print("🖱️ 调整人数：将大人增加至 2 人...")
        adult_row = page.locator(".SelectUnit_amount_mRV4q:has-text('大人')").first
        adult_input = adult_row.locator("input.InputNumber_input_a8d5e").first
        plus_btn = adult_row.locator(".InputNumber_button_msWmE:has(use[*|href*='plus'])").first
        if plus_btn.count() == 0:
            plus_btn = adult_row.locator(".InputNumber_button_msWmE").last

        # 点击加号直至人数为 2
        for _ in range(5):
            val = adult_input.input_value()
            if val == "2":
                break
            plus_btn.click()
            page.wait_for_timeout(500)

        print(f"当前大人数量确认: {adult_input.input_value()} 人")
        page.wait_for_timeout(1000)

        # 6. 点击【予約手続きへ】推进到车次详情页
        print("🖱️ 点击【予約手続きへ】进入车次详情...")
        submit_btn = page.locator("button.ActivityItem_bookingButton_rLGbb.Button_primary_lkUmG:has-text('予約手続きへ')").first
        if submit_btn.count() == 0:
            submit_btn = page.locator("button:has-text('予約手続きへ')").first

        old_pages_count = len(context.pages)
        submit_btn.click()
        page.wait_for_timeout(4000)

        # 处理可能弹出的新标签页
        active_page = page
        if len(context.pages) > old_pages_count:
            active_page = context.pages[-1]
            active_page.bring_to_front()

        # 等待车次列表加载
        try:
            active_page.wait_for_selector("text=/嵯峨野\\s*\\d+号|列車を選択してください/", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(2000)

        # 7. 提取可用车次
        trains_data = active_page.evaluate("""() => {
            const list = [];
            const seen = new Set();
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
                const txt = (node.nodeValue || '').trim();
                const m = txt.match(/^嵯峨野\\s*(\\d+)号$/);
                if (m) {
                    const name = m[0].replace(/\\s+/g, '');
                    if (seen.has(name)) continue;

                    let card = node.parentElement;
                    while (card && card !== document.body) {
                        const cText = (card.innerText || card.textContent || '');
                        if (/\\d{1,2}:\\d{2}/.test(cText)) break;
                        card = card.parentElement;
                    }

                    if (card && card !== document.body) {
                        seen.add(name);
                        const cText = (card.innerText || card.textContent || '').replace(/\\s+/g, ' ');
                        const times = cText.match(/\\b\\d{1,2}:\\d{2}\\b/g) || [];
                        const depTime = times[0] || '';

                        const hasCircle = cText.includes('○') || cText.includes('△');
                        const hasCross = cText.includes('×') || cText.includes('✕') || cText.includes('満席') || (card.className || '').toLowerCase().includes('disabled');

                        list.push({
                            name: name,
                            depTime: depTime,
                            isAvailable: hasCircle && !hasCross,
                            raw: cText
                        });
                    }
                }
            }
            return list;
        }""")

        for item in trains_data:
            dep_time = item["depTime"]
            name = item["name"]
            is_avail = item["isAvailable"]
            if not dep_time:
                continue

            try:
                hour = int(dep_time.split(":")[0])
            except ValueError:
                continue

            status_str = "有余票(○/△)" if is_avail else "满席(×)"

            if hour >= min_hour:
                print(f"  -> {dep_time} {name} | 状态: {status_str} | 条件: 符合(>= {min_hour}:00)")
                if is_avail:
                    matched_trains.append(f"{name}({dep_time}发)")
            else:
                print(f"  -> {dep_time} {name} | 状态: {status_str} | 条件: 跳过(早于 {min_hour}:00)")

    except Exception as e:
        print(f"[{label}] 排查出现异常: {e}")
    finally:
        page.close()

    return matched_trains

def run():
    print("=== 启动嵯峨野小火车余票智能巡查系统（真实 DOM 定制版） ===")
    alerts = []

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
                trains = check_single_date(context, config)
                if trains:
                    t_str = "、".join(trains)
                    print(f"🎉【命中有效余票】{config['label']}: {t_str}")
                    alerts.append(f"{config['label']}: {t_str}")
                else:
                    print(f"ℹ️【未见有效余票】{config['label']} 暂无符合时段的空位。")

            if alerts:
                summary = "；".join(alerts)
                print(f"\n[触发推送]: {summary}")
                send_bark(
                    "岚山小火车有票提醒(2人)",
                    f"刷出可用班次：{summary}，速登官网预订！",
                    jump_url=ACTIVITY_URL
                )
            else:
                print("\n本次巡查结束，两日期在设定时段内均无可用余票。")

        finally:
            browser.close()

if __name__ == "__main__":
    run()
