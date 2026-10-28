import os
import json
import time
import uuid
import random
import urllib.parse
from datetime import datetime, timezone, timedelta
import requests

BARK_KEY = os.getenv("BARK_KEY", "")

# 状态缓存文件：用于 15 分钟防刷冷却（同状态不重复轰炸）
CACHE_FILE = "/tmp/sagano_notify_cache.json"
COOLDOWN_SECONDS = 900  # 15 分钟

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

def load_cache() -> dict:
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache: dict):
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
    except Exception:
        pass

def should_send_notification(date_key: str, fingerprint: str) -> bool:
    """防刷与免打扰校验：夜间不写缓存，次日 07:00 准时恢复触发"""
    is_quiet, bj_time_str = is_beijing_quiet_hours()
    if is_quiet:
        print(f"  🌙 [夜间免打扰] 当前北京时间 {bj_time_str}，处于 22:00~07:00 静音保护期，拦截推送。")
        return False

    cache = load_cache()
    record = cache.get(date_key, {})
    last_time = record.get("time", 0)
    last_fingerprint = record.get("fingerprint", "")
    now = time.time()

    # 15 分钟内同一状态不重复打扰
    if fingerprint == last_fingerprint and (now - last_time < COOLDOWN_SECONDS):
        print(f"  ⏳ [{date_key}] 处于 15 分钟防刷冷却期中，抑制重复提醒。")
        return False

    cache[date_key] = {"time": now, "fingerprint": fingerprint}
    save_cache(cache)
    return True

def send_bark_with_retry(title: str, content: str, jump_url: str = "", max_retries: int = 3) -> bool:
    """带 3 次自动重试与健康检查的 Bark 发送机制"""
    if not BARK_KEY:
        print(f"[跳过推送] 未配置 BARK_KEY: {title} - {content}")
        return False

    url = f"https://api.day.app/{BARK_KEY}/{title}/{content}?sound=bell&level=timeSensitive&group=sagano"
    if jump_url:
        url += f"&url={urllib.parse.quote(jump_url, safe='')}"

    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, timeout=6)
            if resp.status_code == 200:
                print(f"  ✔ Bark 通知推送成功 (第 {attempt} 次尝试)")
                return True
            else:
                print(f"  ⚠️ Bark 响应状态码异常 [{resp.status_code}]，正在进行第 {attempt} 次重试...")
        except Exception as e:
            print(f"  ⚠️ Bark 请求网络抖动 [{e}]，正在进行第 {attempt} 次重试...")
        
        time.sleep(2 * attempt)

    print("  ❌ Bark 推送达到最大重试次数，本次推送失败。系统将在下轮巡检自动重推！")
    return False

def get_train_vacant_seats(date_str: str, service_id: str) -> list:
    url = f"https://common-api.sagano.linktivity.io/v1/inventories/{date_str}/services/{service_id}?product_id=51&base_booking_id="[cite: 16]
    try:
        resp = requests.get(url, headers=HEADERS, timeout=8)
        if resp.status_code != 200:
            return []
        car_inventories = resp.json().get("car_inventories", [])[cite: 16]
        vacant_seats = []
        for car in car_inventories:
            c_id = car.get("logical_car_id", "")[cite: 16]
            c_name = car.get("physical_car_name", f"{c_id}号车")[cite: 16]
            for arr in car.get("arrangements", []):
                if arr.get("arrangement_state") == "ARRANGEABLE" and arr.get("reservation_state") == "VACANT":[cite: 16]
                    vacant_seats.append({
                        "logical_car_id": str(c_id),
                        "car_name": c_name,
                        "seat_group_id": str(arr.get("seat_group_id", "")),
                        "seat_id": str(arr.get("seat_id", "")),
                        "arrangement_type_id": str(arr.get("arrangement_type_id", "3"))
                    })[cite: 16]
        return vacant_seats
    except Exception as e:
        print(f"  获取车次 {service_id} 座位异常: {e}")
        return []

def lock_two_seats(date_str: str, service_id: str, seats: list) -> str:
    lock_url = "https://common-api.sagano.linktivity.io/v1/reservations/check"[cite: 16]
    payload = {
        "product_id": "51",
        "from_station_id": "1",
        "service": {
            "service_day": date_str,
            "service_id": str(service_id),
            "manual": {
                "seats": [
                    {
                        "logical_car_id": s["logical_car_id"],
                        "seat_group_id": s["seat_group_id"],
                        "seat_id": s["seat_id"],
                        "arrangement_type_id": s["arrangement_type_id"]
                    }
                    for s in seats
                ]
            },
            "mutation_id": str(uuid.uuid4())
        }
    }[cite: 16]
    try:
        requests.post(lock_url, headers=HEADERS, json=payload, timeout=8)[cite: 16]
    except Exception:
        pass

    seats_param = ",".join([
        f"{s['logical_car_id']}-{s['seat_group_id']}-{s['seat_id']}-{s['arrangement_type_id']}"
        for s in seats
    ])[cite: 16]
    return (
        f"https://ars-saganokanko.triplabo.jp/booking/pay?"
        f"fromStationId=1&toStationId=4&serviceId={service_id}&seats={seats_param}"
        f"&step=input_info&activityID=LINKTIVITY-YRBTL&lang=ja"
    )[cite: 16]

def query_services(date_str: str) -> list:
    payload = {
        "date": date_str,
        "from_station_id": "1",
        "to_station_id": "4",
        "total": 2,
        "product_id": "51"
    }[cite: 15]
    try:
        res = requests.post(API_SEARCH_URL, headers=HEADERS, json=payload, timeout=10)[cite: 15]
        if res.status_code == 200:
            return res.json().get("services", [])[cite: 15]
    except Exception as e:
        print(f"[{date_str}] 车次列表查询异常: {e}")
    return []

def process_nov_05():
    date_str = "2026-11-05"
    print(f"\n--- 11月05日 巡检（提示可用车次列表）---")
    services = query_services(date_str)
    avail_trains = []
    for s in services:
        dep_time = s.get("departure_hhmm", "")[cite: 15]
        try:
            hour = int(dep_time.split(":")[0])
        except ValueError:
            continue
        if hour >= 10 and s.get("available") and s.get("before_deadline"):[cite: 15]
            name = s.get("name", {}).get("short_name", "")[cite: 15]
            avail_trains.append(f"{name}({dep_time}发)")

    if avail_trains:
        trains_text = "、".join(avail_trains)
        print(f"  ✔ 11月05日可用班次: {trains_text}")
        if should_send_notification(date_str, trains_text):
            list_url = (
                f"https://file.sagano.linktivity.io/seat/51/down?lang=ja&date={date_str}"
                f"&unitsCount=2&backUrl={urllib.parse.quote(MAIN_PAGE_URL)}"
                f"&redirectUrl=https%3A%2F%2Fars-saganokanko.triplabo.jp%2Fbooking%2Fpay&currentStep=station"
            )[cite: 15]
            send_bark_with_retry("🎉 岚山小火车【11月05日】有票提醒", f"可用车次：{trains_text}。轻点进入车次列表查看！", jump_url=list_url)
    else:
        print("  11月05日暂无 >= 10:00 可用车次。")

def process_nov_12():
    date_str = "2026-11-12"
    print(f"\n--- 11月12日 巡检（多车次随机抽选，仅锁2人座）---")
    services = query_services(date_str)
    avail_services = [s for s in services if s.get("available") and s.get("before_deadline")][cite: 15]

    if not avail_services:
        print("  11月12日暂无可用车次。")
        return

    random.shuffle(avail_services)
    single_seat_services = []

    for s in avail_services:
        s_id = s.get("id")[cite: 15]
        t_name = s.get("name", {}).get("short_name", "")[cite: 15]
        dep_time = s.get("departure_hhmm", "")[cite: 15]
        vacant_seats = get_train_vacant_seats(date_str, s_id)

        if len(vacant_seats) >= 2:
            chosen = random.sample(vacant_seats, 2)
            seats_desc = f"{chosen[0]['car_name']}{chosen[0]['seat_group_id']}{chosen[0]['seat_id']}、{chosen[1]['car_name']}{chosen[1]['seat_group_id']}{chosen[1]['seat_id']}"
            pay_url = lock_two_seats(date_str, s_id, chosen)
            fingerprint = f"{s_id}_{chosen[0]['seat_group_id']}{chosen[0]['seat_id']}_{chosen[1]['seat_group_id']}{chosen[1]['seat_id']}"
            
            print(f"  ✔ 11月12日选中 [{t_name} {dep_time}]，分配座位: {seats_desc}")
            if should_send_notification(date_str, fingerprint):
                send_bark_with_retry(
                    "🎉 岚山小火车【11月12日】已选座",
                    f"已选中 {t_name}({dep_time}发)，座位: {seats_desc}。轻点直接进入订单支付！",
                    jump_url=pay_url
                )
            return
        elif len(vacant_seats) == 1:
            single_seat_services.append(f"{t_name}({dep_time}发)")
            print(f"  [{t_name}] 仅剩 1 个座位，自动顺延排查其他车次...")

    if single_seat_services:
        print("  ⚠️ 11月12日仅余单张票，不满足 2 人需求。")
        msg = f"11月12日仅余单张票（{'、'.join(single_seat_services)} 各剩1席），不足2人，未选座。"
        if should_send_notification(date_str, "ONLY_1_SEAT_" + ",".join(single_seat_services)):
            send_bark_with_retry("⚠️ 岚山小火车【11月12日】仅余单张票", msg, jump_url="")

def process_nov_24():
    date_str = "2026-11-24"
    print(f"\n--- 11月24日 巡检（限定 13:00~16:00 黄金时段且必须满2席）---")
    services = query_services(date_str)
    
    matched_services = []
    for s in services:
        dep_time = s.get("departure_hhmm", "")[cite: 15]
        if "13:00" <= dep_time <= "16:05" and s.get("available") and s.get("before_deadline"):[cite: 15]
            matched_services.append(s)

    if not matched_services:
        print("  11月24日 13:00~16:00 暂无车次放票。")
        return

    for s in matched_services:
        s_id = s.get("id")[cite: 15]
        t_name = s.get("name", {}).get("short_name", "")[cite: 15]
        dep_time = s.get("departure_hhmm", "")[cite: 15]
        vacant_seats = get_train_vacant_seats(date_str, s_id)

        if len(vacant_seats) >= 2:
            chosen = random.sample(vacant_seats, 2)
            seats_desc = f"{chosen[0]['car_name']}{chosen[0]['seat_group_id']}{chosen[0]['seat_id']}、{chosen[1]['car_name']}{chosen[1]['seat_group_id']}{chosen[1]['seat_id']}"
            pay_url = lock_two_seats(date_str, s_id, chosen)
            fingerprint = f"24_{s_id}_{chosen[0]['seat_group_id']}_{chosen[1]['seat_group_id']}"

            print(f"  🎉 11月24日命中并成功锁座: {t_name}({dep_time}) | {seats_desc}")
            if should_send_notification(date_str, fingerprint):
                send_bark_with_retry(
                    "🎉 岚山小火车【11月24日】抢到2人票！",
                    f"已锁定黄金时段 {t_name}({dep_time}发)，座位: {seats_desc}。轻点立即前往付款！",
                    jump_url=pay_url
                )
            return
        else:
            print(f"  [{t_name} {dep_time}] 当前仅剩 {len(vacant_seats)} 席，不满足2人要求，跳过。")

def run():
    is_quiet, bj_time_str = is_beijing_quiet_hours()
    status_tag = "【🌙 免打扰时段 - 仅巡查不发声】" if is_quiet else "【🔔 正常推送时段】"
    print(f"=== 嵯峨野小火车智能监控运行中 === 当前北京时间: {bj_time_str} {status_tag}")
    
    try:
        process_nov_05()
    except Exception as e:
        print(f"11月05日模块偶发异常（已自动隔离）: {e}")

    try:
        process_nov_12()
    except Exception as e:
        print(f"11月12日模块偶发异常（已自动隔离）: {e}")

    try:
        process_nov_24()
    except Exception as e:
        print(f"11月24日模块偶发异常（已自动隔离）: {e}")

if __name__ == "__main__":
    run()
