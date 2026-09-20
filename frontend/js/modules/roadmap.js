/**
 * roadmap.js — milestone roadmap with filter, group-by, sort-by, manual
 * reordering, dependencies between milestones, and assignees.
 *
 * data shape: {
 *   title:       string,
 *   description: string,
 *   milestones:  [ { id, title, description, status, due, dependsOn: [id], assignee: username|null } ]
 * }
 * status: "planned" | "in_progress" | "done"
 *
 * "Default" sort preserves the milestones array's own order, which manual
 * drag-reordering rewrites directly — same mental model as module reorder
 * on the project page.
 */

class RoadmapModule {
    type  = "roadmap";
    label = "Roadmap";
    icon  = "🗺️";
    defaultData = { milestones: [] };

    static STATUSES = [
        { value: "planned",     label: "Planned",     color: "var(--text-muted)" },
        { value: "in_progress", label: "In progress", color: "var(--accent)"     },
        { value: "done",        label: "Done",        color: "var(--success)"    },
    ];

    static _id() {
        return crypto.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async render(container, moduleData, { onSave }) {
        const data = {
            ...this.defaultData,
            ...(moduleData.data ?? {}),
            milestones: (moduleData.data?.milestones ?? []),
        };

        container.innerHTML = `<p class="loading">Loading…</p>`;
        const assignableUsers = await api.getAssignableUsers(moduleData.project_id).catch(() => []);

        // ── View state (not persisted) ──────────────────────────────────────
        let filterTitle  = "";
        let filterStatus = "all";
        let groupBy      = "none";    // "none" | "status" | "time"
        let sortBy       = "default"; // "default" | "title" | "date" | "status"
        let groupDays    = 14;
        let editingId    = null;

        container.innerHTML = `
            <div class="module-roadmap">
                <div class="roadmap-toolbar">
                    <input  class="input roadmap-filter-title" placeholder="Filter by title…" />
                    <select class="input roadmap-filter-status">
                        <option value="all">All statuses</option>
                        ${RoadmapModule.STATUSES.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}
                    </select>
                    <select class="input roadmap-sortby">
                        <option value="default">Sort: Default</option>
                        <option value="title">Sort: Title</option>
                        <option value="date">Sort: Due date</option>
                        <option value="status">Sort: Status</option>
                    </select>
                    <div class="roadmap-groupby-wrap">
                        <select class="input roadmap-groupby">
                            <option value="none">No grouping</option>
                            <option value="status">Group by status</option>
                            <option value="time">Group by time</option>
                        </select>
                        <div class="roadmap-groupby-days" hidden>
                            <input class="input roadmap-days-input" type="number" min="1" max="365" value="14" />
                            <span class="roadmap-days-label">days / bucket</span>
                        </div>
                    </div>
                </div>

                <div class="roadmap-list-container"></div>

                <div class="roadmap-add-section">
                    <h4 class="roadmap-add-label">Add milestone</h4>
                    <div class="roadmap-add-row">
                        <input  class="input roadmap-new-title"  placeholder="Title…" />
                        <input  class="input roadmap-new-desc"   placeholder="Description (optional)…" />
                        <select class="input roadmap-new-status">
                            ${RoadmapModule.STATUSES.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}
                        </select>
                        <input  class="input roadmap-new-due" type="date" />
                        <button class="btn btn-primary btn-add-milestone">+ Add</button>
                    </div>
                </div>
                <span class="save-status-ms save-status"></span>
            </div>
        `;

        const q  = sel => container.querySelector(sel);
        const filterTitleI  = q(".roadmap-filter-title");
        const filterStatI   = q(".roadmap-filter-status");
        const sortByI       = q(".roadmap-sortby");
        const groupByI      = q(".roadmap-groupby");
        const groupDaysWrap = q(".roadmap-groupby-days");
        const groupDaysI    = q(".roadmap-days-input");
        const listContainer = q(".roadmap-list-container");
        const newTitleI     = q(".roadmap-new-title");
        const newDescI      = q(".roadmap-new-desc");
        const newStatusI    = q(".roadmap-new-status");
        const newDueI       = q(".roadmap-new-due");
        const addBtn        = q(".btn-add-milestone");
        const saveMsSt      = q(".save-status-ms");

        const showStatus = (el, msg) => {
            el.textContent = msg;
            setTimeout(() => (el.textContent = ""), 2200);
        };

        const saveMilestones = async () => {
            await onSave(data);
            showStatus(saveMsSt, "Saved ✓");
        };

        const applyFilter = (milestones) => milestones.filter(m => {
            const titleMatch  = filterTitle === "" || m.title.toLowerCase().includes(filterTitle.toLowerCase());
            const statusMatch = filterStatus === "all" || m.status === filterStatus;
            return titleMatch && statusMatch;
        });

        const applySort = (milestones) => {
            if (sortBy === "default") return milestones;
            const copy = [...milestones];
            if (sortBy === "title") {
                copy.sort((a, b) => a.title.localeCompare(b.title));
            } else if (sortBy === "date") {
                copy.sort((a, b) => {
                    if (!a.due && !b.due) return 0;
                    if (!a.due) return 1;
                    if (!b.due) return -1;
                    return new Date(a.due) - new Date(b.due);
                });
            } else if (sortBy === "status") {
                const order = RoadmapModule.STATUSES.map(s => s.value);
                copy.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
            }
            return copy;
        };

        const applyGrouping = (milestones) => {
            if (groupBy === "none") return [{ label: null, items: milestones }];

            if (groupBy === "status") {
                const map = new Map(RoadmapModule.STATUSES.map(s => [s.value, []]));
                milestones.forEach(m => map.get(m.status)?.push(m));
                return RoadmapModule.STATUSES
                    .map(s => ({ label: s.label, items: map.get(s.value) }))
                    .filter(g => g.items.length > 0);
            }

            if (groupBy === "time") {
                const today    = new Date(); today.setHours(0, 0, 0, 0);
                const bucketMs = groupDays * 86400000;
                const noDue    = [];
                const overdue  = [];
                const buckets  = new Map();

                milestones.forEach(m => {
                    if (!m.due) { noDue.push(m); return; }
                    const d = new Date(m.due); d.setHours(0, 0, 0, 0);
                    if (d < today) { overdue.push(m); return; }
                    const idx = Math.floor((d - today) / bucketMs);
                    if (!buckets.has(idx)) buckets.set(idx, []);
                    buckets.get(idx).push(m);
                });

                const result = [];
                if (overdue.length) result.push({ label: "⚠ Overdue", items: overdue });
                [...buckets.keys()].sort((a, b) => a - b).forEach(idx => {
                    const start = new Date(today.getTime() + idx * bucketMs);
                    const end   = new Date(today.getTime() + (idx + 1) * bucketMs - 86400000);
                    const fmt   = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                    result.push({ label: `${fmt(start)} – ${fmt(end)}`, items: buckets.get(idx) });
                });
                if (noDue.length) result.push({ label: "No due date", items: noDue });
                return result;
            }

            return [{ label: null, items: milestones }];
        };

        const renderList = () => {
            const visible = applySort(applyFilter(data.milestones));
            const groups  = applyGrouping(visible);
            listContainer.innerHTML = "";

            if (!visible.length) {
                listContainer.innerHTML = `<p class="roadmap-empty">No milestones match the current filter.</p>`;
                return;
            }

            const reorderable = sortBy === "default" && groupBy === "none" && filterTitle === "" && filterStatus === "all";

            groups.forEach(group => {
                if (group.label !== null) {
                    const h = document.createElement("div");
                    h.className = "roadmap-group-header";
                    h.textContent = group.label;
                    listContainer.appendChild(h);
                }
                group.items.forEach((m, i) => {
                    const isFirst = i === 0 && group === groups[0];
                    const isLast  = i === group.items.length - 1 && group === groups[groups.length - 1];
                    listContainer.appendChild(
                        editingId === m.id
                            ? this._buildEditRow(m, data, assignableUsers, saveMilestones, renderList, () => { editingId = null; })
                            : this._buildViewRow(m, data, reorderable, isFirst, isLast, saveMilestones, renderList, id => { editingId = id; })
                    );
                });
            });
        };

        filterTitleI.addEventListener("input",  () => { filterTitle  = filterTitleI.value; renderList(); });
        filterStatI .addEventListener("change", () => { filterStatus = filterStatI.value;  renderList(); });
        sortByI     .addEventListener("change", () => { sortBy       = sortByI.value;      renderList(); });
        groupByI    .addEventListener("change", () => {
            groupBy = groupByI.value;
            groupDaysWrap.hidden = groupBy !== "time";
            renderList();
        });
        groupDaysI  .addEventListener("input",  () => {
            groupDays = Math.max(1, parseInt(groupDaysI.value, 10) || 14);
            renderList();
        });

        addBtn.addEventListener("click", async () => {
            const title = newTitleI.value.trim();
            if (!title) { newTitleI.focus(); return; }
            data.milestones.push({
                id:          RoadmapModule._id(),
                title,
                description: newDescI.value.trim(),
                status:      newStatusI.value,
                due:         newDueI.value || null,
                dependsOn:   [],
                assignee:    null,
            });
            newTitleI.value = "";
            newDescI.value  = "";
            newDueI.value   = "";
            renderList();
            await saveMilestones();
        });

        newTitleI.addEventListener("keydown", e => { if (e.key === "Enter") addBtn.click(); });

        renderList();
    }

    // ── Row builders ──────────────────────────────────────────────────────────

    _buildViewRow(m, data, reorderable, isFirst, isLast, save, rerender, startEdit) {
        const el = document.createElement("div");
        el.className = `roadmap-item status-${m.status}`;
        el.dataset.id = m.id;

        const statusCfg = RoadmapModule.STATUSES.find(s => s.value === m.status);
        const dueFmt    = m.due
            ? new Date(m.due + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
            : "";
        const isOverdue = m.due && new Date(m.due) < new Date() && m.status !== "done";

        const deps = (m.dependsOn ?? [])
            .map(id => data.milestones.find(x => x.id === id))
            .filter(Boolean);

        el.innerHTML = `
            ${reorderable ? Utils.moveButtonsHtml(isFirst, isLast, "roadmap-move-buttons") : ""}
            <span class="roadmap-dot"></span>
            <div class="roadmap-item-body">
                <div class="roadmap-item-top">
                    <span class="roadmap-item-title">${Utils.escape(m.title)}</span>
                    <span class="roadmap-status-badge" style="--badge-color:${statusCfg?.color}">${statusCfg?.label ?? m.status}</span>
                    ${dueFmt ? `<span class="roadmap-due ${isOverdue ? "overdue" : ""}">${dueFmt}</span>` : ""}
                    ${m.assignee ? `<span class="roadmap-assignee" title="Assigned to ${Utils.escape(m.assignee)}">👤 ${Utils.escape(m.assignee)}</span>` : ""}
                </div>
                ${m.description ? `<p class="roadmap-item-desc">${Utils.escape(m.description)}</p>` : ""}
                ${deps.length ? `<p class="roadmap-deps">⛓ needs: ${deps.map(d => `${d.status === "done" ? "✓" : "○"} ${Utils.escape(d.title)}`).join(", ")}</p>` : ""}
            </div>
            <div class="roadmap-item-actions">
                <button class="btn-icon btn-edit"   title="Edit">✎</button>
                <button class="btn-icon btn-remove" title="Remove">✕</button>
            </div>
        `;

        el.querySelector(".btn-edit").addEventListener("click", () => { startEdit(m.id); rerender(); });

        el.querySelector(".btn-remove").addEventListener("click", async () => {
            data.milestones = data.milestones.filter(x => x.id !== m.id);
            // Drop references to the removed milestone from anything that depended on it
            data.milestones.forEach(x => { x.dependsOn = (x.dependsOn ?? []).filter(id => id !== m.id); });
            rerender();
            await save();
        });

        el.querySelector(".move-up")?.addEventListener("click", async () => {
            data.milestones = Utils.moveItem(data.milestones, m.id, "up");
            rerender();
            Utils.flashMove(document.querySelector(`.roadmap-item[data-id="${m.id}"]`));
            await save();
        });
        el.querySelector(".move-down")?.addEventListener("click", async () => {
            data.milestones = Utils.moveItem(data.milestones, m.id, "down");
            rerender();
            Utils.flashMove(document.querySelector(`.roadmap-item[data-id="${m.id}"]`));
            await save();
        });

        return el;
    }

    _buildEditRow(m, data, assignableUsers, save, rerender, stopEdit) {
        const el = document.createElement("div");
        el.className = "roadmap-item roadmap-edit-row";

        const otherMilestones = data.milestones.filter(x => x.id !== m.id);
        const currentDeps = new Set(m.dependsOn ?? []);

        el.innerHTML = `
            <div class="roadmap-edit-fields">
                <input  class="input edit-title"  value="${Utils.escape(m.title)}"       placeholder="Title…" />
                <textarea class="input edit-desc" placeholder="Description…">${Utils.escape(m.description ?? "")}</textarea>
                <div class="roadmap-edit-row-2">
                    <select class="input edit-status">
                        ${RoadmapModule.STATUSES.map(s => `<option value="${s.value}" ${s.value === m.status ? "selected" : ""}>${s.label}</option>`).join("")}
                    </select>
                    <input class="input edit-due" type="date" value="${m.due ?? ""}" />
                    <select class="input edit-assignee">
                        <option value="">Unassigned</option>
                        ${assignableUsers.map(u => `<option value="${Utils.escape(u)}" ${u === m.assignee ? "selected" : ""}>${Utils.escape(u)}</option>`).join("")}
                    </select>
                </div>
                ${otherMilestones.length ? `
                    <div class="roadmap-deps-editor">
                        <span class="roadmap-deps-label">Depends on:</span>
                        ${otherMilestones.map(o => `
                            <label class="checkbox-label">
                                <input type="checkbox" class="edit-depends" value="${o.id}" ${currentDeps.has(o.id) ? "checked" : ""} />
                                ${Utils.escape(o.title)}
                            </label>`).join("")}
                    </div>` : ""}
                <div class="roadmap-edit-row-2">
                    <button class="btn btn-primary btn-edit-save">Save</button>
                    <button class="btn btn-ghost  btn-edit-cancel">Cancel</button>
                </div>
            </div>
        `;

        el.querySelector(".btn-edit-save").addEventListener("click", async () => {
            stopEdit();
            const idx = data.milestones.findIndex(x => x.id === m.id);
            if (idx !== -1) {
                const dependsOn = [...el.querySelectorAll(".edit-depends:checked")].map(cb => cb.value);
                data.milestones[idx] = {
                    ...m,
                    title:       el.querySelector(".edit-title").value.trim() || m.title,
                    description: el.querySelector(".edit-desc").value.trim(),
                    status:      el.querySelector(".edit-status").value,
                    due:         el.querySelector(".edit-due").value || null,
                    assignee:    el.querySelector(".edit-assignee").value || null,
                    dependsOn,
                };
            }
            rerender();
            await save();
        });

        el.querySelector(".btn-edit-cancel").addEventListener("click", () => { stopEdit(); rerender(); });

        return el;
    }

    // ── Plugin interface ──────────────────────────────────────────────────────

}

registry.register(new RoadmapModule());
