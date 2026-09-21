/**
 * board.js — freeform sticky-note board. Cards you drag anywhere on a
 * pannable, zoomable canvas, like notes on a corkboard. No columns, no
 * connections - for that, see the Roadmap (dated/status work) or Tree
 * (dependencies) modules instead.
 *
 * data shape: { notes: [ { id, title, text, color, x, y } ] }
 *
 * A sticky is dragged by its whole header (not a separate handle) - drag
 * just avoids the color/delete buttons. The header has `user-select: none`
 * and a `dragstart` no-op guard, because without those, a mousedown+drag
 * gesture over its icon glyphs can trigger the browser's native
 * text-drag behaviour. That fires real HTML5 "dragstart"/"dragover"
 * events that bubble all the way up to the project page's own module
 * drag-reorder listeners, whose `e.target` then may be a Text node
 * instead of an Element (this is what caused the
 * "e.target.closest is not a function" crash when a sticky lived inside
 * a folder).
 */

const STICKY_COLORS = ["yellow", "blue", "green", "pink", "purple"];

class BoardModule {
    type  = "board";
    label = "Stickies";
    icon  = "🗒️";
    defaultData = { notes: [] };

    static NOTE_W  = 180;
    static NOTE_H  = 140;
    static MIN_NOTE_W = 120;
    static MIN_NOTE_H = 90;
    static GRID    = 10;
    static MIN_ZOOM = 0.3;
    static MAX_ZOOM = 2.5;
    static TOP_Z = 0;

    static _id() {
        return crypto.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    render(container, moduleData, { onSave }) {
        const data = { notes: (moduleData.data?.notes ?? []).map(n => ({ ...n })) };

        let pan  = { x: 0, y: 0 };
        let zoom = 1;
        let isPanning = false;
        let panStart  = { mx: 0, my: 0, px: 0, py: 0 };

        container.innerHTML = `
            <div class="board-root">
                <div class="board-toolbar">
                    <button class="btn btn-primary btn-add-sticky">+ Add sticky</button>
                    <button class="btn btn-ghost btn-tidy-board">⊞ Tidy up</button>
                    <span class="board-zoom-controls">
                        <button class="btn-icon btn-zoom-out" title="Zoom out">−</button>
                        <button class="btn-icon btn-zoom-reset" title="Reset view">100%</button>
                        <button class="btn-icon btn-zoom-in" title="Zoom in">+</button>
                    </span>
                    <span class="save-status board-save-status"></span>
                </div>
                <div class="board-canvas-wrap">
                    <div class="board-notes-layer"></div>
                </div>
            </div>
        `;

        const canvasWrap  = container.querySelector(".board-canvas-wrap");
        const notesLayer  = container.querySelector(".board-notes-layer");
        const statusEl    = container.querySelector(".board-save-status");
        const zoomResetBtn = container.querySelector(".btn-zoom-reset");

        const snap = v => Math.round(v / BoardModule.GRID) * BoardModule.GRID;

        const save = async () => {
            await onSave(data);
            statusEl.textContent = "Saved ✓";
            setTimeout(() => (statusEl.textContent = ""), 1800);
        };

        const applyTransform = () => {
            notesLayer.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
            zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
        };

        const setZoom = (newZoom, cursorX, cursorY) => {
            newZoom = Math.min(BoardModule.MAX_ZOOM, Math.max(BoardModule.MIN_ZOOM, newZoom));
            // Keep the canvas point currently under the cursor fixed in place
            const canvasX = (cursorX - pan.x) / zoom;
            const canvasY = (cursorY - pan.y) / zoom;
            pan.x = cursorX - canvasX * newZoom;
            pan.y = cursorY - canvasY * newZoom;
            zoom = newZoom;
            applyTransform();
        };

        // ── Pan the canvas (drag empty background) ────────────────────────────
        canvasWrap.addEventListener("pointerdown", e => {
            if (e.target !== canvasWrap && e.target !== notesLayer) return;
            isPanning = true;
            panStart = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
            canvasWrap.setPointerCapture(e.pointerId);
            canvasWrap.style.cursor = "grabbing";
        });
        canvasWrap.addEventListener("pointermove", e => {
            if (!isPanning) return;
            pan.x = panStart.px + (e.clientX - panStart.mx);
            pan.y = panStart.py + (e.clientY - panStart.my);
            applyTransform();
        });
        canvasWrap.addEventListener("pointerup", e => {
            if (!isPanning) return;
            isPanning = false;
            canvasWrap.releasePointerCapture(e.pointerId);
            canvasWrap.style.cursor = "";
        });

        // ── Zoom (mouse wheel, centered on the cursor) ─────────────────────────
        canvasWrap.addEventListener("wheel", e => {
            e.preventDefault();
            const rect = canvasWrap.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            const factor  = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            let scrollSpeed = 0.1

            const sticky = document.querySelector(".sticky-note:hover")
            if (sticky){
                const text_area = sticky.querySelector(".sticky-text");
                if (text_area && (text_area.scrollHeight > text_area.clientHeight)){//can scroll sticky
                    if (!ctrlPressed){
                        text_area.scrollTop += e.deltaY*scrollSpeed;
                        return;
                    }
                }
            }
            setZoom(zoom * factor, cursorX, cursorY);
        }, { passive: false });

        container.querySelector(".btn-zoom-in").addEventListener("click", () => {
            const rect = canvasWrap.getBoundingClientRect();
            setZoom(zoom * 1.2, rect.width / 2, rect.height / 2);
        });
        container.querySelector(".btn-zoom-out").addEventListener("click", () => {
            const rect = canvasWrap.getBoundingClientRect();
            setZoom(zoom / 1.2, rect.width / 2, rect.height / 2);
        });
        zoomResetBtn.addEventListener("click", () => {
            pan = { x: 0, y: 0 };
            zoom = 1;
            applyTransform();
        });

        // ── Render stickies ─────────────────────────────────────────────────
        const renderNotes = () => {
            const existingIds = new Set([...notesLayer.querySelectorAll(".sticky-note")].map(el => el.dataset.id));
            const currentIds  = new Set(data.notes.map(n => n.id));
            existingIds.forEach(id => { if (!currentIds.has(id)) notesLayer.querySelector(`[data-id="${id}"]`)?.remove(); });

            data.notes.forEach(n => {
                let el = notesLayer.querySelector(`[data-id="${n.id}"]`);
                if (!el) {
                    el = this._buildStickyEl(n, data, save, renderNotes, snap, () => zoom);
                    notesLayer.appendChild(el);
                }
                el.style.left = `${n.x}px`;
                el.style.top  = `${n.y}px`;
            });
        };

        // ── Toolbar actions ──────────────────────────────────────────────────
        container.querySelector(".btn-add-sticky").addEventListener("click", async () => {
            const rect = canvasWrap.getBoundingClientRect();
            const note = {
                id: BoardModule._id(),
                title: "",
                text: "",
                color: STICKY_COLORS[data.notes.length % STICKY_COLORS.length],
                x: snap((rect.width / 2 - pan.x) / zoom - BoardModule.NOTE_W / 2 + (Math.random() * 60 - 30)),
                y: snap((rect.height / 2 - pan.y) / zoom - BoardModule.NOTE_H / 2 + (Math.random() * 60 - 30)),
            };
            data.notes.push(note);
            renderNotes();
            notesLayer.querySelector(`[data-id="${note.id}"] .sticky-title`)?.focus();
            await save();
        });

        container.querySelector(".btn-tidy-board").addEventListener("click", async () => {
            const cols = Math.max(1, Math.floor(canvasWrap.clientWidth / (BoardModule.NOTE_W + 24)));
            data.notes.forEach((n, i) => {
                n.x = snap((i % cols) * (BoardModule.NOTE_W + 24) + 24);
                n.y = snap(Math.floor(i / cols) * (BoardModule.NOTE_H + 24) + 24);
            });
            pan = { x: 0, y: 0 };
            zoom = 1;
            applyTransform();
            renderNotes();
            await save();
        });

        // Lets Utils.jumpToModulePath (used by Notes/Template module links
        // with a "sticky:" target) center the canvas/camera on a sticky
        // without moving the sticky itself.
        container.addEventListener("project-hub:jump-to-sticky", e => {
            const n = data.notes.find(x => x.id === e.detail.stickyId);
            if (!n) return;
            const rect = canvasWrap.getBoundingClientRect();
            const cx = n.x + (n.width ?? BoardModule.NOTE_W) / 2;
            const cy = n.y + (n.height ?? BoardModule.NOTE_H) / 2;
            pan.x = rect.width / 2 - zoom * cx;
            pan.y = rect.height / 2 - zoom * cy;
            applyTransform();
        });

        applyTransform();
        renderNotes();
    }

    _buildStickyEl(n, data, save, rerender, snap, getZoom) {
        const el = document.createElement("div");
        el.className = `sticky-note note-color-${n.color}`;
        el.dataset.id = n.id;
        el.style.width = `${n.width ?? BoardModule.NOTE_W}px`;
        el.style.height = `${n.height ?? BoardModule.NOTE_H}px`;
        el.innerHTML = `
            <div class="sticky-note-header">
            <button type="button" class="sticky-color-btn" title="Change color"></button>
                <div class="sticky-title-group">
                    <span class="sticky-title">${Utils.escape(n.title ?? "")}</span>
                    <button class="btn-icon sticky-rename-btn" title="Rename">✎</button>
                </div>
                <div style="flex:1"></div>
                <button class="btn-icon sticky-delete" title="Remove">✕</button>
            </div>
            <textarea class="sticky-text" placeholder="Write something…">${Utils.escape(n.text)}</textarea>
            <div class="sticky-resize-handle" title="Drag to resize"></div>
        `;

        //<input class="sticky-title" placeholder="Title…" value="${Utils.escape(n.title ?? "")}" />

        const header = el.querySelector(".sticky-note-header");
        const colorBtn = el.querySelector(".sticky-color-btn");
        const title   = el.querySelector(".sticky-title");
        const renameBtn = el.querySelector(".sticky-rename-btn");

        renameBtn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._startRename(title, n, save);
        })

        // Native text/element drag would otherwise fire a real "dragstart"
        // that bubbles up to the project page's drag-reorder listeners.
        header.setAttribute("draggable", "false");
        header.style.userSelect = "none";
        header.addEventListener("dragstart", e => e.preventDefault());

        const textarea = el.querySelector(".sticky-text");
        let saveTimer = null;
        textarea.addEventListener("input", () => {
            n.text = textarea.value;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(save, 900);
        });

        //TODO: color picker
        colorBtn.addEventListener("click", async () => {
            const idx = STICKY_COLORS.indexOf(n.color);
            n.color = STICKY_COLORS[(idx + 1) % STICKY_COLORS.length];
            el.className = `sticky-note note-color-${n.color}`;
            await save();
        });

        el.querySelector(".sticky-delete").addEventListener("click", async () => {
            if (n.text && !confirm("Remove this sticky?")) return;
            data.notes = data.notes.filter(x => x.id !== n.id);
            rerender();
            await save();
        });

        // ── Drag to reposition (whole header, excluding its buttons) ───────
        let dragStart = null;

        header.addEventListener("pointerdown", e => {
            if (Utils.closest(e.target, "button, input")) return; // let color/delete buttons and the title field work normally
            e.stopPropagation();
            dragStart = { mx: e.clientX, my: e.clientY, nx: n.x, ny: n.y };
            header.setPointerCapture(e.pointerId);
        });
        header.addEventListener("pointermove", e => {
            if (!dragStart) return;
            const z = getZoom();
            n.x = snap(dragStart.nx + (e.clientX - dragStart.mx) / z);
            n.y = snap(dragStart.ny + (e.clientY - dragStart.my) / z);
            el.style.left = `${n.x}px`;
            el.style.top  = `${n.y}px`;
        });
        header.addEventListener("pointerup", async e => {
            if (!dragStart) return;
            header.releasePointerCapture(e.pointerId);
            dragStart = null;
            await save();
        });

        // ── Resize (bottom-right corner, whole corner region is draggable) ─────
        const resizeHandle = el.querySelector(".sticky-resize-handle");
        let resizeStart = null;

        resizeHandle.addEventListener("pointerdown", e => {
            e.stopPropagation();
            resizeStart = { mx: e.clientX, my: e.clientY, w: n.width ?? BoardModule.NOTE_W, h: n.height ?? BoardModule.NOTE_H };
            resizeHandle.setPointerCapture(e.pointerId);
        });
        resizeHandle.addEventListener("pointermove", e => {
            if (!resizeStart) return;
            const z = getZoom();
            n.width  = snap(Math.max(BoardModule.MIN_NOTE_W, resizeStart.w + (e.clientX - resizeStart.mx) / z));
            n.height = snap(Math.max(BoardModule.MIN_NOTE_H, resizeStart.h + (e.clientY - resizeStart.my) / z));
            el.style.width  = `${n.width}px`;
            el.style.height = `${n.height}px`;
        });
        resizeHandle.addEventListener("pointerup", async e => {
            if (!resizeStart) return;
            resizeHandle.releasePointerCapture(e.pointerId);
            resizeStart = null;
            await save();
        });
        el.addEventListener("mousedown", ()=>{
            if (el.style.zIndex !== BoardModule.TOP_Z) {
                el.style.zIndex = ++BoardModule.TOP_Z;
            }
            const index = data.notes.indexOf(n);
            if (index !== -1) {
                data.notes.splice(index, 1); 
                data.notes.push(n);      //top level data (don't save)
            }
        })
        return el;
    }

    /** Swaps a module's title span for an inline input, saving on blur/Enter. */
    _startRename(titleEl, m, save) {
        const original = m.title;

        const finish = async (commit) => {
            const newTitle = titleEl.querySelector("input").value.trim();
            if (commit && newTitle && newTitle !== original) {
                m.title = newTitle;
                titleEl.textContent = newTitle;
                await save();
            } else {
                titleEl.textContent = original;
            }
        };

        if (titleEl.querySelector("input")) {
            finish(true)
            return;
        };

        titleEl.innerHTML = `<input class="input sticky-rename-input" type="text" value="${Utils.escape(original)}" />`;
        const input = titleEl.querySelector("input");
        Utils.focusRenameInput(input);

        //input.addEventListener("blur", (e) => {e.preventDefault();e.stopPropagation();finish(true);});
        input.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); input.blur(); }
            if (e.key === "Escape") { e.preventDefault(); finish(false); }
        });
    }
}

registry.register(new BoardModule());
