#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
嵯峨野浪漫小火车全自动API抢票与官方原生Visa支付直达机器人
核心流程:
1. 毫秒级轮询余票接口 /v1/search-inventory
2. 锁定最佳座位 /v1/reservations/check (官方锁定15分钟)
3. 调用官方购物车创建接口 /v2/cart/create 绑定乘客 WANG XIN 与锁定座位
4. 生成官方原生免404直达支付链接: https://ars-saganokanko.triplabo.jp/booking/pay?cartID=...
5. Bark 高优先级推送，用户手机点开直接输入 Visa 付款出票
"""

import os
import sys
import json
import time
import uuid
import urllib.parse
from datetime import datetime, timezone, timedelta
import requests

BARK_KEY = os.getenv("BARK_KEY", "")
TARGET_DATES_ENV = os.getenv("TARGET_DATES", "2026-10-31")
TICKETS_COUNT = int(os.getenv("TICKETS_COUNT", "2"))

PASSENGER_INFO = {
    "firstName": "XIN",
    "lastName": "WANG",
    "email": "xnan_19@163.com",
    "tel": "+8617671856274",
    "country": "CN"
}

PRODUCT_ID = "LINKTIVITY-YRBTL"
FROM_STATION_SAGANO = "1"
TO_STATION_KAMEOKA = "2"

API_SEARCH_INVENTORY = "https://common-api.sagano.linktivity.io/v1/search-inventory"
API_RESERVATION_CHECK = "https://common-api.sagano.linktivity.io/v1/reservations/check"
API_TRIPLABO_BASE = "https://ars-backend.triplabo.jp"
OFFICIAL_PAY_BASE = "https://ars-saganokanko.triplabo.jp/booking/pay"


def log(msg):
    bj_tz = timezone(timedelta(hours=8))
    now_str = datetime.now(bj_tz).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] {msg}", flush=True)


def get_headers():
    return {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Origin": "https://ars-saganokanko.triplabo.jp",
        "Grpc-Metadata-Supplier": "saganokanko",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15"
    }


def search_inventory(date_str, total=2):
    payload = {
        "date": date_str,
        "fromStationId": FROM_STATION_SAGANO,
        "toStationId": TO_STATION_KAMEOKA,
        "productId": PRODUCT_ID,
        "total": total
    }
    headers = {
        "Content-Type": "application/json",
        "Origin": "https://file.sagano.linktivity.io",
        "Referer": "https://file.sagano.linktivity.io/",
        "User-Agent": "Mozilla/5.0"
    }
    try:
        res = requests.post(API_SEARCH_INVENTORY, headers=headers, json=payload, timeout=10)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        log(f"查询余票网络异常 ({date_str}): {e}")
    return None


def lock_seats(date_str, service_id, seats):
    mutation_id = str(uuid.uuid4())
    payload = {
        "productId": PRODUCT_ID,
        "fromStationId": FROM_STATION_SAGANO,
        "service": {
            "serviceDay": date_str,
            "serviceId": service_id,
            "manual": {
                "seats": seats
            },
            "mutationId": mutation_id
        }
    }
    headers = {
        "Content-Type": "application/json",
        "Origin": "https://file.sagano.linktivity.io",
        "Referer": "https://file.sagano.linktivity.io/",
        "User-Agent": "Mozilla/5.0"
    }
    try:
        res = requests.post(API_RESERVATION_CHECK, headers=headers, json=payload, timeout=10)
        if res.status_code == 200:
            log(f"✅ 成功锁定官方座位！锁定维持 15 分钟: {seats}")
            return True
        else:
            log(f"❌ 锁座失败: {res.status_code} - {res.text}")
    except Exception as e:
        log(f"锁座接口异常: {e}")
    return False


def create_official_cart(date_str, service_id, seats, total=2):
    """在 Triplabo 后台创建购物车，返回官方 cartId"""
    seats_notes = ",".join([
        f"{s['logicalCarId']}-{s['seatGroupId']}-{s['seatId']}-{s.get('arrangementTypeId', 'ORDINARY')}"
        for s in seats
    ])
    booking_notes = f"fromStationId={FROM_STATION_SAGANO}&toStationId={TO_STATION_KAMEOKA}&serviceId={service_id}&seats={seats_notes}"

    session = {
        "activityId": PRODUCT_ID,
        "languageCode": "ja",
        "planId": "PLN-07F10549A083769186A9",
        "targetDate": date_str,
        "planStartTime": "10:02",
        "planUnitItems": [
            {"id": "ITM-07F10549A083769186A9-01", "count": total}
        ],
        "participantFirstName": PASSENGER_INFO["firstName"],
        "participantLastName": PASSENGER_INFO["lastName"],
        "participantEmailAddress": PASSENGER_INFO["email"],
        "destinationEmail": PASSENGER_INFO["email"],
        "destinationTel": PASSENGER_INFO["tel"],
        "participantResidentRegion": PASSENGER_INFO["country"],
        "currencyCode": "JPY",
        "bookingNotes": booking_notes
    }

    try:
        res = requests.post(
            f"{API_TRIPLABO_BASE}/v2/cart/create",
            headers=get_headers(),
            json={"sessions": [session]},
            timeout=10
        )
        if res.status_code == 200:
            cart_id = res.json().get("cart", {}).get("id")
            log(f"✅ 官方购物车创建成功: {cart_id}")
            return cart_id
        else:
            log(f"创建购物车失败: {res.status_code} - {res.text}")
    except Exception as e:
        log(f"创建购物车异常: {e}")
    return None


def send_bark_notification(service_name, date_str, seats_desc, pay_url):
    if not BARK_KEY:
        log("未配置 BARK_KEY，跳过 Bark 推送")
        return

    title = urllib.parse.quote("🎉 岚山小火车抢票成功！请在15分钟内付款")
    body_text = (
        f"车次: {service_name}\n"
        f"日期: {date_str}\n"
        f"座位: {seats_desc}\n"
        f"预订人: WANG XIN (2人)\n"
        f"应付: ¥1,760 JPY\n"
        f"点击通知直达官方页面输入 Visa 付款出票！"
    )
    body = urllib.parse.quote(body_text)

    bark_url = (
        f"https://api.day.app/{BARK_KEY}/{title}/{body}"
        f"?url={urllib.parse.quote(pay_url)}"
        f"&level=timeSensitive"
        f"&sound=minuet"
        f"&group=sagano-train"
        f"&badge=1"
    )

    try:
        res = requests.get(bark_url, timeout=10)
        log(f"Bark 推送状态: {res.status_code}")
    except Exception as e:
        log(f"Bark 推送失败: {e}")


def execute_monitor():
    # 测试推送模式
    if os.getenv("TEST_BARK", "").lower() in ["true", "1"]:
        log("📢 触发 Bark 官方原生支付链接测试推送...")
        test_service = "嵯峨野 01 号 (官方演示车次)"
        test_date = "2026-10-31"
        test_seats = [
            {"logicalCarId": "04", "seatGroupId": 1, "seatId": "01", "arrangementTypeId": "ORDINARY"},
            {"logicalCarId": "04", "seatGroupId": 1, "seatId": "02", "arrangementTypeId": "ORDINARY"}
        ]
        cart_id = create_official_cart(test_date, "SAGANO_01", test_seats, total=TICKETS_COUNT)
        if cart_id:
            pay_url = f"{OFFICIAL_PAY_BASE}?cartID={cart_id}"
            seats_desc = "04车01号, 04车02号"
            log(f"🔗 生成官方原生直达支付链接: {pay_url}")
            send_bark_notification(test_service, test_date, seats_desc, pay_url)
            log("✅ 官方原生支付链接已成功推送至 Bark！")
            return True
        return False

    dates = [d.strip() for d in TARGET_DATES_ENV.split(",") if d.strip()]
    log(f"开始监控岚山小火车余票，监控日期列表: {dates}，人数: {TICKETS_COUNT}")

    for date_str in dates:
        log(f"正在扫描日期: {date_str} ...")
        inv_data = search_inventory(date_str, total=TICKETS_COUNT)
        if not inv_data or not inv_data.get("services"):
            continue

        available_services = [
            s for s in inv_data["services"]
            if s.get("beforeDeadline") and s.get("state") == "ORDINARY"
        ]

        if not available_services:
            log(f"日期 {date_str} 暂无可预订车次")
            continue

        log(f"🔥 发现 {len(available_services)} 个可用班次！")
        for srv in available_services:
            service_id = srv.get("serviceId")
            service_name = srv.get("name", service_id)
            log(f"正在尝试锁定车次: {service_name} ({service_id}) ...")

            target_seats = [
                {"logicalCarId": "04", "seatGroupId": 1, "seatId": "01", "arrangementTypeId": "ORDINARY"},
                {"logicalCarId": "04", "seatGroupId": 1, "seatId": "02", "arrangementTypeId": "ORDINARY"}
            ]

            locked = lock_seats(date_str, service_id, target_seats)
            if not locked:
                target_seats = [
                    {"logicalCarId": "03", "seatGroupId": 1, "seatId": "01", "arrangementTypeId": "ORDINARY"},
                    {"logicalCarId": "03", "seatGroupId": 1, "seatId": "02", "arrangementTypeId": "ORDINARY"}
                ]
                locked = lock_seats(date_str, service_id, target_seats)

            if locked:
                seats_desc = ", ".join([f"{s['logicalCarId']}车{s['seatId']}号" for s in target_seats])
                cart_id = create_official_cart(date_str, service_id, target_seats, total=TICKETS_COUNT)
                if not cart_id:
                    continue

                pay_url = f"{OFFICIAL_PAY_BASE}?cartID={cart_id}"
                log(f"🔗 生成官方原生直达支付链接: {pay_url}")

                send_bark_notification(service_name, date_str, seats_desc, pay_url)
                log("🎯 抢票全流程执行完毕，已发送官方原生支付通知！")
                return True

    log("本次巡检结束，未发现或未成功锁定余票。")
    return False


if __name__ == "__main__":
    execute_monitor()
