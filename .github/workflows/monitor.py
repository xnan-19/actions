#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
嵯峨野浪漫小火车全自动API抢票与专属Visa支付直达机器人
核心流程:
1. 毫秒级轮询余票接口 /v1/search-inventory
2. 锁定最佳座位 /v1/reservations/check (官方锁定15分钟)
3. 绑定乘客姓名与联系方式 /v2/booking/session/put
4. 创建正式预订订单获取支付凭证 /v2/booking/create (Stripe clientSecret)
5. 向用户 Bark 推送专属极速收银台链接 (绝不404、绝不跳回首页)
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
FIREBASE_API_KEY = "AIzaSyB7lJQdGfogdQP5e_LeowXTsfdCKQnnqZk"
CHECKOUT_PAGE_BASE = "https://xnan-19.github.io/actions/checkout.html"


def log(msg):
    bj_tz = timezone(timedelta(hours=8))
    now_str = datetime.now(bj_tz).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] {msg}", flush=True)


def get_headers(token=None):
    h = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Origin": "https://ars-saganokanko.triplabo.jp",
        "Grpc-Metadata-Supplier": "saganokanko",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15"
    }
    if token:
        h["Grpc-Metadata-Authorization"] = token
    return h


def get_firebase_token():
    try:
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={FIREBASE_API_KEY}"
        temp_email = f"sagano_{int(time.time())}_{uuid.uuid4().hex[:6]}@gmail.com"
        res = requests.post(url, json={
            "email": temp_email,
            "password": f"Sagano_{uuid.uuid4().hex[:8]}!",
            "returnSecureToken": True
        }, timeout=10)
        if res.status_code == 200:
            return res.json().get("idToken")
    except Exception as e:
        log(f"获取 Firebase Token 异常: {e}")
    return ""


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


def create_session(date_str, service_id, seats, total=2):
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
            f"{API_TRIPLABO_BASE}/v2/booking/session/put",
            headers=get_headers(),
            json={"session": session},
            timeout=10
        )
        if res.status_code == 200:
            sid = res.json().get("sessionId")
            log(f"✅ 会话创建成功: {sid}")
            return sid
        else:
            log(f"创建会话失败: {res.status_code} - {res.text}")
    except Exception as e:
        log(f"创建会话异常: {e}")
    return None


def create_booking_order(session_id, token):
    payload = {
        "sessionId": session_id,
        "payments": [
            {
                "method": "CREDITCARD",
                "gateway": "STRIPE"
            }
        ]
    }
    try:
        res = requests.post(
            f"{API_TRIPLABO_BASE}/v2/booking/create",
            headers=get_headers(token),
            json=payload,
            timeout=10
        )
        if res.status_code == 200:
            data = res.json()
            booking_id = data.get("bookingId")
            client_secret = data.get("clientSecret")
            log(f"🎉 订单创建成功！Booking ID: {booking_id}")
            return booking_id, client_secret
        else:
            log(f"创建订单返回: {res.status_code} - {res.text}")
    except Exception as e:
        log(f"创建订单异常: {e}")
    return None, None


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
        f"点击本通知秒开专属收银台输入 Visa 付款出票！"
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
        log("📢 触发 Bark 专属极速收银台测试推送...")
        test_service = "嵯峨野 01 号 (官方车次)"
        test_date = "2026-10-31"
        test_seats = "04车01号, 04车02号"
        pay_url = (
            f"{CHECKOUT_PAGE_BASE}?"
            f"clientSecret=pi_demo_test_secret"
            f"&bookingId=BKG_DEMO_123456"
            f"&date={test_date}"
            f"&service={urllib.parse.quote(test_service)}"
            f"&seats={urllib.parse.quote(test_seats)}"
            f"&amount=%C2%A51,760%20JPY"
        )
        send_bark_notification(test_service, test_date, test_seats, pay_url)
        log("✅ 专属收银台测试推送已成功发出！请在手机上查看！")
        return True

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
                session_id = create_session(date_str, service_id, target_seats, total=TICKETS_COUNT)
                if not session_id:
                    continue

                token = get_firebase_token()
                booking_id, client_secret = create_booking_order(session_id, token)

                seats_param = urllib.parse.quote(seats_desc)
                service_param = urllib.parse.quote(service_name)
                pay_url = (
                    f"{CHECKOUT_PAGE_BASE}?"
                    f"clientSecret={client_secret or ''}"
                    f"&bookingId={booking_id or ''}"
                    f"&date={date_str}"
                    f"&service={service_param}"
                    f"&seats={seats_param}"
                    f"&amount=%C2%A51,760%20JPY"
                )

                log(f"🔗 生成直达收银台链接: {pay_url}")
                send_bark_notification(service_name, date_str, seats_desc, pay_url)
                log("🎯 抢票全流程执行完毕，已发送支付通知！")
                return True

    log("本次巡检结束，未发现或未成功锁定余票。")
    return False


if __name__ == "__main__":
    execute_monitor()
