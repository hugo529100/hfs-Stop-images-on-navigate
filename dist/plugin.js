exports.version = 1.6
exports.apiRequired = 8.0
exports.description = "Massively speeds up browsing of image-heavy folders by suspending off-screen thumbnails (saving bandwidth, smoother scrolling) and cancelling remaining image loads when navigating folders"
exports.repo = "Hug3O/Stop-images-on-navigate"
exports.frontend_js = "main.js"
exports.frontend_css = "style.css"

exports.config = {
    whitelist: {
        label: "Whitelist paths (one per line)",
        type: "string",
        multiline: true,
        frontend: true,
        defaultValue:
`
/images/
/~/notes/`,
        description: "Images containing these keywords will not be blocked. Enter one keyword per line."
    },
    scrollRootMargin: {
        label: "Viewport buffer (px)",
        type: "number",
        frontend: true,
        defaultValue: 100,
        min: 0,
        max: 2000,
        description: "Buffer distance (px) outside viewport before suspending thumbnails. Larger = less flicker but more preloading. Do NOT set 0 (causes flicker)."
    }
}