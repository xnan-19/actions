import os
import re
import urllib.parse
import requests
from playwright.sync_api import sync_playwright

BARK_KEY = os.getenv("BARK_KEY", "")

TARGET_CONFIGS = [
    {"date": "2026-11-05", "label": "11月05日", "min_hour": 10},
    {"date": "2026-11-24", "label": "11月24日", "min_hour": 14},
]

def build_direct_url(date_str: str) -> str:
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

def handle_station_selection(page):
    """自动完成乘降车站选择并进入车次列表"""
    # 1. 尝试原生 select
    selects = page.locator("select").all()
    if len(selects) >= 2:
        try:
            selects[0].select_option(label="トロッコ嵯峨")
            selects[1].select_option(label="トロッコ亀岡")
        except Exception:
            pass

    # 2. 自定义下拉选择框处理：乗車駅
    dep_btn = page.locator("text='乗車駅を選択してください'").first
    if dep_btn.count() > 0 and dep_btn.is_visible():
        try:
            dep_btn.click(timeout=3000)
        except Exception:
            dep_btn.locator("..").click(timeout=3000)
        page.wait_for_timeout(600)
        
        # 选中 トロッコ嵯峨
        try:
            page.locator("text='トロッコ嵯峨'").last.click(timeout=3000)
        except Exception:
            page.evaluate("""() => {
                const el = Array.from(document.querySelectorAll('*')).reverse().find(e => e.innerText && e.innerText.trim() === 'トロッコ嵯峨');
                if (el) el.click();
            }""")
        page.wait_for_timeout(600)

    # 3. 自定义下拉选择框处理：降車駅
    arr_btn = page.locator("text='降車駅を選択してください'").first
    if arr_btn.count() > 0 and arr_btn.is_visible():
        try:
            arr_btn.click(timeout=3000)
        except Exception:
            arr_btn.locator("..").click(timeout=3000)
        page.wait_for_timeout(600)
        
        # 选中 トロッコ亀岡
        try:
            page.locator("text='トロッコ亀岡'").last.click(timeout=3000)
        except Exception:
            page.evaluate("""() => {
                const el = Array.from(document.querySelectorAll('*')).reverse().find(e => e.innerText && e.innerText.trim() === 'トロッコ亀岡');
                if (el) el.click();
            }""")
        page.wait_for_timeout(600)

    # 4. 点击【次へ】推进到车次列表
    next_btn = page.locator("button:has-text('次へ'), [role='button']:has-text('次へ'), div:has-text('次へ')").last
    if next_btn.count() > 0 and next_btn.is_visible():
        print("✔ 车站已选定，点击【次へ】进入列车选择页...")
        try:
            next_btn.click(timeout=3000)
        except Exception:
            page.evaluate("""() => {
                const btns = Array.from(document.querySelectorAll('button, div, a'));
                const btn = btns.reverse().find(b => b.innerText && b.innerText.trim() === '次へ');
                if (btn) btn.click();
            }""")
        page.wait_for_timeout(3000)

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
        page.wait_for_timeout(2500)

        # 检查是否需要选择车站并点击“次へ”
        if "乗車駅を選択してください" in page.content() or page.locator("text='次へ'").count() > 0:
            handle_station_selection(page)

        # 等待列车列表渲染出来
        try:
            page.wait_for_selector("text=/嵯峨野\\s*\\d+号/", timeout=15000)
        except Exception:
            page.wait_for_timeout(3000)

        # 模拟向下滚动，加载全天所有班次
        for _ in range(4):
            page.evaluate("window.scrollBy(0, 800)")
            page.wait_for_timeout(300)

        # 解析车次卡片
        train_cards = page.evaluate("""() => {
            const results = [];
            const seen = new Set();
            const elements = Array.from(document.querySelectorAll('*'));
            
            for (const el of elements) {
                const txt = (el.innerText || "").trim();
                const match = txt.match(/嵯峨野\\s*\\d+号/);
                if (match) {
                    let card = el;
                    while (card && card !== document.body) {
                        const cText = card.innerText || "";
                        if (/\\d{1,2}:\\d{2}/.test(cText) && (cText.includes("空席") || cText.includes("満席") || cText.includes("○") || cText.includes("×") || cText.includes("△"))) {
                            break;
                        }
                        card = card.parentElement;
                    }
                    if (card && card !== document.body) {
                        const name = match[0].replace(/\\s+/g, '');
                        if (!seen.has(name)) {
                            seen.add(name);
                            results.push({
                                name: name,
                                text: card.innerText.replace(/\\s+/g, ' ')
                            });
                        }
                    }
                }
            }
            return results;
        }""")

        if not train_cards:
            print(f"⚠️ 仍未解析到车次卡片，当前页面文字摘要:\n{page.locator('body').inner_text()[:300]}")
            return [], target_url

        for item in train_cards:
            name = item["name"]
            c_text = item["text"]
            
            times = re.findall(r"\b(\d{1,2}:\d{2})\b", c_text)
            if not times:
                continue
            dep_time = times[0]
            
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
