/**
 * embed.js — embeds any URL you configure, passing it context both as a
 * query param and via postMessage, so a companion app you host elsewhere
 * (a calendar, a dashboard, anything) can render itself scoped to this
 * project.
 *
 * data shape: {
 *   urlTemplate: string,     // may contain {project_id} {project_name} {module_id} {module_title}
 *   payload: object,         // your own JSON, merged with the context above
 *   height: number,
 * }
 *
 * The resolved context (project/module id, name/title, and your payload)
 * is sent two ways: appended as ?payload=<json> on the iframe URL, and via
 * postMessage({ type: "project-hub:init", payload }) once the iframe
 * loads. If the embedded page posts a message back, it's shown/stored so
 * a connected app has a lightweight two-way channel.
 *
 * Security note: this iframes whatever URL you configure and uses "*" as
 * the postMessage target origin, since the target isn't known in advance.
 * Only point this at URLs/apps you trust - same trust model as any other
 * user-supplied URL in this app (e.g. Template's image/url fields).
 */

class EmbedModule {
    type  = "embed";
    label = "Embed";
    icon  = "🔌";
    defaultData = { urlTemplate: "", payload: {}, height: 480 };

    async render(container, moduleData, { onSave }) {
        const data = { ...this.defaultData, ...(moduleData.data ?? {}) };

        let project = null;
        try { project = await api.getProject(moduleData.project_id); } catch { /* fine without it */ }

        let showConfig = !data.urlTemplate;
        let lastMessage = null;

        container.innerHTML = `
            <div class="module-embed">
                <div class="embed-toolbar">
                    <button class="btn btn-ghost btn-toggle-config">${showConfig ? "Hide configuration" : "Edit configuration"}</button>
                    <span class="save-status embed-save-status"></span>
                </div>
                <div class="embed-config"></div>
                <div class="embed-frame-wrap"></div>
                <div class="embed-last-message"></div>
            </div>
        `;

        const toggleBtn  = container.querySelector(".btn-toggle-config");
        const configEl   = container.querySelector(".embed-config");
        const frameWrap  = container.querySelector(".embed-frame-wrap");
        const statusEl   = container.querySelector(".embed-save-status");
        const messageEl  = container.querySelector(".embed-last-message");

        const save = async () => {
            await onSave(data);
            statusEl.textContent = "Saved ✓";
            setTimeout(() => (statusEl.textContent = ""), 1800);
        };

        const buildContext = () => ({
            project_id:    moduleData.project_id,
            project_name:  project?.name ?? "",
            module_id:     moduleData.id,
            module_title:  moduleData.title,
            ...data.payload,
        });

        const resolveUrl = () => {
            if (!data.urlTemplate) return "";
            const context = buildContext();
            let url = data.urlTemplate
                .replace(/\{project_id\}/g,   encodeURIComponent(context.project_id ?? ""))
                .replace(/\{project_name\}/g, encodeURIComponent(context.project_name ?? ""))
                .replace(/\{module_id\}/g,    encodeURIComponent(context.module_id ?? ""))
                .replace(/\{module_title\}/g, encodeURIComponent(context.module_title ?? ""));
            const sep = url.includes("?") ? "&" : "?";
            return `${url}${sep}payload=${encodeURIComponent(JSON.stringify(context))}`;
        };

        const renderFrame = () => {
            frameWrap.innerHTML = "";
            const url = resolveUrl();
            if (!url) {
                frameWrap.innerHTML = `<p class="embed-hint">Configure a URL above to embed it here.</p>`;
                return;
            }

            const iframe = document.createElement("iframe");
            iframe.className = "embed-iframe";
            iframe.src = url;
            iframe.style.height = `${data.height}px`;
            iframe.addEventListener("load", () => {
                iframe.contentWindow?.postMessage({ type: "project-hub:init", payload: buildContext() }, "*");
            });
            frameWrap.appendChild(iframe);

            const messageHandler = event => {
                if (event.source !== iframe.contentWindow) return;
                lastMessage = event.data;
                messageEl.textContent = `Last message from embed: ${JSON.stringify(lastMessage)}`;
            };
            window.addEventListener("message", messageHandler);
        };

        const renderConfig = () => {
            configEl.hidden = !showConfig;
            if (!showConfig) { configEl.innerHTML = ""; return; }

            configEl.innerHTML = `
                <div class="embed-config-form">
                    <label class="tvc-edit-label">Embed URL</label>
                    <input class="input embed-url" placeholder="https://your-app.example.com/calendar?project={project_id}" value="${Utils.escape(data.urlTemplate)}" />
                    <small class="text-muted">Placeholders: {project_id} {project_name} {module_id} {module_title}</small>

                    <label class="tvc-edit-label">Custom payload (JSON)</label>
                    <textarea class="input embed-payload">${Utils.escape(JSON.stringify(data.payload, null, 2))}</textarea>

                    <label class="tvc-edit-label">Height (px)</label>
                    <input class="input embed-height" type="number" min="200" max="2000" value="${data.height}" />

                    <div class="module-actions">
                        <button class="btn btn-primary btn-save-embed">Save & preview</button>
                    </div>
                    <p class="embed-config-error"></p>
                </div>
            `;

            configEl.querySelector(".btn-save-embed").addEventListener("click", async () => {
                const errorEl = configEl.querySelector(".embed-config-error");
                errorEl.textContent = "";
                const urlVal = configEl.querySelector(".embed-url").value.trim();
                let payloadVal;
                try {
                    payloadVal = JSON.parse(configEl.querySelector(".embed-payload").value || "{}");
                } catch {
                    errorEl.textContent = "Payload isn't valid JSON.";
                    return;
                }
                data.urlTemplate = urlVal;
                data.payload     = payloadVal;
                data.height      = Math.max(200, parseInt(configEl.querySelector(".embed-height").value, 10) || 480);
                renderFrame();
                await save();
            });
        };

        toggleBtn.addEventListener("click", () => {
            showConfig = !showConfig;
            toggleBtn.textContent = showConfig ? "Hide configuration" : "Edit configuration";
            renderConfig();
        });

        renderConfig();
        renderFrame();
    }

}

registry.register(new EmbedModule());
