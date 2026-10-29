// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      15.0
// @description  收到Bark通知点开后，全自动精准点选路线、设定人数、选车站、选车次、原子防震荡精准锁定目标座位、自动填入乘客信息直达官方Visa支付！
// @author       Antigravity
// @match        *://ars-saganokanko.triplabo.jp/*
// @match        *://file.sagano.linktivity.io/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 屏幕居中悬浮状态提示条 (HUD)
    function showHUD(text, bgColor) {
        let hud = document.getElementById('sagano-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'sagano-hud';
            hud.style.cssText = 'position:fixed;top:20%;left:5%;width:90%;z-index:2147483647;padding:16px 20px;font-size:16px;font-weight:bold;text-align:center;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);pointer-events:none;transition:all 0.3s ease;';
            (document.body || document.documentElement).appendChild(hud);
        }
        hud.style.background = bgColor || 'rgba(0, 122, 255, 0.95)';
        hud.style.color = '#ffffff';
        hud.innerHTML = text;
    }

    // 单一安全真实点击触发器
    function safeClick(element) {
        if (!element) return;
        try {
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const eventProps = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y
            };
            element.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'touch' }, eventProps)));
            element.dispatchEvent(new MouseEvent('mousedown', eventProps));
            element.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'touch' }, eventProps)));
            element.dispatchEvent(new MouseEvent('mouseup', eventProps));
            element.click();
        } catch (e) {
            try { element.click(); } catch (err) {}
        }
    }

    // 解析座位参数 (例如 "04-1-01-ORDINARY,04-1-02-ORDINARY" 或 "04车01号,04车02号")
    function parseTargetSeats(seatsParam) {
        if (!seatsParam) return [];
        return seatsParam.split(',').map(item => {
            const raw = item.trim();
            // 匹配 "04-1-01" 格式
            const p = raw.split(/[-_]/);
            if (p.length >= 2) {
                return {
                    car: parseInt(p[0], 10),
                    group: parseInt(p[1], 10) || 1,
                    seat: p[2] ? p[2].replace(/[^0-9A-Za-z]/g, '') : '',
                    raw: raw
                };
            }
            // 匹配 "04车01号" 格式
            const m = raw.match(/(\d+)车.*?(\d+|[A-Za-z]+)/);
            if (m) {
                return {
                    car: parseInt(m[1], 10),
                    group: 1,
                    seat: m[2],
                    raw: raw
                };
            }
            return null;
        }).filter(Boolean);
    }

    const url = new URL(window.location.href);
    const params = url.searchParams;

    // 参数读取（支持 URL 参数与跨域持久化存储）
    const targetDate = params.get('date') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_date') : null) || sessionStorage.getItem('sagano_date') || '2026-10-31';
    const targetService = params.get('serviceId') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_service') : null) || sessionStorage.getItem('sagano_service') || '';
    const seatsParam = params.get('seats') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_seats') : null) || sessionStorage.getItem('sagano_seats') || '';
    const parsedTargetSeats = parseTargetSeats(seatsParam);
    const targetUnits = parseInt(params.get('unitsCount') || (parsedTargetSeats.length > 0 ? parsedTargetSeats.length : '2'), 10);

    // 持久化存储
    if (params.get('date')) {
        try { sessionStorage.setItem('sagano_date', params.get('date')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_date', params.get('date'));
    }
    if (params.get('serviceId')) {
        try { sessionStorage.setItem('sagano_service', params.get('serviceId')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_service', params.get('serviceId'));
    }
    if (params.get('seats')) {
        try { sessionStorage.setItem('sagano_seats', params.get('seats')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_seats', params.get('seats'));
    }
    if (params.get('unitsCount')) {
        try { sessionStorage.setItem('sagano_units', params.get('unitsCount')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_units', params.get('unitsCount'));
    }

    // =============================================================
    // 阶段 1: 官方活动详情页 (自动选路线、翻月、选日期、选人数、进入选座)
    // =============================================================
    if (window.location.pathname.includes('/activity/')) {
        showHUD('⚡【全自动抢票已启动】正在检索车票...', 'rgba(0, 122, 255, 0.95)');

        let targetMonth = '10月';
        let targetDay = '31';
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
            // ① 自动翻到目标月份
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
                    // 已是目标月份，查找并点击目标日期
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

            // ② 自动选择路线：点击嵯峨野小火车路线
            if (!routeDone) {
                const routeButtons = Array.from(document.querySelectorAll('button[class*="PlanPicker"], button')).filter(b => {
                    const t = (b.innerText || '').trim();
                    return t.includes('嵯峨駅') && t.includes('亀岡駅') && t.startsWith('嵯峨');
                });

                if (routeButtons.length > 0) {
                    const targetBtn = routeButtons[0];
                    safeClick(targetBtn);
                    routeDone = true;
                    showHUD('✔ 路线已成功选中：嵯峨/岚山 ➔ 龟冈', 'rgba(40, 167, 69, 0.95)');
                }
            }

            // ③ 自动设定人数：点击加号按钮
            if (routeDone && unitCount < targetUnits) {
                const plusBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const use = b.querySelector('use');
                    const href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href') || '') : '';
                    return href.includes('plus') || (b.className || '').toLowerCase().includes('plus');
                });

                if (plusBtns.length > 0) {
                    const adultPlus = plusBtns[0];
                    safeClick(adultPlus);
                    unitCount++;
                    showHUD(`👥 已设定人数: ${unitCount}/${targetUnits} 人`, 'rgba(40, 167, 69, 0.95)');
                }
            }

            // ④ 自动点击「予約手続きへ」进入选座流程
            if (!submitDone) {
                const allBtns = Array.from(document.querySelectorAll('button'));
                const submitBtn = allBtns.find(b => {
                    const txt = (b.innerText || b.textContent || '').trim();
                    return (txt.includes('予約手続き') || txt.includes('予約へ進む') || txt.includes('Checkout')) && !b.disabled && !b.hasAttribute('disabled');
                });

                if (submitBtn) {
                    submitDone = true;
                    showHUD('🎉 正在极速冲刺进入车次与选座页...', 'rgba(40, 167, 69, 0.95)');
                    safeClick(submitBtn);
                    clearInterval(mainTimer);
                }
            }
        }, 200);

        setTimeout(() => clearInterval(mainTimer), 30000);
    }

    // =============================================================
    // 阶段 2: Linktivity 外部选座系统 (v15.0 原子防震荡 & 绝不卡死引擎)
    // =============================================================
    if (window.location.hostname.includes('linktivity.io')) {
        showHUD('⚡ [1/4] 已进入选座系统，正在锁定车站...', 'rgba(0, 122, 255, 0.95)');

        let trainSelected = false;
        let isActionPending = false; // 原子操作锁：防多重点击并发
        let isSeatLocked = false;    // 满额绝对强锁：一旦选满，永久封锁选座反选，全速提交
        let lastActionTime = 0;
        let confirmSubmitted = false;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();

            // 1. 车站选择阶段
            let fromCombobox = null;
            let toCombobox = null;
            const allLabels = Array.from(document.querySelectorAll('p[class*="_label_"], p, label'));
            for (const lbl of allLabels) {
                const t = (lbl.innerText || lbl.textContent || '').trim();
                if (t === '乗車駅') fromCombobox = lbl.nextElementSibling;
                else if (t === '降車駅') toCombobox = lbl.nextElementSibling;
            }
            if (!fromCombobox || !toCombobox) {
                const boxes = Array.from(document.querySelectorAll('div[role="combobox"]'));
                if (boxes.length >= 2) {
                    if (!fromCombobox) fromCombobox = boxes[0];
                    if (!toCombobox) toCombobox = boxes[1];
                }
            }

            if (fromCombobox && toCombobox) {
                const fromDone = (fromCombobox.innerText || '').includes('嵯峨');
                const toDone = (toCombobox.innerText || '').includes('亀岡');

                if (!fromDone) {
                    const popper = document.querySelector('div[role="dialog"], div[class*="_popper_"]');
                    if (popper) {
                        const sagaBtn = Array.from(popper.querySelectorAll('button, div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ嵯峨'));
                        if (sagaBtn) {
                            safeClick(sagaBtn);
                            showHUD('✔ 乘车站已选中：トロッコ嵯峨', 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }
                    if (now - lastActionTime > 600) {
                        safeClick(fromCombobox);
                        lastActionTime = now;
                    }
                    return;
                }

                if (fromDone && !toDone) {
                    const popper = document.querySelector('div[role="dialog"], div[class*="_popper_"]');
                    if (popper) {
                        const kameokaBtn = Array.from(popper.querySelectorAll('button:not([disabled]), div[role="option"]')).find(el => (el.innerText || '').includes('トロッコ亀岡'));
                        if (kameokaBtn) {
                            safeClick(kameokaBtn);
                            showHUD('✔ 降车站已选中：トロッコ亀岡', 'rgba(40, 167, 69, 0.95)');
                            return;
                        }
                    }
                    if (now - lastActionTime > 600) {
                        safeClick(toCombobox);
                        lastActionTime = now;
                    }
                    return;
                }

                if (fromDone && toDone) {
                    const stationNextBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (stationNextBtn && !stationNextBtn.disabled) {
                        safeClick(stationNextBtn);
                    }
                }
            }

            // 2. 车次选择阶段
            if (!trainSelected) {
                const trainBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const t = (b.innerText || b.textContent || '').trim();
                    return t.includes('嵯峨野') && t.includes('号') && !b.disabled;
                });

                if (trainBtns.length > 0) {
                    let targetTrain = trainBtns[0];
                    if (targetService) {
                        const matched = trainBtns.find(b => (b.outerHTML || '').includes(targetService) || (b.innerText || '').includes(targetService));
                        if (matched) targetTrain = matched;
                    }

                    safeClick(targetTrain);
                    const trainText = (targetTrain.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ [2/4] 已选定车次：${trainText}，正在选座...`, 'rgba(40, 167, 69, 0.95)');

                    const nextBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (nextBtn && !nextBtn.disabled) {
                        safeClick(nextBtn);
                        trainSelected = true;
                    }
                    return;
                }
            }

            // 3. 核心选座阶段 (彻底解决 4/4 与 6/4 震荡)
            const countEl = document.querySelector('p[class*="_count_"], [class*="count"]');
            const carriageContainers = Array.from(document.querySelectorAll('button[class*="_carriageContainer_"], [class*="carriage"] button'));

            if (countEl || carriageContainers.length > 0) {
                let curSelected = 0;
                let maxAllowed = targetUnits;

                if (countEl) {
                    const m = (countEl.innerText || '').match(/(\d+)\s*\/\s*(\d+)/);
                    if (m) {
                        curSelected = parseInt(m[1], 10);
                        maxAllowed = parseInt(m[2], 10);
                    }
                }

                const selectedSeats = Array.from(document.querySelectorAll('button[class*="_selected_"]'));
                if (!countEl) curSelected = selectedSeats.length;

                // 核心法则 A：【满额绝对强锁】(一旦正好达到 2/2 或 4/4，永久关闭选座与反选，死按提交)
                if (curSelected === maxAllowed || isSeatLocked) {
                    isSeatLocked = true;
                    showHUD(`🎉 成功锁定 ${curSelected}/${maxAllowed} 席位！正在全力提交直达支付...`, 'rgba(40, 167, 69, 0.95)');
                    const submitBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (submitBtn) {
                        safeClick(submitBtn);
                    }
                    return;
                }

                // 如果原子锁正在冷却（800ms 内禁止重复点击），静默等待网络回包
                if (isActionPending && (now - lastActionTime < 800)) {
                    return;
                }
                isActionPending = false;

                // 核心法则 B：【超额单步回退】(分子 > 分母，单次取消一个多余座位并进入冷却)
                if (curSelected > maxAllowed && selectedSeats.length > 0) {
                    const extraSeat = selectedSeats[selectedSeats.length - 1];
                    isActionPending = true;
                    lastActionTime = now;
                    safeClick(extraSeat);
                    showHUD(`⚠️ 纠正多选座位 (${curSelected} ➔ ${maxAllowed})，冷却中...`, 'rgba(255, 149, 0, 0.95)');
                    return;
                }

                // 核心法则 C：【未满额选座】(单次点击一个空座并立即上锁 800ms 冷却)
                if (curSelected < maxAllowed) {
                    // ① 优先选择目标车厢
                    let targetCarNum = 4;
                    if (parsedTargetSeats.length > 0) {
                        targetCarNum = parsedTargetSeats[0].car;
                    }

                    // 检查目标车厢是否展开
                    const targetCarBtn = carriageContainers.find(b => (b.innerText || '').includes(`${targetCarNum}号`));
                    const isTargetCarExpanded = targetCarBtn ? !!targetCarBtn.closest('div[class*="_carriageContent_"], div')?.querySelector('div[class*="_car_"]') : false;

                    if (targetCarBtn && !isTargetCarExpanded) {
                        isActionPending = true;
                        lastActionTime = now;
                        safeClick(targetCarBtn);
                        showHUD(`🔍 正在展开指定 ${targetCarNum} 号车厢...`, 'rgba(0, 122, 255, 0.95)');
                        return;
                    }

                    // ② 在已展开的车厢中寻找空闲座位
                    const availableSeat = document.querySelector('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])');
                    if (availableSeat) {
                        isActionPending = true;
                        lastActionTime = now;
                        safeClick(availableSeat);
                        showHUD(`💺 正在锁定席位 (${curSelected + 1}/${maxAllowed})...`, 'rgba(40, 167, 69, 0.95)');
                        return;
                    }

                    // ③ 若当前车厢无空座，展开下一节车厢
                    for (const b of carriageContainers) {
                        const isExpanded = !!b.closest('div[class*="_carriageContent_"], div')?.querySelector('div[class*="_car_"]');
                        if (!isExpanded) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(b);
                            showHUD('🔍 正在探索其他车厢空闲席位...', 'rgba(255, 149, 0, 0.95)');
                            return;
                        }
                    }
                }
            }

            // 4. 选座确认页提交
            const isConfirmStep = !!document.querySelector('div[class*="_orderConfirm_"], div[class*="_carriageList_"]');
            const confirmNextBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
            if (isConfirmStep && confirmNextBtn && !confirmNextBtn.disabled && !confirmSubmitted) {
                confirmSubmitted = true;
                safeClick(confirmNextBtn);
                showHUD('🎉 选座锁定成功！正在进入官方订单填写与支付页...', 'rgba(40, 167, 69, 0.95)');
                clearInterval(linktivityTimer);
            }
        }, 200);

        setTimeout(() => clearInterval(linktivityTimer), 45000);
    }

    // =============================================================
    // 阶段 3: 官方订单填写与支付页面 (自动填姓名、邮箱、电话，直达Visa卡输入)
    // =============================================================
    if (window.location.pathname.includes('/booking/pay')) {
        showHUD('📝 正在为您自动填写官方乘车人与联系信息...', 'rgba(0, 122, 255, 0.95)');

        let formFilled = false;
        const payTimer = setInterval(() => {
            // 自动填充姓名、邮箱、手机号
            const lastNameInput = document.querySelector('input[name="lastName"], input[placeholder*="姓"], [class*="lastName"] input');
            const firstNameInput = document.querySelector('input[name="firstName"], input[placeholder*="名"], [class*="firstName"] input');
            const emailInput = document.querySelector('input[type="email"], input[name="email"], input[placeholder*="mail"]');
            const telInput = document.querySelector('input[type="tel"], input[name="tel"], input[placeholder*="tel"], input[placeholder*="电话"]');

            if (lastNameInput && !lastNameInput.value) {
                lastNameInput.value = 'WANG';
                lastNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (firstNameInput && !firstNameInput.value) {
                firstNameInput.value = 'XIN';
                firstNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (emailInput && !emailInput.value) {
                emailInput.value = 'xnan_19@163.com';
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (telInput && !telInput.value) {
                telInput.value = '+8617671856274';
                telInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // 自动勾选同意规约
            const termsCheckbox = document.querySelector('input[type="checkbox"]');
            if (termsCheckbox && !termsCheckbox.checked) {
                termsCheckbox.click();
            }

            // 自动点击“下一步 / 確認”按钮进入信用卡输入框
            const confirmBtn = document.querySelector('button[class*="confirmButton"], button[class*="button_"]');
            if (confirmBtn && !confirmBtn.disabled && !formFilled) {
                const btnText = (confirmBtn.innerText || '').trim();
                if (btnText.includes('確認') || btnText.includes('次へ') || btnText.includes('進む')) {
                    formFilled = true;
                    safeClick(confirmBtn);
                    showHUD('🎉 信息已就绪！请在下方官方输入框输入 Visa 信用卡付款！', 'rgba(40, 167, 69, 0.95)');
                    clearInterval(payTimer);
                }
            }
        }, 300);

        setTimeout(() => clearInterval(payTimer), 20000);
    }
})();
