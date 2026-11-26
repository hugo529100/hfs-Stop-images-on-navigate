exports.version = 2.0
exports.apiRequired = 8.0
exports.description = "Massively speeds up browsing of image-heavy folders by suspending off-screen thumbnails (saving bandwidth, smoother scrolling), holding thumbnails until the folder listing/statistics finish (so the list request never queues behind a wall of thumbnails), and cancelling remaining image loads when navigating folders"
exports.repo = "hugo529100/hfs-Stop-images-on-navigate"
exports.frontend_js = "main.js"
exports.frontend_css = "style.css"

exports.changelog = [
    {
        version: 2.0,
        message: "Thumbnails now wait for the first get_file_list / #folder-stats of each folder: while the listing " +
            "is still loading, tiles show HFS's own file-type icon (the same span.icon.font-icon.fa-* that " +
            "entry.getDefaultIcon() renders) and no thumbnail request is sent, so the list and statistics " +
            "requests are not queued behind a wall of thumbnails. The moment the statistics finish, visible " +
            "thumbnails are released and the gate stays open for the rest of the visit (one-time: scrolling, " +
            "paging and later stats changes never re-block). Only entering another folder re-arms it. " +
            "Can be turned off with the new option."
    }
]

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
    gateUntilListReady: {
        label: "Wait for the file list before loading thumbnails",
        type: "boolean",
        defaultValue: true,
        frontend: true,
        description: "While the first get_file_list / #folder-stats of a folder is still running, no thumbnail is " +
            "requested: tiles show HFS's native file-type icon (from entry.getDefaultIcon()) instead. As soon as " +
            "the listing finishes, thumbnails load for the visible area and the gate stays open for the rest of " +
            "the visit (scrolling, paging and later stats changes never re-block). Only entering another folder " +
            "closes it again. Turn off to restore the old immediate-loading behaviour."
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
