/**
 * utils.js — small helpers shared across pages and modules.
 *
 * Escaping note: this is used both in plain text positions (innerHTML text
 * nodes) and inside HTML attributes (e.g. src="${Utils.escape(url)}"), so
 * it escapes quotes too - a partial escape that only handles < and >
 * lets a value containing a `"` break out of an attribute and inject
 * arbitrary markup.
 */
class Utils {
    static escape(str) {
        return (str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    static formatDate(iso) {
        if (!iso) return "";
        return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }

    static formatDateTime(iso) {
        if (!iso) return "";
        return new Date(iso).toLocaleString(undefined, {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
        });
    }

    /** Wires the topbar logout button, if present on the page. */
    static bindLogout() {
        const btn = document.getElementById("logout-btn");
        if (!btn) return;
        btn.onclick = () => {
            fetch("/auth/logout", { method: "POST" }).then(() => {
                window.location.href = "/";
            });
        };
    }

    /** Triggers a browser download of `data` (already a string) as `filename`. */
    static downloadJson(filename, data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * `target.closest(selector)`, but never throws if `target` isn't an
     * Element (e.g. a Text node - which can legitimately be an event's
     * `target` when a browser's native drag-text behavior fires on an
     * icon glyph inside a deeply nested module). Anything doing manual
     * drag/drop event handling should use this instead of calling
     * `.closest()` directly on `e.target`.
     *
     * Checks for the method itself rather than `instanceof Element`,
     * since `instanceof` can give false negatives across realms (e.g. an
     * Element that came from a different iframe/window has a different
     * Element constructor).
     */
    static closest(target, selector) {
        return typeof target?.closest === "function" ? target.closest(selector) : null;
    }

    /** Brief bottom-of-screen message, e.g. for permission-denied errors. */
    static showToast(message, type = "error") {
        let host = document.getElementById("toast-host");
        if (!host) {
            host = document.createElement("div");
            host.id = "toast-host";
            document.body.appendChild(host);
        }
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        host.appendChild(toast);
        setTimeout(() => toast.classList.add("toast-visible"), 10);
        setTimeout(() => {
            toast.classList.remove("toast-visible");
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // -----------------------------------------------------------------------
    // Module clipboard - deliberately localStorage, not the OS clipboard, so
    // copy/paste works the same way across browsers without a permission
    // prompt. Scoped to this origin, works across projects and folders.
    // -----------------------------------------------------------------------
    static CLIPBOARD_KEY = "project-hub:module-clipboard";

    static copyModuleToClipboard(module) {
        localStorage.setItem(Utils.CLIPBOARD_KEY, JSON.stringify({
            module_type: module.module_type,
            title: module.title,
            data: module.data,
            copiedAt: Date.now(),
        }));
        Utils.showToast(`Copied "${module.title}"`, "info");
    }

    static hasClipboardModule() {
        return !!localStorage.getItem(Utils.CLIPBOARD_KEY);
    }

    static readClipboardModule() {
        try {
            return JSON.parse(localStorage.getItem(Utils.CLIPBOARD_KEY) || "null");
        } catch {
            return null;
        }
    }

    /**
     * Swaps `id` with its previous/next sibling within `items` (an array of
     * objects with an `id` field) and returns the new array. Shared by every
     * "up/down arrow" reorder control (modules, folder children, roadmap
     * milestones, template instances).
     */
    static moveItem(items, id, direction) {
        const idx = items.findIndex(i => i.id === id);
        const swapWith = direction === "up" ? idx - 1 : idx + 1;
        if (idx === -1 || swapWith < 0 || swapWith >= items.length) return items;
        const copy = [...items];
        [copy[idx], copy[swapWith]] = [copy[swapWith], copy[idx]];
        return copy;
    }

    /** Renders a pair of up/down arrow buttons for a "change position" control. */
    static moveButtonsHtml(isFirst, isLast, extraClass = "") {
        return `
            <span class="move-buttons ${extraClass}">
                <button type="button" class="btn-icon move-up" title="Move up" ${isFirst ? "disabled" : ""}>▲</button>
                <button type="button" class="btn-icon move-down" title="Move down" ${isLast ? "disabled" : ""}>▼</button>
            </span>`;
    }

    /** Brief highlight flash on an element that just changed position. */
    static flashMove(el) {
        if (!el) return;
        el.classList.remove("move-flash");
        void el.offsetWidth; // force reflow so the animation restarts if triggered again quickly
        el.classList.add("move-flash");
        setTimeout(() => el.classList.remove("move-flash"), 500);
    }

    /**
     * Scrolls to and expands a module identified by `path` - an array of
     * ids, e.g. [42] for a top-level module, or [7, "c-abc"] for a module
     * nested inside folder 7. `extra` optionally points at something more
     * specific inside the target module once it's open (set by the shared
     * module-link picker in notes.js - see its SPECIFY_TYPES):
     *   - a bare Template instance id - highlights that instance's row/card.
     *   - `"line:<n>"` - selects line `n` of a Notes module's text.
     *   - `"date:<yyyy-mm-dd>"` - navigates a Calendar module to that month
     *     and highlights the day cell.
     *   - `"sticky:<id>"` - centers a Stickies board's canvas/camera on
     *     that sticky (panning the canvas, never moving the sticky itself).
     *   - `"link:<id>"` - highlights that row in a Links module.
     *   - `"milestone:<id>"` - highlights that item in a Roadmap module.
     * Async because the target module's own render may be asynchronous
     * (e.g. Template fetches data before it can show a row).
     */
    static async jumpToModulePath(path, extra = null) {
        if (!path?.length) return false;
        let root = document.getElementById("modules-container");
        let target = null;

        for (let i = 0; i < path.length; i++) {
            const isTop = i === 0;
            const selector = isTop ? `:scope > .module-card[data-id="${path[i]}"]` : `:scope > .folder-child-card[data-id="${path[i]}"]`;
            target = root.querySelector(selector);
            if (!target) return false;

            const header = target.querySelector(isTop ? ":scope > .module-card-header" : ":scope > .folder-child-header");
            const body   = target.querySelector(isTop ? ":scope > .module-card-body" : ":scope > .folder-child-body");
            // Expand/collapse is toggled by clicking the header itself (not a
            // dedicated arrow button), so simulate a click directly on the
            // header element - its own listener ignores clicks on buttons/
            // titles, so clicking the header node itself always toggles it.
            if (body?.hidden) header?.click();

            root = body;
            if (!root) return false;
        }

        const flash = el => {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("jump-highlight");
            setTimeout(() => el.classList.remove("jump-highlight"), 1600);
        };

        if (typeof extra === "string" && extra.startsWith("line:")) {
            const lineNum = parseInt(extra.slice(5), 10);
            if (!Number.isNaN(lineNum) && await Utils._waitFor(() => root.querySelector(".notes-editor"))) {
                // Notes' own contenteditable knows how to find/select a line;
                // it listens for this on the same element jumpToModulePath
                // resolves `root` to (the module's body).
                root.dispatchEvent(new CustomEvent("project-hub:jump-to-line", { detail: { line: lineNum } }));
                return true;
            }
        } else if (typeof extra === "string" && extra.startsWith("sticky:")) {
            const stickyId = extra.slice(7);
            root.dispatchEvent(new CustomEvent("project-hub:jump-to-sticky", { detail: { stickyId } }));
            const el = await Utils._waitFor(() => root.querySelector(`.sticky-note[data-id="${stickyId}"]`));
            if (el) { flash(el); return true; }
        } else if (typeof extra === "string" && extra.startsWith("date:")) {
            const dateStr = extra.slice(5);
            // Calendar always opens on today's month; ask it to navigate to
            // the target month before looking for the day cell.
            root.dispatchEvent(new CustomEvent("project-hub:jump-to-date", { detail: { date: dateStr } }));
            const cell = await Utils._waitFor(() => root.querySelector(`.calendar-cell[data-date="${dateStr}"]`));
            if (cell) { flash(cell); return true; }
        } else if (typeof extra === "string" && extra.startsWith("link:")) {
            const linkId = extra.slice(5);
            const el = await Utils._waitFor(() => root.querySelector(`.links-row[data-id="${linkId}"]`));
            if (el) { flash(el); return true; }
        } else if (typeof extra === "string" && extra.startsWith("milestone:")) {
            const msId = extra.slice(10);
            const el = await Utils._waitFor(() => root.querySelector(`.roadmap-item[data-id="${msId}"]`));
            if (el) { flash(el); return true; }
        } else if (extra != null) {
            const instanceEl = await Utils._waitFor(() =>
                root.querySelector(`.template-instance-row[data-id="${extra}"], .template-visual-card[data-id="${extra}"]`)
            );
            if (instanceEl) { flash(instanceEl); return true; }
            // Fall through to highlighting the module itself if the specific
            // instance couldn't be found (e.g. it's hidden by a filter).
        }

        flash(target);
        return true;
    }

    /**
     * Recursively flattens a project's module tree (top-level modules, plus
     * any nested inside folders, however deep) into a flat list of
     * `{ path, title, module_type, data }` entries. Shared by any feature
     * that needs to let the user pick a link target from every module in
     * the project - e.g. Template's "linked_record"/"linked_module" field
     * types and Notes' inline module links.
     */
    static flattenModules(modules, path = []) {
        const result = [];
        for (const m of modules) {
            const currentPath = [...path, m.id];
            result.push({ path: currentPath, title: m.title, module_type: m.module_type, data: m.data });
            if (m.module_type === "folder") {
                result.push(...Utils.flattenModules(m.data?.children ?? [], currentPath));
            }
        }
        return result;
    }

    /** Fetches a project's top-level modules fresh and flattens them (see `flattenModules`). */
    static async fetchProjectModules(projectId) {
        const topLevel = await api.getModules(projectId).catch(() => []);
        return Utils.flattenModules(topLevel);
    }

    /**
     * Focuses a freshly-swapped-in rename `<input>` without selecting its
     * whole value, so the person can start typing/arrow-keying from where
     * they clicked instead of overwriting the whole title by accident.
     * Caret is placed at the end of the text.
     */
    static focusRenameInput(input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
    }

    /** Polls `fn` until it returns a truthy value or the timeout elapses. */
    static _waitFor(fn, timeoutMs = 1000, intervalMs = 50) {
        return new Promise(resolve => {
            const start = Date.now();
            const tick = () => {
                const result = fn();
                if (result) return resolve(result);
                if (Date.now() - start >= timeoutMs) return resolve(null);
                setTimeout(tick, intervalMs);
            };
            tick();
        });
    }
}