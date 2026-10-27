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

def check_single_date(context, config: dict) -> list:
    day_str = config["day"]
    label = config["label"]
    min_hour = config["min_hour"]

    print(f"\n==========================================")
    print(f"【开始检测】{label} (筛选 >= {min_hour}:00 班次，人数: 2人)")

    # 每个日期使用独立的全新页面
    page = context.new_page()
    matched_trains = []

    try:
        page.goto(ACTIVITY_URL, timeout=35000, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        # 1. 在日历上检查该日期的真实标识（○ / △ / ×）
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

        # 24号为 × 时，直接判定售罄，绝对不产生误报
        if mark in ["×", "✕"]:
            print(f"❌ {label}：日历明确显示为售罄（×），符合真实页面情况，直接跳过。")
            return []

        # 2. 模拟点击日历中的该日期（如 5 号）
        print(f"🖱️ 点击日历中的 [{day_str}号]...")
        day_btn = page.locator(f"xpath=//*[text()='{day_str}']/ancestor::*[contains(., '○') or contains(., '△')][1]").last
        if day_btn.count() == 0:
            day_btn = page.locator(f"text='{day_str}'").first
        day_btn.click()
        page.wait_for_timeout(1000)

        # 3. 模拟点击路线：“嵯峨駅／嵐山駅 → 亀岡駅”
        print("🖱️ 选择路线：【嵯峨駅／嵐山駅 → 亀岡駅】...")
        route_btn = page.locator("text=/嵯峨駅.*亀岡駅/").first
        if route_btn.count() == 0:
            route_btn = page.locator("text*='嵯峨'").first
        route_btn.click()
        page.wait_for_timeout(1000)

        # 4. 模拟将大人人数增加至 2 人
        print("🖱️ 调整人数：将大人增加至 2 人...")
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
                        // 确保点击增加到 2
                        plusBtn.click();
                        plusBtn.click();
                    }
                }
            }
        }""")
        page.wait_for_timeout(1000)

        # 5. 点击底部的【予約手続きへ】进入车次详情
        print("🖱️ 点击【予約手続きへ】进入列车选择页...")
        submit_btn = page.locator("button:has-text('予約手続きへ'), div:has-text('予約手続きへ')").first
        if submit_btn.count() == 0:
            submit_btn = page.locator("text='今すぐ予約'").first

        old_count = len(context.pages)
        submit_btn.click()
        page.wait_for_timeout(3500)

        # 获取活动页面（如果是弹窗则切换到新标签页）
        target_page = page
        if len(context.pages) > old_count:
            target_page = context.pages[-1]
            target_page.bring_to_front()

        # 等待车次列表渲染
        try:
            target_page.wait_for_selector("text=/嵯峨野\\s*\\d+号|列車を選択してください/", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(2000)

        # 6. 解析车次卡片状态与发车时间
        trains_data = target_page.evaluate("""() => {
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
                        if (/\\d{1,2}:\\d{2}/.test(cText) && (cText.includes("○") || cText.includes("△") || cText.includes("×") || cText.includes("✕") || cText.includes("満席"))) {
                            break;
                        }
                        card = card.parentElement;
                    }

                    if (card && card !== document.body) {
                        seen.add(name);
                        const cText = card.innerText || "";
                        const times = cText.match(/\\b\\d{1,2}:\\d{2}\\b/g) || [];
                        const depTime = times[0] || "";

                        const hasCircle = cText.includes("○") || cText.includes("△");
                        const hasCross = cText.includes("×") || cText.includes("✕") || cText.includes("満席") || card.className.toLowerCase().includes("disabled");

                        list.push({
                            name: name,
                            depTime: depTime,
                            isAvailable: hasCircle && !hasCross,
                            raw: cText.replace(/\\s+/g, ' ')
                        });
                    }
                }
            }
            return list;
        }""")

        for item in trains_data:
            dep_time = item["depTime"]
            name = item["name"]
            if not dep_time:
                continue

            try:
                hour = int(dep_time.split(":")[0])
            except ValueError:
                continue

            status_str = "有余票(○/△)" if item["isAvailable"] else "满席(×)"

            if hour >= min_hour:
                print(f"  -> {dep_time} {name} | 状态: {status_str} | 条件: 符合(>= {min_hour}:00)")
                if item["isAvailable"]:
                    matched_trains.append(f"{name}({dep_time}发)")
            else:
                print(f"  -> {dep_time} {name} | 状态: {status_str} | 条件: 跳过(早于 {min_hour}:00)")

    except Exception as e:
        print(f"[{label}] 排查出现异常: {e}")
    finally:
        page.close()

    return matched_trains

def run():
    print("=== 启动嵯峨野小火车余票真实巡查系统 ===")
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
