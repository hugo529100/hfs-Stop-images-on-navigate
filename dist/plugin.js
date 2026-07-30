exports.version = 1
exports.apiRequired = 8.0
exports.description = "Stop all image requests when navigating folders - Improves page switching responsiveness and reduces bandwidth usage by interrupting loading of non-essential images"
exports.repo = "Hug3O/Stop-images-on-navigate"

exports.frontend_js = "main.js"

// 添加配置选项
exports.config = {
    whitelist: {
        label: "白名单路径（每行一个）",
        type: "text",
        value: "/images/banner/",
        description: "包含这些关键字的图片将不会被拦截。每行一个关键字。默认只保留 /images/banner/ 目录的图片"
    }
}