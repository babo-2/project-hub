/**
 * notes.js — rich-ish text notes module.
 *
 * data shape: { content: string (HTML) }
 *
 * The body is a `contenteditable` div rather than a `<textarea>` so it can
 * hold inline, non-text-editable link "chips" (`.notes-link`). Right-click
 * in empty space → "Add link"; right-click a chip → "Edit link" - both
 * open NotesLinkPicker, the same module-link picker Template's "Linked
 * module" field type uses (see template.js).
 *
 * A link always points at a module - optionally "specified" down to one
 * thing inside it (a Template instance, a Notes line, …; see
 * NotesLinkPicker.SPECIFY_TYPES) - and either shows that target's own
 * title/specification label, or a title the person typed themselves
 * ("override title"). The chip's `data-token` stores `{ path, extra,
 * title }`: `title` is null unless overridden, so a non-overridden chip's
 * displayed text can be refreshed against the target's current name/value
 * (see _refreshDynamicTitles) rather than going stale.
 *
 * Height is user-draggable via a custom handle, stored in localStorage
 * only (a per-device display preference, not project data).
 */

/** Turns a module-link payload into the opaque string stashed in a chip's
 *  `data-token` (and, identically, in a Template "linked module" field's
 *  stored value - see template.js). */
function encodeModuleLinkToken(payload) {
    return encodeURIComponent(JSON.stringify(payload));
}

/** Inverse of encodeModuleLinkToken; returns null for anything malformed. */
function decodeModuleLinkToken(token) {
    try { return JSON.parse(decodeURIComponent(token)); } catch { return null; }
}

/** Flattens a Notes module's stored HTML into plain text, using "\n" for
 *  <br>/block boundaries - the same line numbering a person seeing the
 *  rendered note would count. Used for both line-preview titles (the
 *  picker) and line-jump navigation (_jumpToLine below). */
function notesHtmlToPlainText(html) {
    const div = document.createElement("div");
    div.innerHTML = html ?? "";
    let text = "";
    const walk = node => {
        node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                text += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();
                if (tag === "br") text += "\n";
                else if (tag === "div" || tag === "p") { if (text && !text.endsWith("\n")) text += "\n"; walk(child); }
                else walk(child);
            }
        });
    };
    walk(div);
    return text;
}

/**
 * Resolves the title a module link should show when it isn't overridden:
 * the target module's own title, or - when `extra` specifies something
 * inside it - that thing's own display text. Shared by Notes chips and
 * Template's "linked module" field, both of which store `title: null` to
 * mean "keep this live" rather than baking in a snapshot.
 *
 * @param {object|undefined} target  a Utils.flattenModules() entry ({ path, title, module_type, data }), or undefined if the link is dangling
 * @param {string|null}      extra   see NotesLinkPicker.SPECIFY_TYPES / Utils.jumpToModulePath
 */
function resolveLinkTitle(target, extra) {
    if (!target) return "unavailable";
    if (extra == null) return target.title;

    switch (target.module_type) {
        case "template": {
            const fields  = target.data.fields ?? [];
            const primary = fields.find(f => f.id === target.data.primaryFieldId) ?? fields[0];
            const inst    = (target.data.instances ?? []).find(i => String(i.id) === String(extra));
            if (!inst) return target.title;
            return (primary && inst.values[primary.id]) || `Instance #${inst.id}`;
        }
        case "notes": {
            if (!extra.startsWith("line:")) return target.title;
            const lineNum = parseInt(extra.slice(5), 10);
            const line = (notesHtmlToPlainText(target.data.content ?? "").split("\n")[lineNum - 1] ?? "").trim();
            if (!line) return target.title;
            return line.length > 16 ? `${line.slice(0, 16)}…` : line;
        }
        case "calendar": {
            if (!extra.startsWith("date:")) return target.title;
            const dateStr = extra.slice(5);
            const event = (target.data.events ?? []).find(e => e.date === dateStr);
            return event ? event.title : dateStr;
        }
        case "board": {
            if (!extra.startsWith("sticky:")) return target.title;
            const sticky = (target.data.notes ?? []).find(n => String(n.id) === extra.slice(7));
            return (sticky && sticky.title) || target.title;
        }
        case "links": {
            if (!extra.startsWith("link:")) return target.title;
            const link = (target.data.links ?? []).find(l => String(l.id) === extra.slice(5));
            return link ? link.title : target.title;
        }
        case "roadmap": {
            if (!extra.startsWith("milestone:")) return target.title;
            const ms = (target.data.milestones ?? []).find(m => String(m.id) === extra.slice(10));
            return ms ? ms.title : target.title;
        }
        default:
            return target.title;
    }
}

class NotesModule {
    type        = "notes";
    label       = "Notes";
    icon        = "📝";
    defaultData = { content: "" };

    render(container, moduleData, { onSave }) {
        const raw = moduleData.data ?? {};
        const heightKey = `notes-height:${moduleData.id}`;
        const myPath = moduleData.path ?? [moduleData.id];

        container.innerHTML = `
            <div class="module-notes">
                <div class="notes-editor-wrap">
                    <div class="notes-editor" contenteditable="true" data-placeholder="Start writing… (right-click to add a link)"></div>
                    <div class="notes-resize-handle" title="Drag to resize"></div>
                </div>
                <div class="module-actions">
                    <button class="btn btn-primary btn-save">Save</button>
                    <span class="save-status"></span>
                    <span class="notes-word-count"></span>
                </div>
            </div>
        `;

        const editorEl  = container.querySelector(".notes-editor");
        const handle    = container.querySelector(".notes-resize-handle");
        const saveBtn   = container.querySelector(".btn-save");
        const statusEl  = container.querySelector(".save-status");
        const wordCount = container.querySelector(".notes-word-count");

        editorEl.innerHTML = this._sanitizeHtml(raw.content ?? "");
        this._refreshDynamicTitles(editorEl, moduleData.project_id);

        const restoredHeight = localStorage.getItem(heightKey);
        if (restoredHeight) editorEl.style.height = `${restoredHeight}px`;

        const updateWordCount = () => {
            const words = editorEl.textContent.trim().split(/\s+/).filter(Boolean).length;
            wordCount.textContent = `${words} word${words === 1 ? "" : "s"}`;
        };
        updateWordCount();

        let saveTimer = null;

        const save = async (statusText = "Saved") => {
            clearTimeout(saveTimer);
            statusEl.textContent = "Saving…";
            try {
                await onSave({ content: this._sanitizeHtml(editorEl.innerHTML) });
                statusEl.textContent = `${statusText} \u2713`;
            } catch {
                statusEl.textContent = "Couldn't save — will retry";
            }
            setTimeout(() => { if (statusEl.textContent.startsWith(statusText)) statusEl.textContent = ""; }, 2000);
        };

        const scheduleAutosave = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => save("Autosaved"), 1200);
        };

        editorEl.addEventListener("input", () => {
            updateWordCount();
            scheduleAutosave();
        });

        saveBtn.addEventListener("click", () => save());

        editorEl.addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                save();
            }
        });

        // -------------------------------------------------------------
        // Jump to a link's target on left-click
        // -------------------------------------------------------------
        editorEl.addEventListener("click", e => {
            const linkEl = e.target.closest(".notes-link");
            if (!linkEl) return;
            const payload = decodeModuleLinkToken(linkEl.dataset.token);
            if (payload) Utils.jumpToModulePath(payload.path, payload.extra ?? null);
        });

        // -------------------------------------------------------------
        // Right-click: "Add link" in empty space, "Edit link" on a chip
        // -------------------------------------------------------------
        editorEl.addEventListener("contextmenu", e => {
            e.preventDefault();
            const chipEl = e.target.closest(".notes-link");
            if (chipEl) {
                this._showContextMenu(e.clientX, e.clientY, [
                    { label: "✏️ Edit link", action: () => this._openEditLink(chipEl, moduleData, myPath, scheduleAutosave) },
                ]);
            } else {
                const insertRange = this._caretRangeFromPoint(e.clientX, e.clientY, editorEl);
                this._showContextMenu(e.clientX, e.clientY, [
                    { label: "➕ Add link", action: () => this._openAddLink(editorEl, insertRange, moduleData, myPath, scheduleAutosave) },
                ]);
            }
        });

        // -------------------------------------------------------------
        // Line-jump target for Utils.jumpToModulePath("line:<n>")
        // -------------------------------------------------------------
        container.addEventListener("project-hub:jump-to-line", e => this._jumpToLine(editorEl, e.detail.line));

        this._bindResizeHandle(editorEl, handle, heightKey);
    }

    // -------------------------------------------------------------------
    // Link insertion / editing
    // -------------------------------------------------------------------

    _buildLinkChip(token, label) {
        const span = document.createElement("span");
        span.className = "notes-link";
        span.contentEditable = "false";
        span.dataset.token = token;
        span.textContent = label;
        return span;
    }

    _openAddLink(editorEl, range, moduleData, myPath, scheduleAutosave) {
        notesLinkPicker.open({
            projectId: moduleData.project_id,
            excludePath: myPath,
            onSubmit: ({ path, extra, title, label }) => {
                const chip = this._buildLinkChip(encodeModuleLinkToken({ path, extra, title }), label);

                const sel = window.getSelection();
                range.deleteContents();
                range.insertNode(chip);

                // Place the caret right after the chip so typing continues naturally.
                const after = document.createRange();
                after.setStartAfter(chip);
                after.collapse(true);
                sel.removeAllRanges();
                sel.addRange(after);
                editorEl.focus();
                scheduleAutosave();
            },
        });
    }

    _openEditLink(chipEl, moduleData, myPath, scheduleAutosave) {
        const payload = decodeModuleLinkToken(chipEl.dataset.token);
        if (!payload) return;

        notesLinkPicker.open({
            projectId: moduleData.project_id,
            excludePath: myPath,
            initial: payload,
            onSubmit: ({ path, extra, title, label }) => {
                chipEl.replaceWith(this._buildLinkChip(encodeModuleLinkToken({ path, extra, title }), label));
                scheduleAutosave();
            },
        });
    }

    /** For chips saved with `title: null` (not overridden), re-resolves
     *  their displayed text against the target's CURRENT title/value, so
     *  a stale rename or edited primary field doesn't linger in old notes.
     *  Runs once per render (on load), not on every keystroke. */
    async _refreshDynamicTitles(editorEl, projectId) {
        const dynamic = [...editorEl.querySelectorAll(".notes-link")]
            .map(el => ({ el, payload: decodeModuleLinkToken(el.dataset.token) }))
            .filter(x => x.payload && x.payload.title == null);
        if (!dynamic.length) return;

        const allModules = await Utils.fetchProjectModules(projectId);
        dynamic.forEach(({ el, payload }) => {
            const target = allModules.find(m => m.path.join(">") === (payload.path ?? []).join(">"));
            el.textContent = resolveLinkTitle(target, payload.extra ?? null);
        });
    }

    /** Resolves a right-click's screen position to an insertion Range inside `editorEl`. */
    _caretRangeFromPoint(x, y, editorEl) {
        let range = null;
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(x, y);
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
            }
        }
        if (!range || !editorEl.contains(range.startContainer)) {
            range = document.createRange();
            range.selectNodeContents(editorEl);
            range.collapse(false); // fall back to the end of the content
        }
        return range;
    }

    /** Small floating right-click menu; dismisses on outside click/Escape. */
    _showContextMenu(x, y, items) {
        document.querySelector(".notes-context-menu")?.remove();

        const menu = document.createElement("div");
        menu.className = "notes-context-menu";
        menu.style.left = `${x}px`;
        menu.style.top  = `${y}px`;
        menu.innerHTML = items.map((it, i) => `<button type="button" class="notes-context-item" data-i="${i}">${it.label}</button>`).join("");
        document.body.appendChild(menu);

        menu.querySelectorAll(".notes-context-item").forEach(btn => {
            btn.addEventListener("click", () => {
                items[Number(btn.dataset.i)].action();
                menu.remove();
            });
        });

        const dismiss = e => { if (!menu.contains(e.target)) cleanup(); };
        const onKey   = e => { if (e.key === "Escape") cleanup(); };
        const cleanup = () => {
            menu.remove();
            document.removeEventListener("mousedown", dismiss, true);
            document.removeEventListener("keydown", onKey, true);
        };
        // Deferred so the mousedown half of this same right-click doesn't
        // immediately dismiss the menu it's in the middle of opening.
        setTimeout(() => {
            document.addEventListener("mousedown", dismiss, true);
            document.addEventListener("keydown", onKey, true);
        }, 0);
    }

    /** Finds and selects line `lineNum` (1-indexed) inside the live
     *  contenteditable, splitting on the same <br>/element boundaries
     *  notesHtmlToPlainText uses, then scrolls it into view. */
    _jumpToLine(editorEl, lineNum) {
        const lines = [];
        let current = null;

        const closeLine = (node, offset) => { if (current) { current.endNode = node; current.endOffset = offset; lines.push(current); current = null; } };
        const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (!current) current = { startNode: node, startOffset: 0, endNode: node, endOffset: 0 };
                current.endNode = node;
                current.endOffset = node.textContent.length;
            } else if (node.tagName === "BR") {
                if (!current) current = { startNode: node, startOffset: 0 };
                closeLine(node, 0);
            }
        }
        if (current) closeLine(current.endNode, current.endOffset);

        const target = lines[Math.max(0, Math.min(lineNum - 1, lines.length - 1))];
        if (!target) return;

        const range = document.createRange();
        range.setStart(target.startNode, target.startOffset);
        range.setEnd(target.endNode, target.endOffset);

        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        editorEl.focus();

        const rect = range.getBoundingClientRect();
        const editorRect = editorEl.getBoundingClientRect();
        editorEl.scrollTop += (rect.top - editorRect.top) - editorRect.height / 2;
        editorEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // -------------------------------------------------------------------
    // HTML sanitizing
    // -------------------------------------------------------------------

    /** Rebuilds `html` keeping only text, <br>, and well-formed link chips
     *  - so pasted content (or a tampered save) can't inject anything else.
     *  Run on every save, and on load. */
    _sanitizeHtml(html) {
        const template = document.createElement("template");
        template.innerHTML = html;
        const clean = document.createElement("div");

        const walk = (srcParent, destParent) => {
            srcParent.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    destParent.appendChild(document.createTextNode(node.textContent));
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName.toLowerCase();
                    if (tag === "br") {
                        destParent.appendChild(document.createElement("br"));
                    } else if (tag === "div" || tag === "p") {
                        // contenteditable wraps new lines in <div>/<p> - treat the boundary as a line break.
                        if (destParent.lastChild) destParent.appendChild(document.createElement("br"));
                        walk(node, destParent);
                    } else if (tag === "span" && node.classList.contains("notes-link") && node.dataset.token) {
                        destParent.appendChild(this._buildLinkChip(node.dataset.token, node.textContent));
                    } else {
                        walk(node, destParent); // unwrap anything else, keeping its text/children
                    }
                }
            });
        };
        walk(template.content, clean);
        return clean.innerHTML;
    }

    /**
     * Custom drag-resize: track pointermove on the handle, update the
     * editor's height in real time, and persist the final height to
     * localStorage (client-only — never sent to the server).
     */
    _bindResizeHandle(editorEl, handle, heightKey) {
        const MIN_HEIGHT = 120;
        const MAX_HEIGHT = 1200;

        let startY      = 0;
        let startHeight = 0;

        handle.addEventListener("pointerdown", e => {
            e.preventDefault();
            startY      = e.clientY;
            startHeight = editorEl.offsetHeight;

            handle.setPointerCapture(e.pointerId);
            handle.classList.add("dragging");
            document.body.style.cursor = "ns-resize";
        });

        handle.addEventListener("pointermove", e => {
            if (!handle.hasPointerCapture(e.pointerId)) return;
            const delta = e.clientY - startY;
            const newH  = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta));
            editorEl.style.height = `${newH}px`;
        });

        const stopDrag = e => {
            if (!handle.hasPointerCapture(e.pointerId)) return;
            handle.releasePointerCapture(e.pointerId);
            handle.classList.remove("dragging");
            document.body.style.cursor = "";
            localStorage.setItem(heightKey, parseInt(editorEl.style.height, 10));
        };

        handle.addEventListener("pointerup",     stopDrag);
        handle.addEventListener("pointercancel", stopDrag);
    }
}

/**
 * NotesLinkPicker — small global modal (built once, reused everywhere a
 * module link is created: every Notes module, and Template's "linked
 * module" field type - see template.js). Always links to a module;
 * "Specify" optionally narrows to one thing inside it; "Override title"
 * optionally replaces the computed title with custom text.
 */
class NotesLinkPicker {
    /** Module types that support narrowing the link to something inside
     *  them, and the human label shown next to the "Specify" checkbox for
     *  each. Every other module type just gets "the module" as a whole. */
    static SPECIFY_LABELS = {
        template: "instance",
        notes:    "line",
        calendar: "date",
        board:    "sticky",
        links:    "link",
        roadmap:  "milestone",
    };

    constructor() {
        this._built = false;
    }

    /**
     * @param {string}      projectId
     * @param {number[]}    excludePath  the linking module's own path (can't link to itself)
     * @param {object|null} initial      when editing: { path, extra, title }
     * @param {function}    onSubmit     ({ path, extra, title, label }) => void — `label` is always a definite string (the resolved-or-overridden title to show right now); `title` is what to persist (null unless overridden).
     */
    async open({ projectId, excludePath, initial = null, onSubmit }) {
        this._ensureDom();
        this._onSubmit = onSubmit;

        const excludeKey = excludePath.join(">");
        this.modules = (await Utils.fetchProjectModules(projectId)).filter(m => m.path.join(">") !== excludeKey);

        this.targetSel.innerHTML = this.modules.length
            ? this.modules.map((m, i) => {
                const icon = registry.get(m.module_type)?.icon ?? "📦";
                return `<option value="${i}">${"\u2014 ".repeat(m.path.length - 1)}${icon} ${Utils.escape(m.title)}</option>`;
            }).join("")
            : `<option value="">No other modules in this project yet</option>`;
        this.targetSel.disabled = !this.modules.length;

        this.headingEl.textContent = initial ? "Edit link" : "Add link";
        this.submitBtn.textContent = initial ? "Save" : "Insert";

        if (initial) {
            const idx = this.modules.findIndex(m => m.path.join(">") === (initial.path ?? []).join(">"));
            this.targetSel.value = idx >= 0 ? String(idx) : "0";
            this.specifyCheck.checked = initial.extra != null;
            this.overrideCheck.checked = initial.title != null;
            this.textInput.value = initial.title ?? "";
            this._applyModuleTypeVisibility(initial.extra ?? null);
        } else {
            this.targetSel.value = "0";
            this.specifyCheck.checked = false;
            this.overrideCheck.checked = false;
            this.textInput.value = "";
            this._applyModuleTypeVisibility();
        }
        this.textInput.disabled = !this.overrideCheck.checked;

        this.backdrop.hidden = false;
        this.backdrop.style.display = "flex";
        this.targetSel.focus();
    }

    close() {
        this.backdrop.style.display = "none";
        this.backdrop.hidden = true;
        this._onSubmit = null;
    }

    /** Rebuilds the "Specify" section for whichever module is currently
     *  targeted: hidden entirely for types with nothing to narrow down to,
     *  otherwise a checkbox plus the type-specific control. */
    _applyModuleTypeVisibility(presetExtra = null) {
        const m = this.modules[this.targetSel.value];
        const specifyLabel = m ? NotesLinkPicker.SPECIFY_LABELS[m.module_type] : null;

        this.specifyGroup.hidden = !specifyLabel;
        if (!specifyLabel) this.specifyCheck.checked = false;
        this.specifyNameEl.textContent = specifyLabel ? `(${specifyLabel})` : "";

        this._applySpecifyVisibility(presetExtra);
    }

    _applySpecifyVisibility(presetExtra = null) {
        this.specifyWrap.hidden = !this.specifyCheck.checked;
        if (this.specifyCheck.checked) this._renderSpecifyControl(presetExtra);
        else this.specifyWrap.innerHTML = "";
        this._updateTitlePreview();
    }

    /** The type-specific "what inside the module" control (see the class
     *  doc's SPECIFY_LABELS) - a select for anything with a fixed set of
     *  named items, a plain number/date input otherwise. */
    _renderSpecifyControl(presetExtra = null) {
        const m = this.modules[this.targetSel.value];
        if (!m) { this.specifyWrap.innerHTML = ""; return; }

        const selectOptions = (items, idOf, labelOf, prefix) => {
            const presetId = typeof presetExtra === "string" && presetExtra.startsWith(prefix) ? presetExtra.slice(prefix.length) : "";
            const opts = items.map(item => {
                const id = String(idOf(item));
                return `<option value="${Utils.escape(id)}" ${presetId === id ? "selected" : ""}>${Utils.escape(labelOf(item))}</option>`;
            }).join("");
            this.specifyWrap.innerHTML = `<select class="input nlp-specify-select"><option value="">Choose…</option>${opts}</select>`;
        };

        if (m.module_type === "template") {
            const fields  = m.data.fields ?? [];
            const primary = fields.find(f => f.id === m.data.primaryFieldId) ?? fields[0];
            selectOptions(m.data.instances ?? [], i => i.id, i => (primary && i.values[primary.id]) || `Instance #${i.id}`, "");

        } else if (m.module_type === "board") {
            selectOptions(m.data.notes ?? [], n => n.id, n => n.title || (n.text || "").trim().slice(0, 40) || `Sticky #${String(n.id).slice(-4)}`, "sticky:");

        } else if (m.module_type === "links") {
            selectOptions(m.data.links ?? [], l => l.id, l => l.title || l.url, "link:");

        } else if (m.module_type === "roadmap") {
            selectOptions(m.data.milestones ?? [], ms => ms.id, ms => ms.title, "milestone:");

        } else if (m.module_type === "notes") {
            const lineVal = typeof presetExtra === "string" && presetExtra.startsWith("line:") ? presetExtra.slice(5) : "";
            this.specifyWrap.innerHTML = `<input class="input nlp-specify-input" type="number" min="1" placeholder="Line number…" value="${Utils.escape(lineVal)}" />`;

        } else if (m.module_type === "calendar") {
            const dateVal = typeof presetExtra === "string" && presetExtra.startsWith("date:") ? presetExtra.slice(5) : "";
            this.specifyWrap.innerHTML = `<input class="input nlp-specify-input" type="date" value="${Utils.escape(dateVal)}" />`;

        } else {
            this.specifyWrap.innerHTML = "";
        }

        this.specifyWrap.querySelector("select, input")?.addEventListener("change", () => this._updateTitlePreview());
    }

    /** Computes `extra` from the current form state - null if "Specify" is
     *  off or nothing's chosen yet. */
    _currentExtra() {
        if (!this.specifyCheck.checked) return null;
        const m = this.modules[this.targetSel.value];
        if (!m) return null;

        const select = this.specifyWrap.querySelector(".nlp-specify-select");
        const input  = this.specifyWrap.querySelector(".nlp-specify-input");
        const prefixes = { board: "sticky:", links: "link:", roadmap: "milestone:" };

        if (select) return select.value ? `${prefixes[m.module_type] ?? ""}${select.value}` : null;
        if (input)  return input.value ? `${m.module_type === "notes" ? "line:" : "date:"}${input.value}` : null;
        return null;
    }

    /** While "Override title" is off, keeps the (disabled) title field
     *  showing a live preview of the title that will actually be used. */
    _updateTitlePreview() {
        if (this.overrideCheck.checked) return;
        const m = this.modules[this.targetSel.value];
        this.textInput.value = m ? resolveLinkTitle(m, this._currentExtra()) : "";
    }

    _ensureDom() {
        if (this._built) return;
        this._built = true;

        this.backdrop = document.createElement("div");
        this.backdrop.className = "modal-backdrop";
        this.backdrop.hidden = true;
        this.backdrop.style.display = "none";
        this.backdrop.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="nlp-heading">
                <div class="modal-header">
                    <h2 id="nlp-heading">Add link</h2>
                    <button type="button" class="btn-icon nlp-close" aria-label="Close">✕</button>
                </div>
                <form class="nlp-form">
                    <div class="form-group">
                        <label for="nlp-target">Module</label>
                        <select class="input nlp-target" id="nlp-target"></select>
                    </div>

                    <div class="form-group nlp-specify-group" hidden>
                        <label class="checkbox-label">
                            <input type="checkbox" class="nlp-specify-check" />
                            Specify <span class="nlp-specify-name"></span>
                        </label>
                        <span class="nlp-specify-wrap" hidden></span>
                    </div>

                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" class="nlp-override-check" />
                            Override title
                        </label>
                        <input class="input nlp-text" id="nlp-text" type="text" placeholder="Title…" disabled />
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-ghost nlp-cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary nlp-submit">Insert</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(this.backdrop);

        this.targetSel      = this.backdrop.querySelector(".nlp-target");
        this.specifyGroup    = this.backdrop.querySelector(".nlp-specify-group");
        this.specifyNameEl   = this.backdrop.querySelector(".nlp-specify-name");
        this.specifyCheck    = this.backdrop.querySelector(".nlp-specify-check");
        this.specifyWrap     = this.backdrop.querySelector(".nlp-specify-wrap");
        this.overrideCheck   = this.backdrop.querySelector(".nlp-override-check");
        this.textInput       = this.backdrop.querySelector(".nlp-text");
        this.headingEl       = this.backdrop.querySelector("#nlp-heading");
        this.submitBtn       = this.backdrop.querySelector(".nlp-submit");
        const form            = this.backdrop.querySelector(".nlp-form");

        this.targetSel.addEventListener("change", () => this._applyModuleTypeVisibility());
        this.specifyCheck.addEventListener("change", () => this._applySpecifyVisibility());
        this.overrideCheck.addEventListener("change", () => {
            this.textInput.disabled = !this.overrideCheck.checked;
            if (this.overrideCheck.checked) this.textInput.focus();
            else this._updateTitlePreview();
        });

        form.addEventListener("submit", e => {
            e.preventDefault();
            const m = this.modules[this.targetSel.value];
            if (!m) return;

            const extra = this._currentExtra();
            const title = this.overrideCheck.checked ? (this.textInput.value.trim() || null) : null;
            const label = title ?? resolveLinkTitle(m, extra);

            const onSubmit = this._onSubmit;
            this.close();
            onSubmit?.({ path: m.path, extra, title, label });
        });

        this.backdrop.querySelector(".nlp-close").addEventListener("click", () => this.close());
        this.backdrop.querySelector(".nlp-cancel").addEventListener("click", () => this.close());
        this.backdrop.addEventListener("click", e => { if (e.target === this.backdrop) this.close(); });
    }
}

const notesLinkPicker = new NotesLinkPicker();

registry.register(new NotesModule());
