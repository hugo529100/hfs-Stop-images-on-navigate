exports.version = 1
exports.apiRequired = 8.0
exports.description = "Stop all image requests when navigating folders - Improves page switching responsiveness and reduces bandwidth usage by interrupting loading of non-essential images"
exports.repo = "Hug3O/Stop-images-on-navigate"

exports.frontend_js = "main.js"

// Add configuration options
exports.config = {
    whitelist: {
        label: "Whitelist paths (one per line)",
        type: "text",
        value: "/images/banner/",
        description: "Images containing these keywords will not be blocked. Enter one keyword per line. By default, only images in the /images/banner/ directory are kept."
    }
}