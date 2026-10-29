// ==UserScript==
// @name         嵯峨野小火车官方极速支付直达
// @namespace    sagano-official-pay
// @version      1.0
// @description  接收抢票锁座结果，直接激活官方支付收银台，100%在官方域名输入Visa付款！
// @author       Antigravity
// @match        https://ars-saganokanko.triplabo.jp/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    if (location.hash && location.hash.includes('order=')) {
        try {
            const hashStr = location.hash.substring(1);
            const params = new URLSearchParams(hashStr);
            const orderRaw = params.get('order');
            if (orderRaw) {
                const order = JSON.parse(decodeURIComponent(orderRaw));

                // 官方 Vuex 持久化 state 结构
                const vuexData = {
                    booking: {
                        currentStep: 0,
                        activity: {
                            id: "LINKTIVITY-YRBTL",
                            title: "嵯峨野トロッコ列車　乗車券",
                            displayCurrencyCode: "JPY"
                        },
                        session: order.session,
                        unitItems: order.unitItems || [],
                        sessionId: order.sessionId || "",
                        bookingId: "",
                        clientSecret: ""
                    }
                };

                // 写入官方 sessionStorage
                sessionStorage.setItem('vuex', JSON.stringify(vuexData));
                console.log('[嵯峨野助手] 官方订单 Session 注入成功！');

                // 跳转至官方支付页
                if (location.pathname !== '/booking/pay') {
                    location.replace('https://ars-saganokanko.triplabo.jp/booking/pay');
                }
            }
        } catch (e) {
            console.error('[嵯峨野助手] 订单解析失败', e);
        }
    }
})();
