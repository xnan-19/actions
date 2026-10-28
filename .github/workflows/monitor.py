import os
import time
import urllib.parse
import requests

BARK_KEY = os.getenv("BARK_KEY", "")

# 监控目标配置：日期、显示名称、起始时间（包含）
TARGET_CONFIGS = [
    {"date": "2026-11-05", "label": "11月05日", "min_hour": 10},  # 10:00 以后
    {"date": "2026-11-12", "label": "11月12日", "min_hour": 0},   # 11月12日全天
    {"date": "2026-11-24", "label": "11月24日", "min_hour": 14},  # 14:00 以后
]

API_SEARCH_URL = "https://common-api.sagano.linktivity.io/v1/search-inventory"
MAIN_PAGE_URL = "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL"

HEADERS = {
    "accept": "*/*",
    "accept-language": "ja,zh-CN,zh;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "content-type": "application/json",
    "origin": "https://file.sagano.linktivity.io",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "referer": "https://file.sagano.linktivity.io/",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

def build_direct_booking_url(date_str: str) -> str:
    """生成该日期专属的 2 人选座直达链接（点开直接选车次与座位）"""
    base_url = "https://file.sagano.linktivity.io/seat/51/down"
    params = {
        "lang": "ja",
        "date": date_str,
        "unitsCount": "2",
        "backUrl": MAIN_PAGE_URL,
        "redirectUrl": "https://ars-saganokanko.triplabo.jp/booking/pay",
        "currentStep": "station"
    }
    return f"{base_url}?{urllib.parse.urlencode(params)}"

def send_bark(title: str, content: str, jump_url: str = ""):
    """向 iPhone 发送独立 Bark 强提醒通知"""
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

def check_date_and_notify(config: dict):
    date_str = config["date"]
    label = config["label"]
    min_hour = config["min_hour"]

    print(f"\n==========================================")
    print(f"【API 检测】{label} ({date_str}) | 筛选 >= {min_hour}:00 班次 | 人数: 2人")

    payload = {
        "date": date_str,
        "from_station_id": "1",
        "to_station_id": "4",
        "total": 2,
        "product_id": "51"
    }

    try:
        response = requests.post(API_SEARCH_URL, headers=HEADERS, json=payload, timeout=10)
        if response.status_code != 200:
            print(f"❌ 接口请求失败，状态码: {response.status_code}")
            return

        services = response.json().get("services", [])
        if not services:
            print(f"❌ {label}：全天无票或未放票")
            return

        matched_trains = []
        for service in services:
            train_name = service.get("name", {}).get("short_name", "未知班次")
            dep_time = service.get("departure_hhmm", "")
            is_avail = service.get("available", False)
            before_deadline = service.get("before_deadline", True)

            try:
                hour = int(dep_time.split(":")[0])
            except ValueError:
                continue

            status_desc = "【有票 ○】" if (is_avail and before_deadline) else "【无票 ×】"

            if hour >= min_hour:
                print(f"  -> {dep_time} {train_name} | {status_desc} | 目标时段: 符合 (>= {min_hour}:00)")
                if is_avail and before_deadline:
                    matched_trains.append(f"{train_name}({dep_time}发)")
            else:
                print(f"  -> {dep_time} {train_name} | {status_desc} | 目标时段: 跳过 (早于 {min_hour}:00)")

        # 发现该日期有票，立即发送该日期的独立专属通知
        if matched_trains:
            trains_str = "、".join(matched_trains)
            target_jump_url = build_direct_booking_url(date_str)
            
            title = f"🎉 岚山小火车【{label}】有票提醒"
            content = f"可用班次：{trains_str}。轻点此通知直接进入【{label}】选座！"
            
            print(f"\n📱 正在发送【{label}】独立通知...")
            print(f"🔗 对应跳转链接: {target_jump_url}")
            send_bark(title, content, jump_url=target_jump_url)
            time.sleep(1)  # 避免多条推送触发频控
        else:
            print(f"ℹ️ {label} 暂无符合时段的余位。")

    except Exception as e:
        print(f"[{label}] 检测异常: {e}")

def run():
    print("=== 启动嵯峨野小火车官方 API 独立多链接余票监控 ===")
    for config in TARGET_CONFIGS:
        check_date_and_notify(config)
    print("\n=== 本轮巡检完成 ===")

if __name__ == "__main__":
    run()
