import os
import re
import time
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

TARGET_CONFIGS = [
    {"day": "5", "label": "11月05日", "min_hour": 10},
    {"day": "24", "label": "11月24日", "min_hour": 14},
]

ACTIVITY_URL = "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL"

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
        page.wait_for_timeout(3000)

        # 检查日历状态
        cal_info = page.evaluate("""(day) => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (const el of elements) {
                if (el.children.length === 0 && el.innerText.trim() === day) {
                    let parent = el.parentElement;
                    while (parent && parent !== document.body) {
                        const txt = parent.innerText || '';
                        if (txt.includes('○') || txt.includes('△') || txt.includes('×') || txt.includes('✕')) {
                            let mark = '未知';
                            if (txt.includes('○')) mark = '○';
                            else if (txt.includes('△')) mark = '△';
                            else if (txt.includes('×') || txt.includes('✕')) mark = '×';
                            return { found: true, mark: mark };
                        }
                        parent = parent.parentElement;
                    }
                }
            }
            return { found: false, mark: '未知' };
        }""", day_str)

        mark = cal_info.get("mark", "未知")
        print(f"日历状态确认: {label} 显示为 【{mark}】")

        if mark in ["×", "✕"]:
            print(f"❌ {label}：日历明确显示为售罄（×），跳过。")
            return []

        # 点击日期
        print(f"🖱️ 尝试点击日历 [{day_str}号]...")
        day_btn = page.locator(f"xpath=//*[text()='{day_str}']/ancestor::*[contains(., '○') or contains(., '△')][1]").last
        if day_btn.count() == 0:
            day_btn = page.locator(f"text='{day_str}'").first
        day_btn.click()
        page.wait_for_timeout(1000)

        # 选择路线
        print("🖱️ 选择路线：嵯峨駅／嵐山駅 → 亀岡駅...")
        route_btn = page.locator("text=/嵯峨駅.*亀岡駅/").first
        if route_btn.count() == 0:
            route_btn = page.locator("text*='嵯峨'").first
        route_btn.click()
        page.wait_for_timeout(1000)

        # 增加至2人
        print("🖱️ 调整人数至 2 人...")
        page.evaluate("""() => {
            const labels = Array.from(document.querySelectorAll('*')).filter(e => e.innerText && e.innerText.includes('大人') && e.innerText.includes('12歳'));
            if (labels.length > 0) {
                let row = labels[labels.length - 1].parentElement;
                while (row && row !== document.body) {
                    if (row.innerText.includes('+') && row.innerText.includes('-')) break;
                    row = row.parentElement;
                }
                if (row) {
                    const plusBtn = Array.from(row.querySelectorAll('*')).reverse().find(b => b.innerText && b.innerText.trim() === '+');
                    if (plusBtn) {
                        plusBtn.click();
                        plusBtn.click();
                    }
                }
            }
        }""")
        page.wait_for_timeout(1000)

        # 点击预约
        print("🖱️ 点击【予約手続きへ】...")
        submit_btn = page.locator("button:has-text('予約手続きへ'), div:has-text('予約手続きへ')").first
        if submit_btn.count() == 0:
            submit_btn = page.locator("text='今すぐ予約'").first

        old_pages_count = len(context.pages)
        submit_btn.click()
        page.wait_for_timeout(4000)

        # 判断是否进入新页面
        active_page = page
        if len(context.pages) > old_pages_count:
            active_page = context.pages[-1]
            active_page.bring_to_front()

        print(f"👉 当前步骤所在的真实 URL: {active_page.url}")
        body_snippet = active_page.locator("body").inner_text()[:400].replace("\n", " ")
        print(f"👉 当前页面文本切片: {body_snippet}")

        # 解析车次
        trains_data = active_page.evaluate("""() => {
            const list = [];
            const seen = new Set();
            const allNodes = Array.from(document.querySelectorAll('*'));
            for (const el of allNodes) {
                const txt = (el.innerText || "").trim();
                const m = txt.match(/^嵯峨野\\s*(\\d+)号$/);
                if (m) {
                    const name = m[0].replace(/\\s+/g, '');
                    if (seen.has(name)) continue;

                    let card = el.parentElement;
                    while (card && card !== document.body) {
                        const cText = card.innerText || "";
                        if (/\\d{1,2}:\\d{2}/.test(cText)) break;
                        card = card.parentElement;
                    }

                    if (card && card !== document.body) {
                        seen.add(name);
                        const cText = card.innerText || "";
                        const times = cText.match(/\\b\\d{1,2}:\\d{2}\\b/g) || [];
                        list.push({
                            name: name,
                            depTime: times[0] || "",
                            isAvailable: (cText.includes("○") || cText.includes("△")) && !(cText.includes("×") || cText.includes("満席")),
                            raw: cText.replace(/\\s+/g, ' ')
                        });
                    }
                }
            }
            return list;
        }""")

        print(f"👉 解析到的原始车次数量: {len(trains_data)}")
        for item in trains_data:
            dep_time = item["depTime"]
            name = item["name"]
            is_avail = item["isAvailable"]
            if not dep_time:
                continue
            try:
                hour = int(dep_time.split(":")[0])
                print(f"  -> {dep_time} {name} | 状态: {'有票(○/△)' if is_avail else '满席(×)'}")
                if hour >= min_hour and is_avail:
                    matched_trains.append(f"{name}({dep_time}发)")
            except ValueError:
                pass

    except Exception as e:
        print(f"[{label}] 异常: {e}")
    finally:
        page.close()

    return matched_trains

def run():
    print("=== 启动嵯峨野小火车余票真实巡查系统 (诊断增强版) ===")
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
                    alerts.append(f"{config['label']}: {'、'.join(trains)}")

            if alerts:
                summary = "；".join(alerts)
                print(f"\n🎉 命中余票: {summary}")
                send_bark("岚山小火车有票提醒(2人)", f"刷出可用班次：{summary}，速登官网预订！", jump_url=ACTIVITY_URL)
            else:
                print("\n未检测到符合条件的余票。")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
