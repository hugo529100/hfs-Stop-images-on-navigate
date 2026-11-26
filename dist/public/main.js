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
            farPx: Math.max(200, (strict ? 0 : buffer) + 200), // 超過這個距離直接打斷，不等 delay
            gate: c.gateUntilListReady !== false              // 預設：先等清單統計完再放行縮略圖
        }
    }

    let CFG = readConfig()

    // ============================================================
    // 1. 共用常數 / 白名單
    // ============================================================
    const DIR_SELECTOR = '.dir'
    const THUMB_SELECTOR = 'img.thumbnail'
    const SUSPEND_CLASS = 'scroll-suspended'   // 視口外：隱藏並拿掉 src（原有行為）
    const GATE_CLASS = 'list-gate-hold'        // 清單還沒好：縮略圖先收起，顯示原生圖標
    const DS_ORIGINAL = 'scrollOriginalSrc'
    const DS_SUSPENDED = 'scrollSuspended'

    const defaultWhitelist = ['/images/banner/']

    // 切換目錄時要對全頁圖片查白名單，這裡做個短快取避免反覆解析設定
    let whitelistCache = null
    let whitelistCacheAt = 0

    function getWhitelist() {
        const now = Date.now()
        if (whitelistCache && now - whitelistCacheAt < 2000) return whitelistCache
        let list = defaultWhitelist
        try {
            const config = HFS.getPluginConfig()
            if (config && config.whitelist) {
                list = config.whitelist.split('\n')
                    .map(item => item.trim())
                    .filter(item => item.length > 0)
            }
        } catch (e) {}
        whitelistCache = list
        whitelistCacheAt = now
        return list
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

    // 只有縮略圖請求（?get=thumb）需要被閘門攔下來；其他圖片照舊
    function isThumbUrl(src) {
        return !!src && !src.startsWith('data:') && src.includes('?get=thumb')
    }

    // ============================================================
    // 2. 一次性放行閘門（做法對齊 MVfiles-covers 8.7）
    // ------------------------------------------------------------
    // 換到新資料夾時先關閘：這段期間不送出任何縮略圖請求，格子先
    // 顯示 HFS 原生的檔案類型圖標；等第一次 get_file_list／#folder-stats
    // 統計結束後才放行，而且每個資料夾只放行一次。之後的滾動、追加、
    // stats 再變都不會重新關閘，只有再換資料夾才會重新武裝。
    // 這樣清單／統計請求不會被幾十張縮略圖卡在同一個連線佇列後面。
    // ============================================================
    const listGate = {
        open: true,            // true = 這個資料夾已放行（正常載入縮略圖）
        hasActivity: false,    // 是否看到清單／統計正在進行
        statsText: undefined,  // 上一次看到的 #folder-stats 文字
        armedAt: 0,
        entriesAt: 0,
        token: 0,
        timer: 0
    }

    let held = false           // 影片播放 / file-show 期間由對方接管

    function listStatsText() {
        const el = document.getElementById('folder-stats')
        return el ? el.textContent : ''
    }

    function listHasEntries() {
        return document.querySelectorAll(`${DIR_SELECTOR} li.file, ${DIR_SELECTOR} [data-uri]`).length > 0
    }

    // ------------------------------------------------------------
    // 原生圖標：HFS 沒有縮略圖時顯示的是 entry.getDefaultIcon()，
    // 也就是 <span class="icon font-icon fa-image">（字型還沒好時是
    // emoji，自訂圖標時是 file-icon 背景圖）。閘門期間直接借用
    // entry.getDefaultIcon() 的名稱組出同一個圖標，取代裂圖框架。
    // ------------------------------------------------------------
    const GATE_ICON_ATTR = 'data-hfs-gate-icon'
    const gateIcons = new WeakMap()            // img -> span

    // 與 HFS 的 SYS_ICONS 對齊（只列檔案類型會用到的，以及有改名的）
    const ICON_CLASS_OVERRIDES = {
        file: 'doc', login: 'user', user: 'user', search_off: 'cancel', close: 'cancel',
        error: 'cancel', options: 'cog', parent: 'left', list: 'menu', menu: 'menu',
        repeat: 'reload', success: 'check', total: 'spin6', spinner: 'spin6 spinner'
    }
    const ICON_EMOJI = {
        image: '📸', video: '🎥', audio: '🎧', file: '📄', folder: '📂',
        link: '↗', archive: '📦', spinner: '🎲', warning: '⚠️'
    }
    // 與 HFS 的 ext2type 相同
    const EXT_TYPES = {
        jpeg: 'image', jpg: 'image', gif: 'image', png: 'image', webp: 'image', svg: 'image',
        mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio',
        mp4: 'video', mpeg: 'video', mpg: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video',
        zip: 'archive', rar: 'archive', gz: 'archive', tgz: 'archive'
    }

    let entryIndex = null
    let entryIndexList = null
    let entryIndexCount = -1

    // 從清單條目反查 HFS 的 entry 物件（快取，避免大資料夾 O(n²)）
    function anchorOf(img) {
        return img.closest('a') || img.closest('li')?.querySelector('.link-wrapper a') || null
    }

    function getEntryFor(img) {
        const a = anchorOf(img)
        if (!a || !(a instanceof HTMLAnchorElement)) return null
        const list = HFS.state && HFS.state.list
        if (!Array.isArray(list)) return null
        if (entryIndexList !== list || entryIndexCount !== list.length) {
            entryIndex = new Map()
            for (const e of list) {
                try { entryIndex.set(decodeURI(e.uri), e) } catch (err) {}
            }
            entryIndexList = list
            entryIndexCount = list.length
        }
        let key
        try { key = decodeURI(a.pathname) } catch (e) { key = a.pathname }
        return entryIndex.get(key) || null
    }

    function iconNameOf(entry) {
        if (!entry) return null
        try {
            const el = entry.getDefaultIcon && entry.getDefaultIcon()
            const name = el && el.props && el.props.name
            if (name != null && name !== '') return String(name)
        } catch (e) {}
        if (entry.icon === true) return entry.uri ? entry.uri + '?get=icon' : null
        if (entry.icon) return String(entry.icon)
        if (entry.isFolder || entry.web) return 'folder'
        if (entry.url) return 'link'
        return EXT_TYPES[entry.ext] || 'file'
    }

    function iconNameFromPath(path) {
        if (!path) return null
        if (path.endsWith('/')) return 'folder'
        const m = /\.([^./]+)$/.exec(path)
        return m ? (EXT_TYPES[m[1].toLowerCase()] || 'file') : 'file'
    }

    // 重現 HFS Icon 元件的輸出
    function buildIconSpan(name) {
        if (!name) return null
        const span = document.createElement('span')
        span.className = 'icon'
        span.setAttribute('role', 'img')
        span.setAttribute('aria-hidden', 'true')

        const custom = HFS.icons
        const mapped = String((custom && custom[name]) || name)
        const isUrl = mapped.length > 1 && /[/?]/.test(mapped)
        if (isUrl) {
            span.classList.add('file-icon')
            span.style.backgroundImage = 'url(' + JSON.stringify(mapped) + ')'
            return span
        }

        const clazz = ICON_CLASS_OVERRIDES[mapped] === undefined ? mapped : ICON_CLASS_OVERRIDES[mapped]
        const iconsReady = !(HFS.state && HFS.state.iconsReady === false)
        if (iconsReady && clazz) {
            span.classList.add('font-icon')
            const parts = String(clazz).split(/\s+/)
            if (parts[0]) span.classList.add('fa-' + parts[0])
            for (let i = 1; i < parts.length; i++) if (parts[i]) span.classList.add(parts[i])
            return span
        }

        span.classList.add('emoji-icon')
        span.textContent = ICON_EMOJI[mapped] ||
            (mapped.length === 1 || /[^\x00-\x7F]/.test(mapped) ? mapped : '#')
        return span
    }

    function showGateIcon(img) {
        if (gateIcons.has(img) || !img.parentNode) return
        let name = iconNameOf(getEntryFor(img))
        if (!name) {
            const a = anchorOf(img)
            let path = ''
            try { path = a ? decodeURI(a.pathname) : '' } catch (e) {}
            name = iconNameFromPath(path)
        }
        const span = buildIconSpan(name)
        if (!span) return
        span.setAttribute(GATE_ICON_ATTR, '1')
        // 放在原本縮略圖的位置，再把縮略圖收起來，版面就等於原生圖標
        img.parentNode.insertBefore(span, img)
        img.style.display = 'none'
        gateIcons.set(img, span)
    }

    function removeGateIcon(img) {
        const span = gateIcons.get(img)
        if (!span) return
        gateIcons.delete(img)
        if (span.parentNode) span.parentNode.removeChild(span)
        if (img.style.display === 'none') img.style.display = ''
    }

    function openListGate() {
        if (listGate.open) return
        listGate.open = true
        listGate.token++
        if (listGate.timer) {
            clearTimeout(listGate.timer)
            listGate.timer = 0
        }
        releaseGate()
        if (!held) scheduleSweep(50)
    }

    // 放行：可見的換回真縮略圖；其餘收掉原生圖標、回到一般的視口外掛起，
    // 這樣 IntersectionObserver 仍然看得到它們的盒子（display 不能是 none）。
    function releaseGate() {
        const vp = viewportRect()
        document.querySelectorAll(`${DIR_SELECTOR} ${THUMB_SELECTOR}`).forEach(img => {
            if (!img.classList.contains(GATE_CLASS)) return
            if (!isDirThumb(img) || !img.dataset[DS_SUSPENDED]) {
                removeGateIcon(img)
                img.classList.remove(GATE_CLASS)
                return
            }
            if (!held && measure(img, null, vp).visible) {
                clearPendingSuspend(img)
                resume(img)
            } else {
                suspend(img)
            }
        })
        // 不在檔案清單裡的圖（例如檔案選單預覽）直接還原
        releaseNonListGated()
    }

    function armListGate(uri) {
        if (!CFG.gate) {
            listGate.open = true
            return
        }
        listGate.open = false
        listGate.hasActivity = false
        listGate.entriesAt = 0
        listGate.armedAt = Date.now()
        // 保留上一頁的統計文字當基準，才偵測得到「換頁後統計開始跳動」
        listGate.statsText = listStatsText()
        watchListGate()
        holdListThumbs()
    }

    function watchListGate() {
        const token = ++listGate.token
        // 用 timer 而不是 rAF：背景分頁／無動畫的環境 rAF 會停擺，
        // 閘門就永遠不會放行；timer 最多被節流到 1 秒，仍會自己恢復。
        const tick = () => {
            if (token !== listGate.token || listGate.open) return
            const loading = Boolean(HFS.state && HFS.state.loading)
            const text = listStatsText()
            const now = Date.now()

            if (loading) listGate.hasActivity = true

            if (text !== listGate.statsText) {
                listGate.statsText = text
                if (text) listGate.hasActivity = true
            }

            // 其他主題沒有 stats／loading 訊號時：換頁後先等 300ms（避開舊清單），
            // 清單出現並再穩定 250ms 後才放行。
            if (!listGate.hasActivity && now - listGate.armedAt > 300) {
                if (listHasEntries()) {
                    if (!listGate.entriesAt) listGate.entriesAt = now
                    else if (now - listGate.entriesAt > 250) listGate.hasActivity = true
                } else {
                    listGate.entriesAt = 0
                }
            }

            // 統計一結束就立刻放行（和 MVfiles-covers 一致，不另外等文字穩定）
            if (listGate.hasActivity && !loading) {
                openListGate()
                return
            }
            // 保險：完全沒有訊號、或 loading 卡住時，別讓縮略圖永遠空白
            if ((!listGate.hasActivity && now - listGate.armedAt > 2500) ||
                now - listGate.armedAt > 20000) {
                openListGate()
                return
            }
            listGate.timer = setTimeout(tick, 120)
        }
        listGate.timer = setTimeout(tick, 120)
    }

    function initListGate() {
        if (!CFG.gate) {
            listGate.open = true
            return
        }
        // 這份清單若已經載入完成，就不必再關閘
        if (!(HFS.state && HFS.state.loading) && listHasEntries()) {
            listGate.open = true
            return
        }
        armListGate(HFS.state && HFS.state.uri)
    }

    // ------------------------------------------------------------
    // 攔 src：React 是「先建節點、設好 src、才插進 DOM」，
    // MutationObserver 看到時請求早就送出去了。要真正把請求擋在
    // 閘門後面，只能攔 setAttribute。只攔 ?get=thumb，且只在關閘時。
    // ------------------------------------------------------------
    const nativeSetAttribute = Element.prototype.setAttribute
    let srcGateInstalled = false

    function installSrcGate() {
        if (srcGateInstalled) return
        srcGateInstalled = true
        Element.prototype.setAttribute = function (name, value) {
            try {
                if (!listGate.open && this && this.tagName === 'IMG' &&
                    typeof name === 'string' && name.toLowerCase() === 'src' && value != null) {
                    const v = String(value)
                    if (isThumbUrl(v)) {
                        this.dataset[DS_ORIGINAL] = v
                        this.dataset[DS_SUSPENDED] = '1'
                        this.classList.add(GATE_CLASS)
                        // 不放 src：連佔位圖都不進網路佇列，也不會觸發
                        // load 事件去污染其他插件的「已載入」快取
                        this.removeAttribute('src')
                        return
                    }
                }
            } catch (e) {}
            return nativeSetAttribute.call(this, name, value)
        }
    }

    // 放行某張被閘門攔下的圖（還原它真正的 src）
    function releaseGatedImage(img) {
        if (!img || !img.dataset || !img.dataset[DS_SUSPENDED]) return
        const original = img.dataset[DS_ORIGINAL]
        delete img.dataset[DS_SUSPENDED]
        img.classList.remove(GATE_CLASS)
        img.classList.remove(SUSPEND_CLASS)
        removeGateIcon(img)
        if (original && img.getAttribute('src') !== original) {
            nativeSetAttribute.call(img, 'src', original)
        }
    }

    // 放行時，把被攔到、但不在檔案清單裡的圖還原
    function releaseNonListGated() {
        document.querySelectorAll('img').forEach(img => {
            if (!img.dataset[DS_SUSPENDED]) return
            if (img.closest(DIR_SELECTOR)) return
            releaseGatedImage(img)
        })
    }

    // ============================================================
    // 3. 切換目錄：全量打斷（原有行為）
    // ============================================================
    let lastUri = HFS.state.uri

    function stopAllImages() {
        const whitelist = getWhitelist()
        document.querySelectorAll('img').forEach(img => {
            clearPendingSuspend(img)
            removeGateIcon(img)
            const src = img.getAttribute('src') || ''
            if (!shouldBlock(src, whitelist)) return
            try { img.onload = null; img.onerror = null } catch (e) {}
            if (src && !src.startsWith('data:')) {
                img.removeAttribute('src')
            }
        })
    }

    // ============================================================
    // 4. 視口嚴格管控
    // ============================================================
    const pendingSuspend = new WeakMap()   // img -> timer id
    let scrollIO = null
    let sweepTimer = 0
    let viewportTimer = 0

    function isDirThumb(img) {
        if (!img || img.tagName !== 'IMG') return false
        if (!img.matches(THUMB_SELECTOR)) return false
        if (!img.closest(DIR_SELECTOR)) return false
        // 先看備份的原始 src：閘門/掛起期間 src 可能是佔位圖標或不存在
        const src = img.dataset[DS_ORIGINAL] || img.getAttribute('src') || ''
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
        if (!img) return { visible: false, dist: Number.MAX_SAFE_INTEGER }
        // 閘門期間縮略圖本身是 display:none，量它的原生圖標才準
        const el = gateIcons.get(img) || img
        if (!el.isConnected) return { visible: false, dist: Number.MAX_SAFE_INTEGER }
        const r = el.getBoundingClientRect()
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

    // useGateStyle：清單還沒好時，先拿掉 src 但保留格子、改由 CSS 畫
    // 佔位圖標（不進網路佇列）；其餘情況維持原本「隱藏 + 拿掉 src」。
    function suspend(img, useGateStyle) {
        if (!isDirThumb(img)) return
        const original = img.dataset[DS_ORIGINAL] || img.getAttribute('src') || ''
        if (!original || original.startsWith('data:')) return
        if (!img.dataset[DS_ORIGINAL]) img.dataset[DS_ORIGINAL] = original
        img.dataset[DS_SUSPENDED] = '1'

        if (useGateStyle && !listGate.open) {
            img.classList.remove(SUSPEND_CLASS)
            img.classList.add(GATE_CLASS)
            img.removeAttribute('src')
            showGateIcon(img)
            return
        }

        img.classList.remove(GATE_CLASS)
        img.classList.add(SUSPEND_CLASS)
        img.removeAttribute('src')
        removeGateIcon(img)
    }

    function resume(img) {
        if (!img.dataset[DS_SUSPENDED]) return
        if (!listGate.open) return                    // 還在等清單，維持佔位
        removeGateIcon(img)
        delete img.dataset[DS_SUSPENDED]
        img.classList.remove(GATE_CLASS)
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
        if (!listGate.open) {                        // 清單還沒好：一律先掛起
            clearPendingSuspend(img)
            suspend(img, true)
            return
        }
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
            if (held || !listGate.open) return
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

    // 閘門期間：清單裡的縮略圖全部先掛起，格子先顯示佔位圖標
    function holdListThumbs() {
        document.querySelectorAll(`${DIR_SELECTOR} ${THUMB_SELECTOR}`).forEach(img => {
            if (!isDirThumb(img)) return
            if (img.classList.contains('thumbnail-suspended')) return
            clearPendingSuspend(img)
            suspend(img, true)
        })
    }

    function resumeVisible() {
        if (!listGate.open) {
            holdListThumbs()
            return
        }
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
        if (!listGate.open) {                        // 清單還沒好：全部先掛起
            holdListThumbs()
            return
        }
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
                if (!listGate.open) {
                    suspend(img, true)
                    continue
                }
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
        if (!CFG.gate && !listGate.open) openListGate()
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

    // 分頁 / HFS 重新渲染後補掛觀察；閘門期間新出現的縮略圖一律先掛起
    function adoptThumb(img) {
        if (!img) return
        if (!listGate.open && img.closest(DIR_SELECTOR)) suspend(img, true)
        observeThumb(img)
    }

    const mo = new MutationObserver(muts => {
        for (const m of muts) {
            if (m.type === 'attributes') {
                // 有插件用 img.src = ...（屬性 setter）繞過上面的攔截時，這裡補一刀
                const img = m.target
                if (!listGate.open && img.tagName === 'IMG' && img.closest(DIR_SELECTOR)) {
                    const src = img.getAttribute('src')
                    if (isThumbUrl(src)) suspend(img, true)
                }
                continue
            }
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue
                // 被閘門攔下、但不是縮略圖的圖（例如自訂封面）不由視口邏輯管理，
                // 插進 DOM 後就立刻還原，免得永遠卡在沒有 src 的狀態。
                if (node.tagName === 'IMG') {
                    if (node.dataset[DS_SUSPENDED] && !node.matches(THUMB_SELECTOR)) releaseGatedImage(node)
                }
                if (node.querySelectorAll) {
                    node.querySelectorAll('img').forEach(img => {
                        if (img.dataset[DS_SUSPENDED] && !img.matches(THUMB_SELECTOR)) releaseGatedImage(img)
                    })
                    node.querySelectorAll(THUMB_SELECTOR).forEach(adoptThumb)
                }
                if (node.matches?.(THUMB_SELECTOR)) adoptThumb(node)
            }
            // 縮略圖被 React 抽掉時，一併收掉它的原生圖標，避免留下孤兒
            for (const node of m.removedNodes) {
                if (node.nodeType !== 1) continue
                if (node.tagName === 'IMG') removeGateIcon(node)
                if (node.querySelectorAll) node.querySelectorAll('img').forEach(removeGateIcon)
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
    // 5. 給其他插件（Videos-player+ 的 playbackMemoryGuard）的統一接口
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
        isListReady: () => listGate.open,
        setHold: setHold,
        suspendAll: suspendAll,
        resumeVisible: resumeVisible,
        refresh: () => refreshViewport(true)
    }
    window.__hfsThumbGate = gate

    // ============================================================
    // 6. 啟動
    // ============================================================
    installSrcGate()
    initListGate()
    buildScrollIO()
    observeAllDirThumbs()
    if (document.body) {
        mo.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src']
        })
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            mo.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            })
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
        armListGate(uri)
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
