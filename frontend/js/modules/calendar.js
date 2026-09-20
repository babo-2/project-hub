/**
 * calendar.js — lightweight month-grid calendar.
 *
 * data shape: { events: [ { id, title, date: "yyyy-mm-dd", color } ] }
 *
 * Month/year navigation is view-only state, not persisted - it always
 * opens on today's month.
 */

const CALENDAR_COLORS = ["default", "red", "green", "blue", "purple", "orange"];
const WEEKDAY_LABELS   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

class CalendarModule {
    type  = "calendar";
    label = "Calendar";
    icon  = "📅";
    defaultData = { events: [] };

    static _id() {
        return crypto.randomUUID?.() ?? `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    render(container, moduleData, { onSave }) {
        const data = { events: (moduleData.data?.events ?? []).map(e => ({ ...e })) };

        const today = new Date();
        let viewYear  = today.getFullYear();
        let viewMonth = today.getMonth(); // 0-indexed
        let editingId = null;       // event id being edited, or "new"
        let newEventDate = null;    // date pre-filled when adding via a day cell

        container.innerHTML = `
            <div class="module-calendar">
                <div class="calendar-toolbar">
                    <button class="btn-icon btn-cal-prev" title="Previous month">‹</button>
                    <span class="calendar-month-label"></span>
                    <button class="btn-icon btn-cal-next" title="Next month">›</button>
                    <button class="btn btn-ghost btn-cal-today">Today</button>
                </div>
                <div class="calendar-weekdays">${WEEKDAY_LABELS.map(d => `<span>${d}</span>`).join("")}</div>
                <div class="calendar-grid"></div>
                <div class="calendar-editor"></div>
                <span class="save-status calendar-save-status"></span>
            </div>
        `;

        const monthLabel = container.querySelector(".calendar-month-label");
        const gridEl      = container.querySelector(".calendar-grid");
        const editorEl     = container.querySelector(".calendar-editor");
        const statusEl     = container.querySelector(".calendar-save-status");

        const save = async () => {
            await onSave(data);
            statusEl.textContent = "Saved ✓";
            setTimeout(() => (statusEl.textContent = ""), 1800);
        };

        const isoDate = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

        const renderEditor = () => {
            if (editingId === null) { editorEl.innerHTML = ""; return; }

            const isNew = editingId === "new";
            const event = isNew ? null : data.events.find(e => e.id === editingId);
            if (!isNew && !event) { editorEl.innerHTML = ""; return; }

            const title = isNew ? "" : event.title;
            const date  = isNew ? newEventDate : event.date;
            const color = isNew ? "default" : (event.color ?? "default");

            editorEl.innerHTML = `
                <div class="calendar-editor-form">
                    <input class="input cal-edit-title" placeholder="Event title…" value="${Utils.escape(title)}" />
                    <input class="input cal-edit-date" type="date" value="${date}" />
                    <div class="notes-colors">
                        ${CALENDAR_COLORS.map(c => `<button type="button" class="note-color-swatch cal-color-${c} ${c === color ? "active" : ""}" data-color="${c}"></button>`).join("")}
                    </div>
                    <button class="btn btn-primary btn-cal-save">${isNew ? "Add" : "Save"}</button>
                    ${!isNew ? `<button class="btn btn-ghost btn-cal-delete">Delete</button>` : ""}
                    <button class="btn btn-ghost btn-cal-cancel">Cancel</button>
                </div>
            `;

            let selectedColor = color;
            editorEl.querySelectorAll(".note-color-swatch").forEach(swatch => {
                swatch.addEventListener("click", () => {
                    selectedColor = swatch.dataset.color;
                    editorEl.querySelectorAll(".note-color-swatch").forEach(s => s.classList.toggle("active", s === swatch));
                });
            });

            editorEl.querySelector(".btn-cal-save").addEventListener("click", async () => {
                const titleVal = editorEl.querySelector(".cal-edit-title").value.trim();
                const dateVal  = editorEl.querySelector(".cal-edit-date").value;
                if (!titleVal || !dateVal) return;
                if (isNew) {
                    data.events.push({ id: CalendarModule._id(), title: titleVal, date: dateVal, color: selectedColor });
                } else {
                    event.title = titleVal; event.date = dateVal; event.color = selectedColor;
                }
                editingId = null;
                renderAll();
                await save();
            });

            const deleteBtn = editorEl.querySelector(".btn-cal-delete");
            if (deleteBtn) {
                deleteBtn.addEventListener("click", async () => {
                    data.events = data.events.filter(e => e.id !== event.id);
                    editingId = null;
                    renderAll();
                    await save();
                });
            }

            editorEl.querySelector(".btn-cal-cancel").addEventListener("click", () => {
                editingId = null;
                renderAll();
            });
        };

        const renderGrid = () => {
            monthLabel.textContent = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
            gridEl.innerHTML = "";

            const firstOfMonth = new Date(viewYear, viewMonth, 1);
            const startOffset  = firstOfMonth.getDay(); // 0 = Sunday
            const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
            const totalCells   = Math.ceil((startOffset + daysInMonth) / 7) * 7;

            const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

            for (let i = 0; i < totalCells; i++) {
                const dayNum = i - startOffset + 1;
                const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
                const cell = document.createElement("div");
                cell.className = "calendar-cell" + (inMonth ? "" : " outside");

                if (inMonth) {
                    const cellDate = isoDate(viewYear, viewMonth, dayNum);
                    const isToday = cellDate === todayIso;
                    const dayEvents = data.events.filter(e => e.date === cellDate);

                    cell.dataset.date = cellDate;
                    cell.innerHTML = `
                        <div class="calendar-cell-top">
                            <span class="calendar-cell-day ${isToday ? "is-today" : ""}">${dayNum}</span>
                            <button class="btn-icon calendar-add-day" title="Add event">+</button>
                        </div>
                        <div class="calendar-cell-events">
                            ${dayEvents.map(e => `<button class="calendar-event-chip cal-color-${e.color ?? "default"}" data-id="${e.id}">${Utils.escape(e.title)}</button>`).join("")}
                        </div>
                    `;

                    cell.querySelector(".calendar-add-day").addEventListener("click", () => {
                        editingId = "new";
                        newEventDate = cellDate;
                        renderEditor();
                    });
                    cell.querySelectorAll(".calendar-event-chip").forEach(chip => {
                        chip.addEventListener("click", () => {
                            editingId = chip.dataset.id;
                            renderEditor();
                        });
                    });
                }

                gridEl.appendChild(cell);
            }
        };

        const renderAll = () => { renderGrid(); renderEditor(); };

        container.querySelector(".btn-cal-prev").addEventListener("click", () => {
            viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
            renderGrid();
        });
        container.querySelector(".btn-cal-next").addEventListener("click", () => {
            viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
            renderGrid();
        });
        container.querySelector(".btn-cal-today").addEventListener("click", () => {
            viewYear = today.getFullYear(); viewMonth = today.getMonth();
            renderGrid();
        });

        // Lets Utils.jumpToModulePath (used by Notes module links with a
        // "date:" target) navigate this calendar to an arbitrary month
        // before it looks for the day cell to highlight.
        container.addEventListener("project-hub:jump-to-date", e => {
            const [y, m] = e.detail.date.split("-").map(Number);
            viewYear = y; viewMonth = m - 1;
            renderGrid();
        });

        renderAll();
    }

}

registry.register(new CalendarModule());
