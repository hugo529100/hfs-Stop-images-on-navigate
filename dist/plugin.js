exports.version = 1.8
exports.apiRequired = 8.0
exports.description = "Massively speeds up browsing of image-heavy folders by suspending off-screen thumbnails (saving bandwidth, smoother scrolling) and cancelling remaining image loads when navigating folders"
exports.repo = "hugo529100/hfs-Stop-images-on-navigate"
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
    strictMode: {
        label: "Strict mode (only visible thumbnails stay loaded)",
        type: "boolean",
        defaultValue: true,
        frontend: true,
        description: "On: a thumbnail stops downloading as soon as it leaves the viewport (recommended). " +
            "Off: use the viewport buffer below, which keeps a preload band outside the viewport."
    },
    scrollRootMargin: {
        label: "Viewport buffer (px, only when strict mode is off)",
        type: "number",
        frontend: true,
        defaultValue: 100,
        min: 0,
        max: 2000,
        description: "Buffer distance (px) outside viewport before suspending thumbnails. Larger = less flicker " +
            "but more preloading. Ignored while strict mode is on."
    },
    suspendDelay: {
        label: "Suspend delay (ms)",
        type: "number",
        frontend: true,
        defaultValue: 120,
        min: 0,
        max: 3000,
        description: "How long a thumbnail may stay fully outside the viewport before its transfer is cancelled. " +
            "Only applies near the viewport edge (thumbnails farther than ~200 px are cut immediately); " +
            "this avoids request churn when an image sits exactly on the boundary. 0 = cancel immediately."
    }
}
