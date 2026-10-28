import os
import urllib.parse
import requests

BARK_KEY = os.getenv("BARK_KEY", "")

# 监控目标：日期、显示名称、起始时间（包含）
TARGET_CONFIGS = [
    {"date": "2026-11-05", "label": "11月05日", "min_hour": 10},
    {"date": "2026-11-24", "label": "11月24日", "min_hour": 14},
]

# 官方库存查询真实 API
API_URL = "https://common-api.sagano.linktivity.io/v1/search-inventory"

# 官网主页与直达抢票链接生成
MAIN_PAGE_URL = "https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL"

def build_direct_booking_url(date_str: str) -> str:
    """生成带日期的直达 2 人选座链接"""
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
    """向 iPhone Bark 发送强提醒"""
    if not BARK_KEY:
        print(f"[提示] 未配置 BARK_KEY: {title} - {content}")
        return
    url = f"https://api.day.app/{BARK_KEY}/{title}/{content}?sound=bell&level=timeSensitive&group=sagano"
    if jump_url:
        url += f"&url={urllib.parse.quote(jump_url, safe='')}"
    try:
        resp = requests.get(url, timeout=5)
        print(f"Bark 推送状态: {resp.status_code}")
    except Exception as e:
        print(f"Bark 推送失败: {e}")

def check_single_date(config: dict) -> list:
    date_str = config["date"]
    label = config["label"]
    min_hour = config["min_hour"]

    print(f"\n==========================================")
    print(f"【API 请求】正在检测: {label} ({date_str}) | 筛选 >= {min_hour}:00 班次 | 人数: 2人")

    headers = {
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

    # 嵯峨野(1) -> 龟冈(4), 下行单程 51 号产品, 2 人
    payload = {
        "date": date_str,
        "from_station_id": "1",
        "to_station_id": "4",
        "total": 2,
        "product_id": "51"
    }

    matched_trains = []

    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=10)
        if response.status_code != 200:
            print(f"❌ 接口请求失败，状态码: {response.status_code}")
            return []

        data = response.json()
        services = data.get("services", [])
        if not services:
            print(f"❌ {label}：接口返回空班次（全天无票或未放票）")
            return []

        print(f"✔ 成功获取到当天 {len(services)} 个班次的官方状态：")

        for service in services:
            name_info = service.get("name", {})
            train_name = name_info.get("short_name", "未知班次")
            dep_time = service.get("departure_hhmm", "")
            is_available = service.get("available", False)
            before_deadline = service.get("before_deadline", True)

            try:
                hour = int(dep_time.split(":")[0])
            except ValueError:
                continue

            status_desc = "【有票 ○】" if (is_available and before_deadline) else "【无票 ×】"

            if hour >= min_hour:
                print(f"  -> {dep_time} {train_name} | {status_desc} | 目标时段: 符合 (>= {min_hour}:00)")
                if is_available and before_deadline:
                    matched_trains.append(f"{train_name}({dep_time}发)")
            else:
                print(f"  -> {dep_time} {train_name} | {status_desc} | 目标时段: 跳过 (早于 {min_hour}:00)")

    except Exception as e:
        print(f"[{label}] 接口请求异常: {e}")

    return matched_trains

def run():
    print("=== 启动嵯峨野小火车官方 API 极速余票监控 ===")
    alerts = []
    jump_url = MAIN_PAGE_URL

    for config in TARGET_CONFIGS:
        trains = check_single_date(config)
        if trains:
            train_str = "、".join(trains)
            print(f"🎉【发现目标余票】{config['label']}: {train_str}")
            alerts.append(f"{config['label']}: {train_str}")
            if jump_url == MAIN_PAGE_URL:
                jump_url = build_direct_booking_url(config["date"])
        else:
            print(f"ℹ️【无可用余票】{config['label']} 目标时段内暂无 2 人余位。")

    if alerts:
        summary = "；".join(alerts)
        print(f"\n[触发 Bark 推送]: {summary}")
        send_bark(
            "岚山小火车有票提醒(2人)",
            f"刷出可用班次：{summary}，速登官网锁定！",
            jump_url=jump_url
        )
    else:
        print("\n本次 API 巡查结束，两日期在设定时段内均无可用余票。")

if __name__ == "__main__":
    run()
