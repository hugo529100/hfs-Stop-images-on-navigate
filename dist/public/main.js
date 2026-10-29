'use strict';{
    // ================= 原有层：切目录全量打断 =================
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
        const imgs = document.querySelectorAll('img')
        imgs.forEach(img => {
            const src = img.src || ''
            if (!shouldBlock(src, whitelist)) return
            img.onload = null
            img.onerror = null
            if (src && !src.startsWith('data:')) {
                img.removeAttribute('src')
            }
        })
    }

    HFS.watchState('uri', (uri) => {
        if (uri !== lastUri) {
            lastUri = uri
            stopAllImages()
        }
    }, true)

    // ================= 新增层：.dir 缩略图可见范围管控（带缓冲带，不闪） =================
    // 策略：IntersectionObserver + rootMargin 缓冲带。视口外 rootMargin 外才中断，
    // 回到 rootMargin 内才恢复。边缘图在缓冲带内状态稳定，不闪。
    const DIR_SELECTOR = '.dir'
    const THUMB_SELECTOR = 'img.thumbnail'

    function getRootMargin() {
        try {
            const config = HFS.getPluginConfig()
            if (config && config.scrollRootMargin != null) {
                const n = Number(config.scrollRootMargin)
                if (!isNaN(n) && n >= 0) return `${n}px 0px`
            }
        } catch (e) {}
        return '100px 0px'
    }

    function isDirThumb(img) {
        if (!img || img.tagName !== 'IMG') return false
        if (!img.matches(THUMB_SELECTOR)) return false
        if (!img.closest(DIR_SELECTOR)) return false
        const src = img.getAttribute('src') || img.dataset.scrollOriginalSrc || ''
        if (!src || src.startsWith('data:')) return false
        return true
    }

    let scrollIO = null

    function buildScrollIO() {
        if (scrollIO) scrollIO.disconnect()

        scrollIO = new IntersectionObserver((entries) => {
            for (const e of entries) {
                const img = e.target
                if (!isDirThumb(img)) continue
                if (e.isIntersecting) resumeScroll(img)
                else suspendScroll(img)
            }
        }, { root: null, rootMargin: getRootMargin(), threshold: 0 })
    }

    function suspendScroll(img) {
        const src = img.getAttribute('src')
        if (!src || src.startsWith('data:')) return
        if (!img.dataset.scrollOriginalSrc) img.dataset.scrollOriginalSrc = src
        img.dataset.scrollSuspended = '1'
        img.classList.add('scroll-suspended')
        img.removeAttribute('src')
    }

    function resumeScroll(img) {
        if (!img.dataset.scrollSuspended) return
        delete img.dataset.scrollSuspended
        img.classList.remove('scroll-suspended')
        const original = img.dataset.scrollOriginalSrc
        if (original && !img.classList.contains('thumbnail-suspended')) {
            // 重置淡入标记，让淡入插件对恢复的图重新淡入
            delete img.dataset.fadeProcessed
            img.style.opacity = ''
            img.setAttribute('src', original)
        }
    }

    function observeAllDirThumbs() {
        if (!scrollIO) return
        document.querySelectorAll(`${DIR_SELECTOR} ${THUMB_SELECTOR}`).forEach(img => {
            if (isDirThumb(img)) scrollIO.observe(img)
        })
    }

    const scrollMO = new MutationObserver((muts) => {
        for (const m of muts) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue
                if (node.matches?.(THUMB_SELECTOR) && node.closest(DIR_SELECTOR)) {
                    if (isDirThumb(node) && scrollIO) scrollIO.observe(node)
                }
                if (node.querySelectorAll && scrollIO) {
                    node.querySelectorAll(THUMB_SELECTOR).forEach(img => {
                        if (img.closest(DIR_SELECTOR) && isDirThumb(img)) {
                            scrollIO.observe(img)
                        }
                    })
                }
            }
        }
    })
    scrollMO.observe(document.body, { childList: true, subtree: true })

    buildScrollIO()
    setTimeout(observeAllDirThumbs, 500)

    HFS.watchState('uri', () => {
        buildScrollIO()
        setTimeout(observeAllDirThumbs, 200)
    }, true)
}