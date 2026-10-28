import os
import random
import urllib.parse
from datetime import datetime, timezone, timedelta
import requests

BARK_KEY = os.getenv("BARK_KEY", "")

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

def is_beijing_quiet_hours() -> tuple:
    """判定是否处于北京时间 22:00 ~ 次日 07:00 静音时段"""
    bj_tz = timezone(timedelta(hours=8))
    bj_now = datetime.now(bj_tz)
    hour = bj_now.hour
    is_quiet = (hour >= 22 or hour < 7)
    return is_quiet, bj_now.strftime("%Y-%m-%d %H:%M:%S")

def build_valid_booking_url(date_str: str) -> str:
    """生成允许外部冷启动、绝不跳回 Home 页的直达选座链接"""
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

def send_bark(title: str, content: str, jump_url: str = "") -> bool:
    """向 iPhone 发送 Bark 强提醒（含夜间过滤与 3 次重试）"""
    is_quiet, bj_time_str = is_beijing_quiet_hours()
    if is_quiet:
        print(f"  🌙 [夜间免打扰] 当前北京时间 {bj_time_str}，处于 22:00~07:00 静音期，取消推送。")
        return False

    if not BARK_KEY:
        print(f"  [提示] 未配置 BARK_KEY: {title} - {content}")
        return False

    url = f"https://api.day.app/{BARK_KEY}/{title}/{content}?sound=bell&level=timeSensitive&group=sagano"
    if jump_url:
        url += f"&url={urllib.parse.quote(jump_url, safe='')}"

    for attempt in range(1, 4):
        try:
            resp = requests.get(url, timeout=6)
            if resp.status_code == 200:
                print(f"  ✔ Bark 通知推送成功！")
                return True
            print(f"  ⚠️ Bark 响应状态异常 [{resp.status_code}]，正在进行第 {attempt} 次重试...")
        except Exception as e:
            print(f"  ⚠️ Bark 请求发生网络波动 [{e}]，正在进行第 {attempt} 次重试...")
    return False

def get_train_vacant_seats(date_str: str, service_id: str) -> list:
    """获取指定车次所有可预订的空座"""
    url = f"https://common-api.sagano.linktivity.io/v1/inventories/{date_str}/services/{service_id}?product_id=51&base_booking_id="
    try:
        resp = requests.get(url, headers=HEADERS, timeout=8)
        if resp.status_code != 200:
            return []
        car_inventories = resp.json().get("car_inventories", [])
        vacant_seats = []
        for car in car_inventories:
            c_id = car.get("logical_car_id", "")
            c_name = car.get("physical_car_name", f"{c_id}号车")
            for arr in car.get("arrangements", []):
                if arr.get("arrangement_state") == "ARRANGEABLE" and arr.get("reservation_state") == "VACANT":
                    vacant_seats.append({
                        "logical_car_id": str(c_id),
                        "car_name": c_name,
                        "seat_group_id": str(arr.get("seat_group_id", "")),
                        "seat_id": str(arr.get("seat_id", "")),
                        "arrangement_type_id": str(arr.get("arrangement_type_id", "3"))
                    })
        return vacant_seats
    except Exception as e:
        print(f"  获取车次 {service_id} 座位异常: {e}")
        return []

def query_services(date_str: str) -> list:
    payload = {
        "date": date_str,
        "from_station_id": "1",
        "to_station_id": "4",
        "total": 2,
        "product_id": "51"
    }
    try:
        res = requests.post(API_SEARCH_URL, headers=HEADERS, json=payload, timeout=10)
        if res.status_code == 200:
            return res.json().get("services", [])
    except Exception as e:
        print(f"[{date_str}] 车次列表查询异常: {e}")
    return []

# ================= 业务 1: 11月05日 =================
def process_nov_05():
    date_str = "2026-11-05"
    print(f"\n--- 11月05日（提示 >= 10:00 可用车次）---")
    services = query_services(date_str)
    avail_trains = []
    for s in services:
        dep_time = s.get("departure_hhmm", "")
        try:
            hour = int(dep_time.split(":")[0])
        except ValueError:
            continue
        if hour >= 10 and s.get("available") and s.get("before_deadline"):
            name = s.get("name", {}).get("short_name", "")
            avail_trains.append(f"{name}({dep_time}发)")

    if avail_trains:
        trains_text = "、".join(avail_trains)
        print(f"  ✔ 可用车次: {trains_text}")
        direct_url = build_valid_booking_url(date_str)
        send_bark(
            "🎉 岚山小火车【11月05日】有票提醒", 
            f"可用车次：{trains_text}。轻点直接进入选座！", 
            jump_url=direct_url
        )
    else:
        print("  11月05日暂无 >= 10:00 可用车次。")

# ================= 业务 2: 11月10日 =================
def process_nov_10():
    date_str = "2026-11-10"
    print(f"\n--- 11月10日（多车次随机抽选，仅锁2人座）---")
    services = query_services(date_str)
    avail_services = [s for s in services if s.get("available") and s.get("before_deadline")]

    if not avail_services:
        print("  11月10日暂无可用车次。")
        return

    random.shuffle(avail_services)
    single_seat_services = []

    for s in avail_services:
        s_id = s.get("id")
        t_name = s.get("name", {}).get("short_name", "")
        dep_time = s.get("departure_hhmm", "")
        vacant_seats = get_train_vacant_seats(date_str, s_id)

        # 选中的车次满足 >= 2 个座位
        if len(vacant_seats) >= 2:
            chosen = random.sample(vacant_seats, 2)
            seats_desc = f"{chosen[0]['car_name']}{chosen[0]['seat_group_id']}{chosen[0]['seat_id']}、{chosen[1]['car_name']}{chosen[1]['seat_group_id']}{chosen[1]['seat_id']}"
            direct_url = build_valid_booking_url(date_str)
            
            print(f"  ✔ 选中 [{t_name} {dep_time}]，分配推荐座位: {seats_desc}")
            send_bark(
                "🎉 岚山小火车【11月10日】有2人票",
                f"优选车次：{t_name}({dep_time}发)，推荐座位: {seats_desc}。轻点进入快速选座！",
                jump_url=direct_url
            )
            return

        elif len(vacant_seats) == 1:
            single_seat_services.append(f"{t_name}({dep_time}发)")
            print(f"  [{t_name}] 仅剩 1 个座位，自动顺延排查其他车次...")

    # 如果所有车次都仅剩 1 张票，仅提示不发链接
    if single_seat_services:
        print("  ⚠️ 11月10日仅余单张票，不满足 2 人需求。")
        msg = f"11月10日仅余单张票（{'、'.join(single_seat_services)} 各剩1席），不足2人，暂不预留。"
        send_bark("⚠️ 岚山小火车【11月10日】仅余单张票", msg, jump_url="")

# ================= 业务 3: 11月24日 =================
def process_nov_24():
    date_str = "2026-11-24"
    print(f"\n--- 11月24日（锁定 13:00~16:00 黄金时段且必须满2席）---")
    services = query_services(date_str)
    
    # 严格限定在 13:00 ~ 16:00 之间出发的班次
    matched_services = []
    for s in services:
        dep_time = s.get("departure_hhmm", "")
        if "13:00" <= dep_time <= "16:00" and s.get("available") and s.get("before_deadline"):
            matched_services.append(s)

    if not matched_services:
        print("  11月24日 13:00~16:00 暂无车次放票。")
        return

    for s in matched_services:
        s_id = s.get("id")
        t_name = s.get("name", {}).get("short_name", "")
        dep_time = s.get("departure_hhmm", "")
        vacant_seats = get_train_vacant_seats(date_str, s_id)

        # 严格要求该车次至少有 2 张票
        if len(vacant_seats) >= 2:
            chosen = random.sample(vacant_seats, 2)
            seats_desc = f"{chosen[0]['car_name']}{chosen[0]['seat_group_id']}{chosen[0]['seat_id']}、{chosen[1]['car_name']}{chosen[1]['seat_group_id']}{chosen[1]['seat_id']}"
            direct_url = build_valid_booking_url(date_str)

            print(f"  🎉 11月24日黄金时段命中: {t_name}({dep_time}) | 推荐座: {seats_desc}")
            send_bark(
                "🎉 岚山小火车【11月24日】抢到2人票！",
                f"命中黄金时段 {t_name}({dep_time}发)，推荐座位: {seats_desc}。轻点立即锁定！",
                jump_url=direct_url
            )
            return
        else:
            print(f"  [{t_name} {dep_time}] 当前仅剩 {len(vacant_seats)} 席，不满足2人要求，跳过。")

def run():
    is_quiet, bj_time_str = is_beijing_quiet_hours()
    status_tag = "【🌙 夜间免打扰 22:00~07:00】" if is_quiet else "【🔔 正常巡检时段】"
    print(f"=== 嵯峨野小火车定时巡检 === 当前北京时间: {bj_time_str} {status_tag}")
    
    process_nov_05()
    process_nov_10()
    process_nov_24()

if __name__ == "__main__":
    run()
