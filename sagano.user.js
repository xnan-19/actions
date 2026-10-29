// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      7.0
// @description  收到Bark通知点开后，全自动精准点选路线、设定2人、双轨车站秒选、防反复折叠智能锁定空座，直达订单支付页！
// @match        *://ars-saganokanko.triplabo.jp/*
// @match        *://file.sagano.linktivity.io/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    function showHUD(text, bgColor) {
        let hud = document.getElementById('sagano-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'sagano-hud';
            hud.style.cssText = 'position:fixed;top:38%;left:5%;width:90%;z-index:2147483647;padding:16px 20px;font-size:16px;font-weight:bold;text-align:center;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);pointer-events:none;transition:all 0.3s ease;';
            (document.body || document.documentElement).appendChild(hud);
        }
        hud.style.background = bgColor || 'rgba(0, 122, 255, 0.95)';
        hud.style.color = '#ffffff';
        hud.innerHTML = text;
    }

    const url = new URL(window.location.href);
    const params = url.searchParams;

    const targetDate = params.get('date') || sessionStorage.getItem('sagano_target_date') || '2026-11-10';
    const targetService = params.get('serviceId') || sessionStorage.getItem('sagano_service_id') || '';
    const targetUnits = parseInt(params.get('unitsCount') || '2', 10);

    // =============================================================
    // 阶段 1: 活动详情页 (自动选路线、翻月、选日期、选人数、进入预约)
    // =============================================================
    if (window.location.pathname.includes('/activity/')) {
        showHUD('⚡【全自动抢票已启动】正在检索车票...', 'rgba(0, 122, 255, 0.95)');

        let targetMonth = '11月';
        let targetDay = '10';
        if (targetDate && targetDate.includes('-')) {
            const p = targetDate.split('-');
            if (p.length === 3) {
                targetMonth = parseInt(p[1], 10) + '月';
                targetDay = String(parseInt(p[2], 10));
            }
        }

        let dateDone = false;
        let routeDone = false;
        let unitCount = 0;
        let submitDone = false;

        const mainTimer = setInterval(() => {
            // ① 自动翻到目标月份（如 11 月）
            const monthHeader = document.querySelector('[class*="dateTableCurrent"], [class*="month"], [class*="dateTableHead"] p');
            if (monthHeader) {
                const curMonth = (monthHeader.innerText || monthHeader.textContent || '');
                if (!curMonth.includes(targetMonth)) {
                    const nextButtons = document.querySelectorAll('button[class*="Next"], button[class*="next"], [class*="dateTableHead"] button');
                    if (nextButtons.length > 0) {
                        const nextBtn = nextButtons[nextButtons.length - 1];
                        if (!nextBtn.disabled) {
                            nextBtn.click();
                            showHUD(`📅 正在翻月切换到 ${targetMonth}...`, 'rgba(255, 149, 0, 0.95)');
                            return;
                        }
                    }
                } else if (!dateDone) {
                    // 已是目标月份，查找并点击目标日期（如 10 号）
                    const dayButtons = document.querySelectorAll('button[class*="dateTableDayButton"], [class*="dateTableBodyCell"] button, [class*="day"] button');
                    for (const btn of dayButtons) {
                        if (btn.hasAttribute('disabled') || btn.disabled) continue;
                        const dText = (btn.innerText || btn.textContent || '').trim();
                        if (dText === targetDay) {
                            btn.click();
                            dateDone = true;
                            showHUD(`✔ 已成功选中日期：${targetMonth}${targetDay}日`, 'rgba(40, 167, 69, 0.95)');
                            break;
                        }
                    }
                }
            }

            // ② 自动选择路线：必须精准点击 BUTTON.PlanPicker_planPicker_KCJLc
            if (!routeDone) {
                const routeButtons = Array.from(document.querySelectorAll('button[class*="PlanPicker"], button')).filter(b => {
                    const t = (b.innerText || '').trim();
                    return t.includes('嵯峨駅') && t.includes('亀岡駅') && t.startsWith('嵯峨');
                });

                if (routeButtons.length > 0) {
                    const targetBtn = routeButtons[0];
                    targetBtn.click();
                    targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    targetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

                    const isChecked = targetBtn.className.includes('checked') || targetBtn.className.includes('active');
                    const hasQuantity = !!document.querySelector('button use[xlink\\:href*="plus"], button use[*|href*="plus"]');

                    if (isChecked || hasQuantity) {
                        routeDone = true;
                        showHUD('✔ 路线已成功选中：嵯峨/岚山 ➔ 龟冈', 'rgba(40, 167, 69, 0.95)');
                    }
                }
            }

            // ③ 自动设定人数：点击「大人 (12歳以上)」加号按钮直到达到目标人数
            if (routeDone && unitCount < targetUnits) {
                const plusBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const use = b.querySelector('use');
                    const href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href') || '') : '';
                    return href.includes('plus') || (b.className || '').toLowerCase().includes('plus');
                });

                if (plusBtns.length > 0) {
                    const adultPlus = plusBtns[0];
                    adultPlus.click();
                    unitCount++;
                    showHUD(`👥 已设定人数: ${unitCount}/${targetUnits} 人`, 'rgba(40, 167, 69, 0.95)');
                }
            }

            // ④ 自动点击「予約手続きへ」进入车次/选座流程
            if (!submitDone) {
                const allBtns = Array.from(document.querySelectorAll('button'));
                const submitBtn = allBtns.find(b => {
                    const txt = (b.innerText || b.textContent || '').trim();
                    return (txt.includes('予約手続き') || txt.includes('予約へ進む') || txt.includes('Checkout')) && !b.disabled && !b.hasAttribute('disabled');
                });

                if (submitBtn) {
                    submitDone = true;
                    showHUD('🎉 正在极速冲刺进入车次与选座页...', 'rgba(40, 167, 69, 0.95)');
                    submitBtn.click();
                    submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    clearInterval(mainTimer);
                }
            }
        }, 150);

        setTimeout(() => clearInterval(mainTimer), 30000);
    }

    // =============================================================
    // 阶段 2: Linktivity 车次与选座系统 (v7.0 终极双轨自适应引擎)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('🚀 抵达车次与选座系统，正在极速匹配...', 'rgba(0, 122, 255, 0.95)');

        // 终极事件触发引擎（全方位兼容 iOS Safari 触屏、React 合成事件与原生事件）
        function smartTrigger(el) {
            if (!el) return;

            // 1. 原生 click 方法
            try {
                if (typeof el.click === 'function') el.click();
            } catch (e) {}

            // 2. 深度触发 React 内部合成事件 (onClick / onSelect)
            try {
                const pKey = Object.keys(el).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$'));
                if (pKey && el[pKey]) {
                    if (typeof el[pKey].onClick === 'function') el[pKey].onClick({ stopPropagation: () => {}, preventDefault: () => {} });
                    if (typeof el[pKey].onSelect === 'function') el[pKey].onSelect();
                }
            } catch (e) {}

            // 3. 完整派发移动端触屏与鼠标事件链
            ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click'].forEach(evtName => {
                try {
                    let evt;
                    if (evtName.startsWith('touch')) {
                        evt = new TouchEvent(evtName, { bubbles: true, cancelable: true });
                    } else if (evtName.startsWith('pointer')) {
                        evt = new PointerEvent(evtName, { bubbles: true, cancelable: true });
                    } else {
                        evt = new MouseEvent(evtName, { bubbles: true, cancelable: true });
                    }
                    el.dispatchEvent(evt);
                } catch (err) {
                    try {
                        const fallbackEvt = document.createEvent('Event');
                        fallbackEvt.initEvent(evtName, true, true);
                        el.dispatchEvent(fallbackEvt);
                    } catch (e) {}
                }
            });
        }

        let fromDone = false;
        let toDone = false;
        let lastBoxOpenTime = 0;
        let trainDone = false;
        let carriageExpandedOnce = false;
        let lastSeatClickTime = 0;
        let confirmDone = false;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();
            const bodyText = document.body ? (document.body.innerText || '') : '';

            // =========================================================
            // ① 阶段 2.1：车站选择（双轨极速机制：见选项即秒选 + 防抖轻触展开）
            // =========================================================
            if (!fromDone || !toDone) {
                // 1. 优先扫描页面上是否已经弹出了车站选项（无论脚本展开还是手动展开）
                // 寻找包含「トロッコ嵯峨」的选项元素
                if (!fromDone) {
                    const sagaOpt = Array.from(document.querySelectorAll('div, li, button, span, p, a')).find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return (t === 'トロッコ嵯峨' || t === '嵯峨') && el.children.length === 0;
                    });

                    if (sagaOpt) {
                        smartTrigger(sagaOpt);
                        smartTrigger(sagaOpt.parentElement);
                        fromDone = true;
                        showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                        return;
                    }
                }

                // 寻找包含「トロッコ亀岡」的选项元素
                if (fromDone && !toDone) {
                    const kameokaOpt = Array.from(document.querySelectorAll('div, li, button, span, p, a')).find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return (t === 'トロッコ亀岡' || t === '亀岡') && el.children.length === 0;
                    });

                    if (kameokaOpt) {
                        smartTrigger(kameokaOpt);
                        smartTrigger(kameokaOpt.parentElement);
                        toDone = true;
                        showHUD('✔ 降车站已选中：トロッコ亀岡，正在查询车次...', 'rgba(40, 167, 69, 0.95)');
                        return;
                    }
                }

                // 2. 如果选项还没出现，按需展开下拉框（防抖间隔至少 800ms，绝对避免频繁展开关闭闪烁）
                if (now - lastBoxOpenTime > 800) {
                    if (!fromDone) {
                        const fromBox = Array.from(document.querySelectorAll('div, button, input, span')).find(el => {
                            const t = (el.innerText || el.textContent || '').trim();
                            return t.includes('乗車駅を選択');
                        });
                        if (fromBox) {
                            smartTrigger(fromBox);
                            smartTrigger(fromBox.parentElement);
                            lastBoxOpenTime = now;
                            showHUD('🚉 正在展开乘车站下拉列表...', 'rgba(0, 122, 255, 0.95)');
                            return;
                        }
                    } else if (!toDone) {
                        const toBox = Array.from(document.querySelectorAll('div, button, input, span')).find(el => {
                            const t = (el.innerText || el.textContent || '').trim();
                            return t.includes('降車駅を選択');
                        });
                        if (toBox) {
                            smartTrigger(toBox);
                            smartTrigger(toBox.parentElement);
                            lastBoxOpenTime = now;
                            showHUD('🏁 正在展开降车站下拉列表...', 'rgba(0, 122, 255, 0.95)');
                            return;
                        }
                    }
                }
            }

            // =========================================================
            // ② 阶段 2.2：车次选择（自动选中指定车次并点击「次へ」）
            // =========================================================
            if (!trainDone) {
                const trainBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const cls = b.className || '';
                    const t = (b.innerText || b.textContent || '').trim();
                    const isTrainClass = (typeof cls === 'string') && cls.includes('_train_');
                    const isTrainText = (t.includes('嵯峨野') || (t.includes('号') && t.includes(':'))) && !t.includes('号車');
                    return (isTrainClass || isTrainText) && !b.disabled && !b.hasAttribute('disabled');
                });

                if (trainBtns.length > 0) {
                    let targetTrain = trainBtns[0];
                    if (targetService) {
                        const matched = trainBtns.find(b => (b.outerHTML || '').includes(targetService) || (b.innerText || '').includes(targetService));
                        if (matched) targetTrain = matched;
                    }

                    smartTrigger(targetTrain);
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ 已自动选中车次：${trainText}，正在下一步...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮进入选座
                    const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
                        const t = (b.innerText || '').trim();
                        return (t === '次へ' || t === 'Next' || t === '下一步') && !b.disabled && !b.hasAttribute('disabled');
                    });

                    if (nextBtn) {
                        smartTrigger(nextBtn);
                        trainDone = true;
                    }
                    return;
                }
            }

            // =========================================================
            // ③ 阶段 2.3：车厢与选座页面（防反复折叠 + 字母座位智能抓取）
            // =========================================================
            const carriageBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                const cls = b.className || '';
                return (t.includes('号車') || t.includes('Car No') || (typeof cls === 'string' && cls.includes('carriageContainer'))) && !t.includes('次へ');
            });

            if (carriageBtns.length > 0) {
                // 判断车厢是否已经处于展开状态（页面出现「出入り口」或数字排号）
                const isCarriageOpen = bodyText.includes('出入り口') || !!document.querySelector('[class*="_carBody_"], [class*="_carInner_"]');

                // 如果未展开且从未点过展开，只点击一次展开（绝对禁止频繁点击）
                if (!isCarriageOpen && !carriageExpandedOnce) {
                    smartTrigger(carriageBtns[0]);
                    carriageExpandedOnce = true;
                    showHUD('✔ 正在展开 1 号车厢座位图...', 'rgba(0, 122, 255, 0.95)');
                    return;
                }

                // 核心：全页面精准提取所有单个字母 A/B/C/D 的可用座位
                const letterElements = Array.from(document.querySelectorAll('button, span, div')).filter(el => {
                    const t = (el.innerText || el.textContent || '').trim();
                    return ['A', 'B', 'C', 'D'].includes(t) && el.children.length === 0;
                });

                // 区分已选中座位与可用空位
                const selectedSeats = [];
                const availableSeats = [];

                for (const el of letterElements) {
                    const seatContainer = el.closest('button') || el.closest('div[class*="_seat_"]') || el.parentElement || el;
                    const combinedCls = (seatContainer.className || '') + ' ' + (el.className || '');

                    // 检查是否已选中
                    if (combinedCls.includes('_selected_') || combinedCls.includes('selected')) {
                        if (!selectedSeats.includes(seatContainer)) selectedSeats.push(seatContainer);
                        continue;
                    }

                    // 检查是否被禁用（已售出的灰色座位）
                    if (seatContainer.disabled || seatContainer.hasAttribute('disabled')) continue;
                    if (combinedCls.includes('_disabled_') || combinedCls.includes('disabled')) continue;

                    if (!availableSeats.includes(seatContainer)) {
                        availableSeats.push(seatContainer);
                    }
                }

                // 读取页面底部的数量计数（如 "2/2"）
                const countEl = document.querySelector('[class*="_count_"], [class*="count"]');
                const countText = countEl ? (countEl.innerText || '').trim() : '';

                // 判断是否选满 2 人（例如已选 2 人，或底部显示 2/2）
                if (selectedSeats.length >= targetUnits || (countText && countText.startsWith(`${targetUnits}/`))) {
                    showHUD(`🎉 成功锁定 ${targetUnits} 个座位！正在进入确认页...`, 'rgba(40, 167, 69, 0.95)');

                    // 点击底部的「次へ」按钮
                    const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
                        const t = (b.innerText || '').trim();
                        return (t === '次へ' || t === 'Next' || t === '下一步') && !b.disabled && !b.hasAttribute('disabled');
                    });

                    if (nextBtn) {
                        smartTrigger(nextBtn);
                    }
                    return;
                }

                // 点击可用空闲座位（每次点击间隔 300ms 保证 React 响应）
                if (now - lastSeatClickTime > 300 && availableSeats.length > 0) {
                    const seatToClick = availableSeats[0];
                    smartTrigger(seatToClick);
                    smartTrigger(seatToClick.parentElement);
                    lastSeatClickTime = now;
                    showHUD(`💺 正在锁定座位 (${selectedSeats.length + 1}/${targetUnits})...`, 'rgba(40, 167, 69, 0.95)');
                    return;
                }
            }

            // =========================================================
            // ④ 阶段 2.4：确认页面直达订单支付页
            // =========================================================
            const isConfirmPage = !!document.querySelector('[class*="orderConfirm"], [class*="carriageList"]');
            const actionBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                return (t.includes('次へ') || t.includes('確定') || t.includes('予約確認') || t.includes('進む') || t.includes('Next')) && !b.disabled && !b.hasAttribute('disabled');
            });

            if (actionBtns.length > 0 && isConfirmPage && !confirmDone) {
                const btn = actionBtns[actionBtns.length - 1];
                smartTrigger(btn);
                confirmDone = true;
                showHUD('🎉 选座锁定成功！正在火速直达订单支付页...', 'rgba(40, 167, 69, 0.95)');
                clearInterval(linktivityTimer);
            }
        }, 150);

        setTimeout(() => clearInterval(linktivityTimer), 45000);
    }

    // =============================================================
    // 阶段 3: 订单填写与支付页
    // =============================================================
    if (window.location.pathname.includes('/booking/pay')) {
        showHUD('🎉 恭喜！已全自动抵达订单支付页！请核对并支付！', 'rgba(40, 167, 69, 0.95)');
    }
})();
