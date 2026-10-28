// ==UserScript==
// @name         嵯峨野小火车自动预订直达
// @namespace    sagano-romantic-train
// @version      2.0
// @description  点击Bark推送链接后，自动选择路线、翻月、选日期、选人数并点击预订手续，合法生成官方Session，绝不回退首页！
// @match        https://ars-saganokanko.triplabo.jp/*
// @match        https://file.sagano.linktivity.io/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const url = new URL(window.location.href);
    const params = url.searchParams;

    // 只有携带 auto=1 时才执行全自动化流转
    const isAuto = params.get('auto') === '1' || sessionStorage.getItem('sagano_auto') === '1';
    if (!isAuto) return;

    sessionStorage.setItem('sagano_auto', '1');

    console.log('[嵯峨野助手] 自动流转脚本已就绪...');

    // -------------------------------------------------------------
    // 页面 1: 活动详情页 (https://ars-saganokanko.triplabo.jp/activity/ja/LINKTIVITY-YRBTL)
    // -------------------------------------------------------------
    if (window.location.pathname.includes('/activity/')) {
        const targetDate = params.get('date') || sessionStorage.getItem('sagano_target_date') || '';
        const targetSeats = params.get('seats') || sessionStorage.getItem('sagano_target_seats') || '';
        const targetUnits = parseInt(params.get('unitsCount') || '2', 10);

        if (targetDate) sessionStorage.setItem('sagano_target_date', targetDate);
        if (targetSeats) sessionStorage.setItem('sagano_target_seats', targetSeats);

        // 解析目标年月与日，例如 "2026-11-05" -> 年: 2026, 月: 11, 日: 5
        let targetMonthStr = '';
        let targetDayNum = 0;
        if (targetDate) {
            const parts = targetDate.split('-');
            if (parts.length === 3) {
                targetMonthStr = `${parseInt(parts[1], 10)}月`; // "11月"
                targetDayNum = parseInt(parts[2], 10);          // 5
            }
        }

        let routeDone = false;
        let dateDone = false;
        let unitDone = false;
        let submitDone = false;

        const timer = setInterval(() => {
            // 1. 自动选择路线：优先点击「嵯峨駅／嵐山駅 → 亀岡駅」
            if (!routeDone) {
                const planButtons = document.querySelectorAll('#selectPlan button, #selectPlan div[class*="plan"], button[class*="PlanPicker"], div[class*="PlanPicker"]');
                for (const btn of planButtons) {
                    const text = btn.innerText || btn.textContent || '';
                    if (text.includes('嵯峨駅') && text.includes('亀岡駅') && !btn.hasAttribute('disabled')) {
                        btn.click();
                        console.log('[嵯峨野助手] ✔ 已自动选择路线: 嵯峨/岚山 -> 龟冈');
                        routeDone = true;
                        break;
                    }
                }
            }

            // 2. 自动翻月与选日期
            if (!dateDone && targetMonthStr && targetDayNum > 0) {
                // 检查当前月份文本（如 "10月 2026"）
                const currentMonthElem = document.querySelector('[class*="dateTableCurrent"]');
                if (currentMonthElem) {
                    const curMonthText = currentMonthElem.innerText || '';
                    if (!curMonthText.includes(targetMonthStr)) {
                        // 不是目标月份，寻找并点击向右箭头切月份
                        const nextBtn = document.querySelector('button[class*="dateTableNext"], [class*="dateTableHead"] button:last-child');
                        if (nextBtn && !nextBtn.hasAttribute('disabled')) {
                            nextBtn.click();
                            console.log(`[嵯峨野助手] 正在翻月切换到 ${targetMonthStr}...`);
                            return; // 等待下一次轮询更新 DOM
                        }
                    } else {
                        // 已经是目标月份，查找可点击的日期按钮
                        const dayButtons = document.querySelectorAll('button[class*="dateTableDayButton"], [class*="dateTableBodyCell"] button');
                        for (const dayBtn of dayButtons) {
                            if (dayBtn.hasAttribute('disabled')) continue;
                            const dayText = (dayBtn.innerText || dayBtn.textContent || '').trim();
                            if (parseInt(dayText, 10) === targetDayNum) {
                                dayBtn.click();
                                console.log(`[嵯峨野助手] ✔ 已成功选中日期: ${targetDate}`);
                                dateDone = true;
                                break;
                            }
                        }
                    }
                }
            }

            // 3. 自动调整人数（目标人数例如 2 人）
            if (dateDone && !unitDone) {
                // 寻找人数选择框或者加号按钮
                const plusBtn = document.querySelector('[class*="SelectUnit"] [class*="plus"], [class*="amountCount"] button:last-child, [class*="InputNumber"] [class*="plus"]');
                const countInputs = document.querySelectorAll('[class*="SelectUnit"] input[type="number"], [class*="amountCount"] input');
                
                let curCount = 0;
                if (countInputs.length > 0) {
                    curCount = parseInt(countInputs[0].value || '0', 10);
                }

                if (curCount < targetUnits && plusBtn) {
                    plusBtn.click();
                    console.log(`[嵯峨野助手] 正在增加人数... 当前: ${curCount + 1}`);
                } else if (curCount >= targetUnits || !plusBtn) {
                    unitDone = true;
                    console.log(`[嵯峨野助手] ✔ 人数已就绪: ${targetUnits}人`);
                }
            }

            // 4. 自动点击「予約手続きへ / 立即预约」大按钮
            if (!submitDone) {
                // 寻找底部预约按钮
                const allButtons = document.querySelectorAll('button');
                for (const btn of allButtons) {
                    const text = (btn.innerText || btn.textContent || '').trim();
                    if ((text.includes('予約手続きへ') || text.includes('予約へ進む') || text.includes('Checkout')) && !btn.hasAttribute('disabled')) {
                        console.log('[嵯峨野助手] 🎉 预订按钮已激活，正在全速进入预订流程...');
                        submitDone = true;
                        clearInterval(timer);
                        btn.click();
                        break;
                    }
                }
            }
        }, 150);

        // 30 秒安全超时停止
        setTimeout(() => clearInterval(timer), 30000);
    }

    // -------------------------------------------------------------
    // 页面 2: Linktivity 外部选座页 (https://file.sagano.linktivity.io/)
    // -------------------------------------------------------------
    if (window.location.hostname.includes('linktivity.io')) {
        console.log('[嵯峨野助手] 当前处于选座页面，准备自动确认或一键流转...');
        const linkTimer = setInterval(() => {
            const nextBtns = document.querySelectorAll('button');
            for (const b of nextBtns) {
                const text = (b.innerText || '').trim();
                if ((text.includes('確定') || text.includes('次へ') || text.includes('確認')) && !b.disabled) {
                    // 用户可在该页面确认座位
                }
            }
        }, 300);
        setTimeout(() => clearInterval(linkTimer), 20000);
    }

    // -------------------------------------------------------------
    // 页面 3: 订单填写与支付页面 (https://ars-saganokanko.triplabo.jp/booking/pay)
    // -------------------------------------------------------------
    if (window.location.pathname.includes('/booking/pay')) {
        console.log('[嵯峨野助手] 🎉 恭喜！已合法进入官方订单与支付填写页！');
        sessionStorage.removeItem('sagano_auto'); // 流程结束
    }
})();
