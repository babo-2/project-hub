/**
 * registry.js
 * The module plugin system.
 *
 * To add a new module type:
 *   1. Create a new file in js/modules/ (e.g. mindmap.js)
 *   2. Define a class implementing the ModulePlugin interface (below)
 *   3. Call ModuleRegistry.register(new YourModule()) — that's it.
 *
 * Nothing else in the codebase needs to change.
 */

/**
 * @interface ModulePlugin
 * Every module must implement these properties and methods.
 *
 * type        {string}  Unique snake_case identifier, matches DB module_type.
 * label       {string}  Human-readable name shown in the UI.
 * icon        {string}  Emoji or single character used as an icon.
 * defaultData {object}  Shape of an empty data blob for this module type.
 *
 * render(container, moduleData, { onSave })
 *   Mounts the module UI into `container`.
 *   Call onSave(newData) to persist changes.
 */

class ModuleRegistry {
    constructor() {
        /** @type {Map<string, ModulePlugin>} */
        this._plugins = new Map();
    }

    /** Register a plugin. Throws if the type is already taken. */
    register(plugin) {
        if (this._plugins.has(plugin.type)) {
            throw new Error(`Module type "${plugin.type}" is already registered.`);
        }
        this._plugins.set(plugin.type, plugin);
        console.info(`[registry] registered module: ${plugin.type}`);
    }

    /** Retrieve a plugin by type. Returns null if not found. */
    get(type) {
        return this._plugins.get(type) ?? null;
    }

    /** All registered plugins, sorted alphabetically by label. */
    getAll() {
        return [...this._plugins.values()].sort((a, b) => a.label.localeCompare(b.label));
    }

    /** Render a module into a DOM container. */
    render(container, moduleData, callbacks) {
        const plugin = this.get(moduleData.module_type);
        if (!plugin) {
            container.innerHTML = `<p class="module-unknown">Unknown module type: ${moduleData.module_type}</p>`;
            return;
        }
        plugin.render(container, moduleData, callbacks);
    }
}

// Global singleton — available to all scripts loaded after this file
const registry = new ModuleRegistry();
