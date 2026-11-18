'use strict';{
    // ============================================================
    // 0. 設定（每次畫面尺寸變動會重新讀取）
    // ============================================================
    function num(v, def, min, max) {
        v = Number(v)
        if (!isFinite(v)) return def
        return Math.min(max, Math.max(min, v))
    }

    function readConfig() {
        let c = {}
        try { c = HFS.getPluginConfig() || {} } catch (e) {}
        const strict = c.strictMode !== false          // 預設嚴格：視口外一律打斷
        const delay = num(c.suspendDelay, 120, 0, 3000)
        const buffer = num(c.scrollRootMargin, 100, 0, 2000)
        return {
            strict: strict,
            delay: delay,
            margin: strict ? 0 : buffer,
            farPx: Math.max(200, (strict ? 0 : buffer) + 200) // 超過這個距離直接打斷，不等 delay
        }
    }

    let CFG = readConfig()

    // ============================================================
    // 1. 切換目錄：全量打斷（原有行為）
    // ============================================================
    let lastUri = HFS.state.uri

    const defaultWhitelist = ['/images/banner/']

    function getWhitelist() {
        try {
            const config = HFS.getPluginConfig()
            if (config && config.whitelist) {
                return config.whitelist.split('\n')
                    .map(item => item.trim())
                    .filter(item => item.length > 0)
            }
        } catch (e) {}
        return defaultWhitelist
    }

    function isInWhitelist(src, whitelist) {
        if (!src) return false
        if (src.startsWith('data:')) return true
        for (const pattern of whitelist) {
            if (src.includes(pattern)) return true
        }
        return false
    }

    function shouldBlock(src, whitelist) {
        if (!src) return false
        if (src.startsWith('data:')) return false
        if (src.includes('?get=thumb')) return true
        if (isInWhitelist(src, whitelist)) return false
        return true
    }

    function stopAllImages() {
        const whitelist = getWhitelist()
        document.querySelectorAll('img').forEach(img => {
            clearPendingSuspend(img)
            const src = img.getAttribute('src') || ''
            if (!shouldBlock(src, whitelist)) return
            try { img.onload = null; img.onerror = null } catch (e) {}
            if (src && !src.startsWith('data:')) {
                img.removeAttribute('src')
            }
        })
    }

    // ============================================================
    // 2. 視口嚴格管控
    // ============================================================
    const DIR_SELECTOR = '.dir'
    const THUMB_SELECTOR = 'img.thumbnail'
    const SUSPEND_CLASS = 'scroll-suspended'
    const DS_ORIGINAL = 'scrollOriginalSrc'
    const DS_SUSPENDED = 'scrollSuspended'

    const pendingSuspend = new WeakMap()   // img -> timer id
    let scrollIO = null
    let held = false                       // 影片播放 / file-show 期間由對方接管
    let sweepTimer = 0
    let viewportTimer = 0

    function isDirThumb(img) {
        if (!img || img.tagName !== 'IMG') return false
        if (!img.matches(THUMB_SELECTOR)) return false
        if (!img.closest(DIR_SELECTOR)) return false
        const src = img.getAttribute('src') || img.dataset[DS_ORIGINAL] || ''
        if (!src || src.startsWith('data:')) return false
        return true
    }

    // 真正可見的區域：layout viewport 與 visual viewport（手機網址列、雙指縮放）的交集
    function viewportRect() {
        const de = document.documentElement
        let left = 0
        let top = 0
        let right = de.clientWidth || window.innerWidth || 0
        let bottom = de.clientHeight || window.innerHeight || 0
        const vv = window.visualViewport
        if (vv && vv.width > 0 && vv.height > 0) {
            const l = Math.max(left, vv.offsetLeft)
            const t = Math.max(top, vv.offsetTop)
            const r = Math.min(right, vv.offsetLeft + vv.width)
            const b = Math.min(bottom, vv.offsetTop + vv.height)
            if (r > l && b > t) {
                left = l
                top = t
                right = r
                bottom = b
            }
        }
        return { left: left, top: top, right: right, bottom: bottom, w: right - left, h: bottom - top }
    }

    // 一次量測同時得到「是否在可見區域內」與「距離多遠」，避免重複讀 rect
    function measure(img, margin, viewport) {
        if (!img || !img.isConnected) return { visible: false, dist: Number.MAX_SAFE_INTEGER }
        const r = img.getBoundingClientRect()
        if (!r.width && !r.height) return { visible: false, dist: Number.MAX_SAFE_INTEGER } // 未排版 / display:none
        const vp = viewport || viewportRect()
        const m = margin == null ? CFG.margin : margin
        const visible = r.bottom > vp.top - m && r.top < vp.bottom + m &&
            r.right > vp.left - m && r.left < vp.right + m
        let dist = 0
        if (r.bottom <= vp.top) dist = vp.top - r.bottom
        else if (r.top >= vp.bottom) dist = r.top - vp.bottom
        else if (r.right <= vp.left) dist = vp.left - r.right
        else if (r.left >= vp.right) dist = r.left - vp.right
        return { visible: visible, dist: dist }
    }

    function isVisible(img, margin) {
        return measure(img, margin).visible
    }

    function clearPendingSuspend(img) {
        const t = pendingSuspend.get(img)
        if (t) {
            clearTimeout(t)
            pendingSuspend.delete(img)
        }
    }

    function suspend(img) {
        if (!isDirThumb(img)) return
        const src = img.getAttribute('src')
        if (!src || src.startsWith('data:')) return
        if (!img.dataset[DS_ORIGINAL]) img.dataset[DS_ORIGINAL] = src
        img.dataset[DS_SUSPENDED] = '1'
        img.classList.add(SUSPEND_CLASS)
        img.removeAttribute('src')
    }

    function resume(img) {
        if (!img.dataset[DS_SUSPENDED]) return
        delete img.dataset[DS_SUSPENDED]
        img.classList.remove(SUSPEND_CLASS)
        const original = img.dataset[DS_ORIGINAL]
        if (!original) return
        // 另一個插件（MVfiles-covers 的 file-show）仍然持有這張圖
        if (img.classList.contains('thumbnail-suspended')) return
        // 重置淡入標記，讓淡入插件對恢復的圖重新淡入
        delete img.dataset.fadeProcessed
        img.style.opacity = ''
        if (img.getAttribute('src') !== original) img.setAttribute('src', original)
    }

    // 排程打斷：遠離視口的立即打斷；只有邊緣附近才等 delay，避免臨界抖動
    function scheduleSuspend(img, immediate, known) {
        if (!isDirThumb(img)) return
        if (img.dataset[DS_SUSPENDED]) return
        const m = known || measure(img)
        if (m.visible) return                       // 還在視口內（0 尺寸也視為不可見）
        if (immediate || CFG.delay === 0 || m.dist > CFG.farPx) {
            clearPendingSuspend(img)
            suspend(img)
            return
        }
        if (pendingSuspend.has(img)) return
        pendingSuspend.set(img, setTimeout(() => {
            pendingSuspend.delete(img)
            if (held) return
            if (!isVisible(img)) suspend(img)
        }, CFG.delay))
    }

    function suspendAll() {
        document.querySelectorAll(`${DIR_SELECTOR} ${THUMB_SELECTOR}`).forEach(img => {
            if (!isDirThumb(img)) return
            clearPendingSuspend(img)
            suspend(img)
        })
    }

    function resumeVisible() {
        document.querySelectorAll(`${DIR_SELECTOR} ${THUMB_SELECTOR}`).forEach(img => {
            if (!isDirThumb(img)) return
            if (!isVisible(img)) return
            clearPendingSuspend(img)
            resume(img)
        })
    }

    // 全量校正：先讀完所有 rect，再一次性套用，避免 layout thrash
    function sweep(immediate) {
        if (held) return
        const imgs = document.querySelectorAll(`${DIR_SELECTOR} ${THUMB_SELECTOR}`)
        const vp = viewportRect()
        const toResume = []
        const toSchedule = []
        for (const img of imgs) {
            if (!isDirThumb(img)) continue
            const m = measure(img, null, vp)
            if (m.visible) toResume.push(img)
            else if (!img.dataset[DS_SUSPENDED]) toSchedule.push([img, m])
        }
        for (const img of toResume) {
            clearPendingSuspend(img)
            resume(img)
        }
        for (const [img, m] of toSchedule) scheduleSuspend(img, immediate, m)
    }

    function scheduleSweep(delay) {
        if (sweepTimer) return
        sweepTimer = setTimeout(() => {
            sweepTimer = 0
            sweep(false)
        }, delay == null ? 200 : delay)
    }

    // ------------------------------------------------------------
    // IntersectionObserver：視口邊緣即時觸發（margin 0 = 嚴格）
    // ------------------------------------------------------------
    function buildScrollIO() {
        if (scrollIO) {
            scrollIO.disconnect()
            scrollIO = null
        }
        if (typeof IntersectionObserver === 'undefined') return

        scrollIO = new IntersectionObserver(entries => {
            if (held) return
            for (const e of entries) {
                const img = e.target
                if (!isDirThumb(img)) continue
                if (e.isIntersecting) {
                    // IO 的 root 是 layout viewport；手機網址列/縮放時可視區域更小，
                    // 再用 measure() 確認一次，避免把「其實看不到」的圖恢復。
                    const m = measure(img)
                    if (m.visible) {
                        clearPendingSuspend(img)
                        resume(img)
                    } else {
                        scheduleSuspend(img, false, m)
                    }
                } else {
                    scheduleSuspend(img, false)
                }
            }
        }, { root: null, rootMargin: `${CFG.margin}px 0px`, threshold: 0 })
    }

    function observeThumb(img) {
        if (!scrollIO || !isDirThumb(img)) return
        scrollIO.observe(img)
    }

    function observeAllDirThumbs() {
        if (!scrollIO) return
        document.querySelectorAll(`${DIR_SELECTOR} ${THUMB_SELECTOR}`).forEach(observeThumb)
    }

    // ------------------------------------------------------------
    // 畫面尺寸 / 方向 / 縮放 / 切換頁面 → 重建觀察器並立即校正
    // ------------------------------------------------------------
    function refreshViewport(immediate) {
        CFG = readConfig()
        buildScrollIO()
        observeAllDirThumbs()
        if (!held) sweep(immediate !== false)
    }

    function scheduleViewportRefresh(kind) {
        clearTimeout(viewportTimer)
        viewportTimer = setTimeout(() => {
            viewportTimer = 0
            // 視窗尺寸/方向改變要立刻切斷；visualViewport（網址列滑動/雙指縮放）
            // 變化較頻繁，邊緣附近保留 delay，避免連續抖動。
            refreshViewport(kind !== 'visual')
        }, kind === 'orientation' ? 300 : 150)
    }

    window.addEventListener('resize', () => scheduleViewportRefresh('resize'), { passive: true })
    window.addEventListener('orientationchange', () => scheduleViewportRefresh('orientation'), { passive: true })
    try {
        if (screen.orientation && screen.orientation.addEventListener)
            screen.orientation.addEventListener('change', () => scheduleViewportRefresh('orientation'))
    } catch (e) {}

    if (window.visualViewport) {
        try {
            window.visualViewport.addEventListener('resize', () => scheduleViewportRefresh('visual'), { passive: true })
            window.visualViewport.addEventListener('scroll', () => scheduleSweep(150), { passive: true })
        } catch (e) {}
    }

    // ------------------------------------------------------------
    // 滾動：IO 之外的保險，滾動期間定期全量校正
    // ------------------------------------------------------------
    document.addEventListener('scroll', () => scheduleSweep(200), { passive: true, capture: true })
    document.addEventListener('scrollend', () => {
        if (sweepTimer) {
            clearTimeout(sweepTimer)
            sweepTimer = 0
        }
        sweep(false)
    }, { passive: true, capture: true })

    // 分頁 / HFS 重新渲染後補掛觀察
    const mo = new MutationObserver(muts => {
        if (!scrollIO) return
        for (const m of muts) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue
                if (node.matches?.(THUMB_SELECTOR)) observeThumb(node)
                if (node.querySelectorAll) {
                    node.querySelectorAll(THUMB_SELECTOR).forEach(observeThumb)
                }
            }
        }
    })

    // 背景分頁：全部打斷，回來再恢復可見的圖
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            suspendAll()
        } else {
            refreshViewport(true)
        }
    })

    // ============================================================
    // 3. 給其他插件（Videos-player+ 的 playbackMemoryGuard）的統一接口
    // ============================================================
    function setHold(v) {
        v = !!v
        if (v === held) {
            if (v) suspendAll()
            return
        }
        held = v
        if (v) {
            suspendAll()
        } else {
            resumeVisible()
            scheduleSweep(50)
        }
    }

    const gate = {
        version: 1,
        isStrict: () => CFG.strict,
        marginPx: () => CFG.margin,
        isVisible: img => isVisible(img),
        setHold: setHold,
        suspendAll: suspendAll,
        resumeVisible: resumeVisible,
        refresh: () => refreshViewport(true)
    }
    window.__hfsThumbGate = gate

    // ============================================================
    // 4. 啟動
    // ============================================================
    buildScrollIO()
    observeAllDirThumbs()
    if (document.body) {
        mo.observe(document.body, { childList: true, subtree: true })
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            mo.observe(document.body, { childList: true, subtree: true })
            observeAllDirThumbs()
        }, { once: true })
    }

    setTimeout(() => {
        refreshViewport(false)
    }, 300)
    setTimeout(() => {
        refreshViewport(false)
    }, 1000)

    HFS.watchState('uri', (uri) => {
        if (uri === lastUri) return
        lastUri = uri
        stopAllImages()
        // 新清單可能還在渲染，補兩次校正
        setTimeout(() => refreshViewport(true), 100)
        setTimeout(() => refreshViewport(true), 500)
    }, true)

    HFS.watchState('tile_size', () => {
        setTimeout(() => refreshViewport(true), 100)
    }, true)

    if (HFS.onEvent) {
        HFS.onEvent('afterList', () => {
            setTimeout(() => refreshViewport(false), 50)
            setTimeout(() => refreshViewport(false), 300)
        })
    }

    // 調試用
    window.stopImagesOnNavigate = gate
}
