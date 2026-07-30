'use strict';{
    let lastUri = HFS.state.uri
    
    // 默认白名单：只保留 /images/banner/ 路径的图片
    const defaultWhitelist = [
        '/images/banner/'
    ]
    
    // 获取白名单配置
    function getWhitelist() {
        try {
            const config = HFS.getPluginConfig()
            if (config && config.whitelist) {
                return config.whitelist.split('\n')
                    .map(item => item.trim())
                    .filter(item => item.length > 0)
            }
        } catch (e) {
            // 如果获取配置失败，使用默认白名单
        }
        return defaultWhitelist
    }
    
    // 检查图片是否在白名单中
    function isInWhitelist(src, whitelist) {
        if (!src) return false
        if (src.startsWith('data:')) return true // data: URI 总是保留
        
        for (const pattern of whitelist) {
            if (src.includes(pattern)) {
                return true
            }
        }
        return false
    }

    function stopAllImages() {
        const whitelist = getWhitelist()
        const imgs = document.querySelectorAll('img')
        
        imgs.forEach(img => {
            const src = img.src || ''
            
            // 检查是否在白名单中
            if (isInWhitelist(src, whitelist)) {
                return // 跳过该图片（保留）
            }
            
            // 不在白名单中的图片全部拦截
            // 避免触发 onload / onerror
            img.onload = null
            img.onerror = null

            // 清空 src 中断请求
            if (src && !src.startsWith('data:')) {
                img.src = ''
            }
        })
    }

    // 监听目录变化
    HFS.watchState('uri', (uri) => {
        if (uri !== lastUri) {
            lastUri = uri
            stopAllImages()
        }
    }, true)
}