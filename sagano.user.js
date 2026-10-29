// ==UserScript==
// @name         嵯峨野小火车全自动秒选车次直达订单页
// @namespace    sagano-romantic-train
// @version      19.0
// @description  终极防超额与防抽搐版：严格锁定2人2座，实时DOM读取多退少补；1-5号车顺次单向智能遍历；就地补齐强锁；发车时间与精确席位锁定；直达Visa支付！
// @author       Antigravity
// @match        *://ars-saganokanko.triplabo.jp/*
// @match        *://file.sagano.linktivity.io/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // 屏幕居中悬浮状态提示条 (HUD)
    function showHUD(text, bgColor) {
        let hud = document.getElementById('sagano-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'sagano-hud';
            hud.style.cssText = 'position:fixed;top:18%;left:5%;width:90%;z-index:2147483647;padding:16px 20px;font-size:16px;font-weight:bold;text-align:center;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);pointer-events:none;transition:all 0.3s ease;';
            (document.body || document.documentElement).appendChild(hud);
        }
        hud.style.background = bgColor || 'rgba(0, 122, 255, 0.95)';
        hud.style.color = '#ffffff';
        hud.innerHTML = text;
    }

    // 单一真实安全点击触发器
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

    // 严谨判断车厢折叠容器是否已展开
    function getCarCard(carBtn) {
        let p = carBtn.parentElement;
        while (p && p !== document.body) {
            if (p.classList && Array.from(p.classList).some(c => c.toLowerCase().includes('carriage') || c.toLowerCase().includes('card'))) {
                return p;
            }
            p = p.parentElement;
        }
        return carBtn.parentElement?.parentElement || carBtn.parentElement;
    }

    function isCarriageExpanded(carBtn) {
        if (!carBtn) return false;
        if (carBtn.getAttribute('aria-expanded') === 'true') return true;
        const card = getCarCard(carBtn);
        if (!card) return false;
        // 检查该卡片下是否有排号或座位元素且处于可见状态 (offsetHeight > 0)
        const seatEl = card.querySelector('button[class*="_seatInner_"]');
        if (seatEl && seatEl.offsetParent !== null) return true;
        const groupEl = card.querySelector('div[class*="_group_"]');
        if (groupEl && groupEl.offsetParent !== null) return true;
        return false;
    }

    // 参数读取与全生命周期持久化
    const url = new URL(window.location.href);
    const params = url.searchParams;

    const targetDate = params.get('date') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_date') : null) || sessionStorage.getItem('sagano_date') || '2026-10-31';
    const targetService = params.get('serviceId') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_service') : null) || sessionStorage.getItem('sagano_service') || '';
    const targetTrainName = params.get('train') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_train') : null) || sessionStorage.getItem('sagano_train') || '';
    const targetTime = params.get('time') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_time') : null) || sessionStorage.getItem('sagano_time') || '';
    const targetUnits = parseInt(params.get('unitsCount') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_units') : null) || sessionStorage.getItem('sagano_units') || '2', 10);
    const targetSeatsParam = params.get('seats') || (typeof GM_getValue !== 'undefined' ? GM_getValue('sagano_seats') : null) || sessionStorage.getItem('sagano_seats') || '';

    // 持久化存储到 sessionStorage 和 GM 存储
    if (params.get('date')) {
        try { sessionStorage.setItem('sagano_date', params.get('date')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_date', params.get('date'));
    }
    if (params.get('serviceId')) {
        try { sessionStorage.setItem('sagano_service', params.get('serviceId')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_service', params.get('serviceId'));
    }
    if (params.get('train')) {
        try { sessionStorage.setItem('sagano_train', params.get('train')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_train', params.get('train'));
    }
    if (params.get('time')) {
        try { sessionStorage.setItem('sagano_time', params.get('time')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_time', params.get('time'));
    }
    if (params.get('unitsCount')) {
        try { sessionStorage.setItem('sagano_units', params.get('unitsCount')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_units', params.get('unitsCount'));
    }
    if (params.get('seats')) {
        try { sessionStorage.setItem('sagano_seats', params.get('seats')); } catch(e){}
        if (typeof GM_setValue !== 'undefined') GM_setValue('sagano_seats', params.get('seats'));
    }

    // 解析预设目标座位 (由 GitHub Actions 扫描推荐)
    let plannedSeats = [];
    if (targetSeatsParam) {
        plannedSeats = targetSeatsParam.split(',').map(s => {
            const p = s.trim().split('-');
            if (p.length >= 3) {
                return {
                    carId: parseInt(p[0], 10),
                    group: parseInt(p[1], 10),
                    seat: p[2].trim().toUpperCase(),
                    isUnavailable: false
                };
            }
            return null;
        }).filter(Boolean);
        console.log('[嵯峨野助手] 🎯 成功载入 GitHub 扫描推荐精确座位:', plannedSeats);
    }

    // =============================================================
    // 阶段 1: 官方活动详情页 (自动选日期、选路线、选人数、进入选座)
    // =============================================================
    if (window.location.pathname.includes('/activity/')) {
        showHUD('⚡【全自动抢票已启动】正在检索车票...', 'rgba(0, 122, 255, 0.95)');

        let targetMonthStr = '10';
        let targetDayStr = '31';
        if (targetDate && targetDate.includes('-')) {
            const parts = targetDate.split('-');
            if (parts.length === 3) {
                targetMonthStr = String(parseInt(parts[1], 10));
                targetDayStr = String(parseInt(parts[2], 10));
            }
        }

        let dateDone = false;
        let routeDone = false;
        let unitCount = 0;
        let submitDone = false;
        let lastCalendarAction = 0;

        const mainTimer = setInterval(() => {
            const now = Date.now();

            // ① 选日期：多层级容错匹配
            if (!dateDone) {
                // 1. 检查是否已经处于选中状态 (是否有 active/selected 的日期等于 targetDayStr)
                const selectedDayEl = Array.from(document.querySelectorAll('[class*="selected"], [class*="active"], [aria-selected="true"]')).find(el => {
                    const txt = (el.innerText || el.textContent || '').trim();
                    const lines = txt.split('\n').map(s => s.trim());
                    return lines.some(l => l === targetDayStr || l === `0${targetDayStr}`);
                });

                if (selectedDayEl) {
                    dateDone = true;
                    showHUD(`✔ 目标日期已选定：${targetMonthStr}月${targetDayStr}日`, 'rgba(40, 167, 69, 0.95)');
                } else {
                    // 2. 检查月份是否需要翻月
                    const monthEls = Array.from(document.querySelectorAll('[class*="month"], [class*="Month"], [class*="dateTableHead"], [class*="header"] p, h2, h3, p'));
                    const currentMonthEl = monthEls.find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return (t.includes('年') || t.includes('/') || t.includes('-')) && (t.includes('月') || /\d{4}/.test(t));
                    });

                    let needFlipMonth = false;
                    if (currentMonthEl) {
                        const mText = (currentMonthEl.innerText || currentMonthEl.textContent || '').trim();
                        const matchCurrentMonth = mText.includes(`${targetMonthStr}月`) || mText.includes(`/${targetMonthStr}`) || mText.includes(`-${targetMonthStr}`);
                        if (!matchCurrentMonth && (now - lastCalendarAction > 600)) {
                            needFlipMonth = true;
                        }
                    }

                    if (needFlipMonth) {
                        const nextMonthBtns = Array.from(document.querySelectorAll('button[class*="Next"], button[class*="next"], [class*="dateTableHead"] button, button[aria-label*="next"]'));
                        if (nextMonthBtns.length > 0) {
                            const nextBtn = nextMonthBtns[nextMonthBtns.length - 1];
                            safeClick(nextBtn);
                            lastCalendarAction = now;
                            showHUD(`📅 正在切换月份到 ${targetMonthStr} 月...`, 'rgba(255, 149, 0, 0.95)');
                            return;
                        }
                    }

                    // 3. 在日历单元格中寻找目标日期
                    const dayCandidates = Array.from(document.querySelectorAll('button, td, div[role="button"], [class*="dateTableDayButton"], [class*="dateTableBodyCell"] button, [class*="day"] button'));
                    const matchedBtn = dayCandidates.find(b => {
                        const dataDate = b.getAttribute('data-date') || b.getAttribute('data-day') || '';
                        if (dataDate && (dataDate === targetDate || dataDate.endsWith(`-${targetDayStr}`) || dataDate.endsWith(`-0${targetDayStr}`))) {
                            return true;
                        }
                        const txt = (b.innerText || b.textContent || '').trim();
                        const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
                        if (lines.length > 0) {
                            return lines[0] === targetDayStr || lines[0] === `0${targetDayStr}` || lines.some(l => l === targetDayStr);
                        }
                        return false;
                    });

                    if (matchedBtn) {
                        safeClick(matchedBtn);
                        dateDone = true;
                        lastCalendarAction = now;
                        showHUD(`✔ 成功点击选中日期：${targetMonthStr}月${targetDayStr}日`, 'rgba(40, 167, 69, 0.95)');
                    }
                }
            }

            // ② 自动选择路线：必须精准点击路线卡片
            if (!routeDone) {
                const routeButtons = Array.from(document.querySelectorAll('button[class*="PlanPicker"], button')).filter(b => {
                    const t = (b.innerText || '').trim();
                    return (t.includes('嵯峨駅') && t.includes('亀岡駅')) || (t.includes('嵯峨') && t.includes('亀岡')) || t.includes('嵯峨野') || t.includes('トロッコ');
                });

                if (routeButtons.length > 0) {
                    const targetBtn = routeButtons[0];
                    targetBtn.click();
                    targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    targetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

                    routeDone = true;
                    showHUD('✔ 路线已成功选中：嵯峨/岚山 ➔ 龟冈', 'rgba(40, 167, 69, 0.95)');
                }
            }

            // ③ 自动设定人数：严格从 DOM 读取当前人数，多退少补，确保精准为 targetUnits (2人)
            const allButtons = Array.from(document.querySelectorAll('button'));
            const plusBtn = allButtons.find(b => {
                const use = b.querySelector('use');
                const href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href') || '') : '';
                const cls = (b.className || '').toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const txt = (b.innerText || '').trim();
                return href.includes('plus') || cls.includes('plus') || aria.includes('plus') || txt === '+';
            });

            const minusBtn = allButtons.find(b => {
                const use = b.querySelector('use');
                const href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href') || '') : '';
                const cls = (b.className || '').toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const txt = (b.innerText || '').trim();
                return href.includes('minus') || cls.includes('minus') || aria.includes('minus') || txt === '-';
            });

            // 从界面实时解析当前已有人数
            let currentDomUnits = 0;
            if (plusBtn) {
                const stepperContainer = plusBtn.closest('div[class*="count"], div[class*="unit"], div[class*="stepper"], div[class*="item"]') || plusBtn.parentElement;
                if (stepperContainer) {
                    const inputEl = stepperContainer.querySelector('input');
                    if (inputEl && inputEl.value) {
                        currentDomUnits = parseInt(inputEl.value, 10) || 0;
                    } else {
                        const numEl = Array.from(stepperContainer.querySelectorAll('span, p, div')).find(el => /^\d+$/.test((el.innerText || '').trim()));
                        if (numEl) currentDomUnits = parseInt(numEl.innerText.trim(), 10) || 0;
                    }
                }
            }

            if (currentDomUnits > 0) {
                unitCount = currentDomUnits;
            }

            // 人数不足 targetUnits (2人)：单次点击加号并防抖
            if (unitCount < targetUnits && plusBtn && !plusBtn.disabled && (now - lastCalendarAction > 600)) {
                lastCalendarAction = now;
                safeClick(plusBtn);
                unitCount++;
                showHUD(`👥 正在设定人数: ${unitCount}/${targetUnits} 人...`, 'rgba(40, 167, 69, 0.95)');
                return;
            }

            // 人数超出 targetUnits (如误加成 3 或 4 人)：自动点击减号回退！
            if (unitCount > targetUnits && minusBtn && !minusBtn.disabled && (now - lastCalendarAction > 600)) {
                lastCalendarAction = now;
                safeClick(minusBtn);
                unitCount--;
                showHUD(`👥 人数超额，正在回退人数: ${unitCount}/${targetUnits} 人...`, 'rgba(255, 149, 0, 0.95)');
                return;
            }

            // ④ 当且仅当人数精准等于 targetUnits 时，点击「予約手続きへ」进入选座流程
            if (unitCount === targetUnits && !submitDone) {
                const submitBtn = allButtons.find(b => {
                    const txt = (b.innerText || b.textContent || '').trim();
                    return (txt.includes('予約手続き') || txt.includes('予約へ進む') || txt.includes('次へ') || txt.includes('日程の確定') || txt.includes('Checkout')) && !b.disabled && !b.hasAttribute('disabled');
                });

                if (submitBtn) {
                    submitDone = true;
                    showHUD(`🎉 人数已锁定为 ${targetUnits} 人！正在进入车次与选座页...`, 'rgba(40, 167, 69, 0.95)');
                    safeClick(submitBtn);
                    clearInterval(mainTimer);
                }
            }
        }, 150);
    }

    // =============================================================
    // 阶段 2: 官方选座 iframe / 选座主页面
    // =============================================================
    if (window.location.hostname.includes('linktivity.io') || window.location.pathname.includes('/booking/seat')) {
        let trainSelected = false;
        let lastActionTime = 0;
        let isSeatLocked = false;
        let isActionPending = false;
        let lastCarSwitchTime = 0;
        let visitedCars = new Set();
        let fallbackSwitchedCarId = null;

        const linktivityTimer = setInterval(() => {
            const now = Date.now();

            // 1. 车站选择阶段 (トロッコ嵯峨 ➔ トロッコ亀岡)
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

            // 2. 车次选择阶段 (发车时间优先精准匹配，杜绝错选车次)
            if (!trainSelected) {
                const trainBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                    const t = (b.innerText || b.textContent || '').trim();
                    return t.includes('嵯峨野') && t.includes('号') && !b.disabled;
                });

                if (trainBtns.length > 0) {
                    let targetTrainBtn = null;

                    // ① 优先按时间精准匹配 (例如 '17:10')
                    if (targetTime) {
                        targetTrainBtn = trainBtns.find(b => (b.innerText || b.textContent || '').includes(targetTime));
                    }

                    // ② 其次按车次名/车次号匹配 (例如 '81号' 或 '嵯峨野81号')
                    if (!targetTrainBtn && targetTrainName) {
                        const m = targetTrainName.match(/\d+号?/);
                        const numStr = m ? m[0] : targetTrainName;
                        targetTrainBtn = trainBtns.find(b => (b.innerText || b.textContent || '').includes(numStr));
                    }

                    // ③ 再次按 serviceId 匹配
                    if (!targetTrainBtn && targetService) {
                        targetTrainBtn = trainBtns.find(b => (b.outerHTML || '').includes(targetService) || (b.innerText || '').includes(targetService));
                    }

                    // ④ 保底选第 1 个
                    if (!targetTrainBtn) targetTrainBtn = trainBtns[0];

                    safeClick(targetTrainBtn);
                    const trainText = (targetTrainBtn.innerText || '').split('\n')[0].trim();
                    showHUD(`✔ [2/4] 已锁定目标车次：${trainText} (${targetTime || ''})，正在选座...`, 'rgba(40, 167, 69, 0.95)');

                    const nextBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (nextBtn && !nextBtn.disabled) {
                        safeClick(nextBtn);
                        trainSelected = true;
                    }
                    return;
                }
            }

            // 3. 核心选座阶段 (全车厢 1-5 智能遍历，就地补齐，绝对防抽搐)
            const countEl = document.querySelector('p[class*="_count_"], [class*="count"]');
            const carriageBtns = Array.from(document.querySelectorAll('button[class*="_carriageContainer_"], [class*="carriage"] button')).filter(b => {
                const t = (b.innerText || '').trim();
                return t.includes('号车') || t.includes('号車') || t.includes('Car');
            });

            // 构造结构化车厢列表，并按车厢编号 1 -> 2 -> 3 -> 4 -> 5 严格升序排序
            const carList = carriageBtns.map(btn => {
                const num = parseInt((btn.innerText || '').match(/\d+/)?.[0] || '0', 10);
                const isExp = isCarriageExpanded(btn);
                const card = getCarCard(btn);
                return { num, btn, isExpanded: isExp, card };
            }).filter(c => c.num > 0).sort((a, b) => a.num - b.num);

            if (countEl || carList.length > 0) {
                let curSelected = 0;
                let maxAllowed = targetUnits || 2;

                if (countEl) {
                    const m = (countEl.innerText || '').match(/(\d+)\s*\/\s*(\d+)/);
                    if (m) {
                        curSelected = parseInt(m[1], 10);
                        const domMax = parseInt(m[2], 10);
                        // 【最高安全级截断】：死死限制最大座位数为 targetUnits (2人)，绝对禁止选超过 2 个座位！
                        maxAllowed = Math.min(domMax, targetUnits || 2);
                    }
                }

                const selectedSeats = Array.from(document.querySelectorAll('button[class*="_selected_"]'));
                if (!countEl) curSelected = selectedSeats.length;

                // 【规则 1：满额绝对强锁】只要达到 2/2，停止一切车厢切换与选座，死命点击提交！
                if (curSelected >= maxAllowed || isSeatLocked) {
                    isSeatLocked = true;
                    showHUD(`🎉 成功锁定 ${curSelected}/${maxAllowed} 席位！正在全力提交直达支付...`, 'rgba(40, 167, 69, 0.95)');
                    const submitBtn = document.querySelector('div[class*="_footer_"] button:not([class*="outlined"]), footer button:last-child');
                    if (submitBtn && !submitBtn.disabled) {
                        safeClick(submitBtn);
                    }
                    return;
                }

                // 操作冷却防抖 (500ms)
                if (isActionPending && (now - lastActionTime < 500)) return;
                isActionPending = false;

                // 找到当前已展开的车厢对象
                const currentExpandedCar = carList.find(c => c.isExpanded);

                // 辅助函数：在指定车厢内寻找最佳座位并点击 (偶数连座 > 偶数对坐 > 偶数排 > 就地补齐)
                function pickBestSeatInCar(carObj) {
                    if (!carObj || !carObj.card) return false;
                    const card = carObj.card;
                    const groups = Array.from(card.querySelectorAll('div[class*="_group_"]'));

                    // 解析排号
                    const parsedGroups = groups.map(g => {
                        const gNum = parseInt(g.querySelector('span[class*="_groupId_"]')?.innerText || '0', 10);
                        const availSeats = Array.from(g.querySelectorAll('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])'));
                        return { groupDiv: g, groupNum: gNum, isEven: (gNum > 0 && gNum % 2 === 0), availSeats };
                    }).filter(g => g.groupNum > 0);

                    const evenGroups = parsedGroups.filter(g => g.isEven);

                    // 1. 优先找偶数连座 (同桌 A+B 或 C+D)
                    for (const g of evenGroups) {
                        const letters = g.availSeats.map(b => (b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase());
                        let pick = null;
                        if (letters.includes('A') && letters.includes('B')) pick = g.availSeats.find(b => ['A', 'B'].includes((b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase()));
                        else if (letters.includes('C') && letters.includes('D')) pick = g.availSeats.find(b => ['C', 'D'].includes((b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase()));

                        if (pick) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(pick);
                            showHUD(`🎯 锁定：偶数连座席位！`, 'rgba(40, 167, 69, 0.95)');
                            return true;
                        }
                    }

                    // 2. 其次找偶数前后对坐 (同桌面对面 A+D 或 B+C)
                    for (const g of evenGroups) {
                        const letters = g.availSeats.map(b => (b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase());
                        let pick = null;
                        if (letters.includes('A') && letters.includes('D')) pick = g.availSeats.find(b => ['A', 'D'].includes((b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase()));
                        else if (letters.includes('B') && letters.includes('C')) pick = g.availSeats.find(b => ['B', 'C'].includes((b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase()));

                        if (pick) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(pick);
                            showHUD(`🎯 锁定：偶数前后对坐席位！`, 'rgba(40, 167, 69, 0.95)');
                            return true;
                        }
                    }

                    // 3. 找偶数排任意空位
                    for (const g of evenGroups) {
                        if (g.availSeats.length > 0) {
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(g.availSeats[0]);
                            showHUD(`🎯 锁定：偶数排席位 (${curSelected + 1}/${maxAllowed})...`, 'rgba(40, 167, 69, 0.95)');
                            return true;
                        }
                    }

                    // 4. 当前车厢任意剩余可用空座 (无论奇偶，就地补齐满额，绝不跨车)
                    const anyAvail = card.querySelector('button[class*="_seatInner_"]:not([disabled]):not([class*="_disabled_"]):not([class*="_selected_"])');
                    if (anyAvail) {
                        isActionPending = true;
                        lastActionTime = now;
                        safeClick(anyAvail);
                        showHUD(`💺 就地补齐席位 (${curSelected + 1}/${maxAllowed})...`, 'rgba(40, 167, 69, 0.95)');
                        return true;
                    }

                    return false;
                }

                // =========================================================
                // 模式 1: 如果有推送推荐的目标座位 (plannedSeats)
                // =========================================================
                if (plannedSeats && plannedSeats.length > 0) {
                    const unpickedTarget = plannedSeats.find(t => {
                        return !selectedSeats.some(s => {
                            const span = s.querySelector('span') || s;
                            const sLetter = (span.innerText || '').trim().toUpperCase();
                            const groupDiv = s.closest('div[class*="_group_"]');
                            const groupNum = groupDiv ? parseInt(groupDiv.querySelector('span[class*="_groupId_"]')?.innerText || '0', 10) : 0;
                            return groupNum === t.group && sLetter === t.seat;
                        });
                    });

                    if (unpickedTarget) {
                        const targetCarObj = carList.find(c => c.num === unpickedTarget.carId);

                        // 1. 如果目标车厢未展开：展开它 (1200ms 防抖)
                        if (targetCarObj && !targetCarObj.isExpanded) {
                            if (now - lastCarSwitchTime > 1200) {
                                lastCarSwitchTime = now;
                                isActionPending = true;
                                lastActionTime = now;
                                safeClick(targetCarObj.btn);
                                showHUD(`🔍 正在展开目标车厢：${unpickedTarget.carId} 号车...`, 'rgba(0, 122, 255, 0.95)');
                            }
                            return;
                        }

                        // 2. 如果目标车厢已展开：在该车厢中找推荐座
                        if (targetCarObj && targetCarObj.isExpanded) {
                            const card = targetCarObj.card;
                            const groupSpans = Array.from(card.querySelectorAll('span[class*="_groupId_"]'));
                            const matchedGroupSpan = groupSpans.find(sp => parseInt((sp.innerText || '').trim(), 10) === unpickedTarget.group);
                            let found = false;

                            if (matchedGroupSpan) {
                                const groupDiv = matchedGroupSpan.closest('div[class*="_group_"]');
                                if (groupDiv) {
                                    const seatBtns = Array.from(groupDiv.querySelectorAll('button[class*="_seatInner_"]'));
                                    const matchedSeatBtn = seatBtns.find(b => {
                                        const sLetter = (b.querySelector('span')?.innerText || b.innerText || '').trim().toUpperCase();
                                        return sLetter === unpickedTarget.seat;
                                    });

                                    if (matchedSeatBtn && !matchedSeatBtn.disabled && !matchedSeatBtn.className.includes('_disabled_')) {
                                        if (!matchedSeatBtn.className.includes('_selected_')) {
                                            isActionPending = true;
                                            lastActionTime = now;
                                            safeClick(matchedSeatBtn);
                                            found = true;
                                            showHUD(`🎯 锁定推荐席位：${unpickedTarget.carId}号车 ${unpickedTarget.group}${unpickedTarget.seat}！`, 'rgba(40, 167, 69, 0.95)');
                                            return;
                                        }
                                    }
                                }
                            }

                            // 【彻底消灭抽搐】：若目标座未找到或已被抢，立即清空 plannedSeats，就地转入当前车厢补齐！
                            if (!found) {
                                console.warn('[嵯峨野助手] 目标座位在当前车厢不可用，立即清空推荐目标，就地补齐:', unpickedTarget);
                                showHUD(`⚠️ 席位 ${unpickedTarget.carId}车${unpickedTarget.group}${unpickedTarget.seat} 未找到，就地在当前车厢补齐！`, 'rgba(255, 149, 0, 0.95)');
                                plannedSeats = [];
                            }
                        }
                    }
                }

                // =========================================================
                // 模式 2: 就地补齐优先（绝对死守当前车厢，绝不跨车反复横跳）
                // =========================================================
                if (currentExpandedCar) {
                    // 如果当前车厢能够选到座位，立即执行
                    const picked = pickBestSeatInCar(currentExpandedCar);
                    if (picked) return;

                    // 若当前车厢可用空座已被选完或无座：
                    // 按 1 -> 2 -> 3 -> 4 -> 5 顺次单向寻找下一个未检查的车厢 (带 1500ms 防抖)
                    if (now - lastCarSwitchTime > 1500) {
                        visitedCars.add(currentExpandedCar.num);

                        // 按 1 -> 2 -> 3 -> 4 -> 5 严格单向递增查找
                        const nextCarObj = carList.find(c => c.num > currentExpandedCar.num && !visitedCars.has(c.num)) ||
                                           carList.find(c => !visitedCars.has(c.num));

                        if (nextCarObj) {
                            lastCarSwitchTime = now;
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(nextCarObj.btn);
                            showHUD(`🔄 ${currentExpandedCar.num}号车已无可用空座，顺次探查：${nextCarObj.num}号车...`, 'rgba(255, 149, 0, 0.95)');
                            return;
                        } else {
                            // 所有 1-5 车厢都探查过一遍
                            visitedCars.clear(); // 循环一轮后重置，允许重新轮询
                        }
                    }
                } else if (carList.length > 0) {
                    // 当前没有任何车厢展开：按 1 -> 2 -> 3 -> 4 -> 5 顺次展开第一个未探查车厢 (1200ms 防抖)
                    if (now - lastCarSwitchTime > 1200) {
                        const targetCarObj = carList.find(c => !visitedCars.has(c.num)) || carList[0];
                        if (targetCarObj) {
                            lastCarSwitchTime = now;
                            isActionPending = true;
                            lastActionTime = now;
                            safeClick(targetCarObj.btn);
                            showHUD(`🔍 正在探查 ${targetCarObj.num} 号车厢...`, 'rgba(0, 122, 255, 0.95)');
                            return;
                        }
                    }
                }
            }
        }, 300);
    }

    // =============================================================
    // 阶段 3: 乘车人信息填写与直达 Visa 信用卡输入框
    // =============================================================
    if (window.location.pathname.includes('/booking/participant') || window.location.pathname.includes('/booking/order')) {
        showHUD('✍️ 正在全自动填报乘车人信息并勾选条款...', 'rgba(0, 122, 255, 0.95)');

        const passengerInfo = {
            firstName: 'XIN',
            lastName: 'WANG',
            email: 'xnan_19@163.com',
            tel: '17671856274',
            country: 'China'
        };

        const fillTimer = setInterval(() => {
            let filledCount = 0;

            const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select'));
            inputs.forEach(inp => {
                const name = (inp.name || inp.id || inp.getAttribute('placeholder') || '').toLowerCase();
                const type = (inp.type || '').toLowerCase();

                if (type === 'checkbox') {
                    if (!inp.checked) {
                        inp.checked = true;
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        inp.click();
                    }
                    return;
                }

                if (name.includes('first') || name.includes('mei') || name.includes('名')) {
                    if (inp.value !== passengerInfo.firstName) {
                        inp.value = passengerInfo.firstName;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                } else if (name.includes('last') || name.includes('sei') || name.includes('姓')) {
                    if (inp.value !== passengerInfo.lastName) {
                        inp.value = passengerInfo.lastName;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                } else if (name.includes('mail')) {
                    if (inp.value !== passengerInfo.email) {
                        inp.value = passengerInfo.email;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                } else if (name.includes('tel') || name.includes('phone')) {
                    if (inp.value !== passengerInfo.tel) {
                        inp.value = passengerInfo.tel;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                }
            });

            // 自动勾选所有同意框
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => {
                if (!cb.checked) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });

            // 自动点击“次へ / 支払いに進む / 注文を確定する”直达官方 Visa 支付框
            const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                return (t.includes('次へ') || t.includes('支払') || t.includes('確認') || t.includes('確定')) && !b.disabled;
            });

            if (nextBtns.length > 0) {
                safeClick(nextBtns[nextBtns.length - 1]);
                showHUD('💳 乘车人已填报，已直达官方信用卡支付框！请准备付款！', 'rgba(40, 167, 69, 0.95)');
                clearInterval(fillTimer);
            }
        }, 500);
    }
})();
