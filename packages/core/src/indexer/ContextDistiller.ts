import type { IContextDistiller } from '../contracts/IIndexer.js';
import type { ProjectMap } from '../models/types.js';

const MAX_ITEMS = 20;

export class ContextDistiller implements IContextDistiller {
  distill(projectMap: ProjectMap): string {
    const sections: string[] = [];

    // Stack
    sections.push(this.formatStack(projectMap));

    // Structure summary
    sections.push(this.formatStructure(projectMap));

    // Key routes
    const routeSection = this.formatRoutes(projectMap);
    if (routeSection) sections.push(routeSection);

    // Key components
    const compSection = this.formatComponents(projectMap);
    if (compSection) sections.push(compSection);

    // Key endpoints
    const endpointSection = this.formatEndpoints(projectMap);
    if (endpointSection) sections.push(endpointSection);

    // Data models
    const modelSection = this.formatModels(projectMap);
    if (modelSection) sections.push(modelSection);

    return sections.join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Section formatters
  // ---------------------------------------------------------------------------

  private formatStack(pm: ProjectMap): string {
    const parts = [pm.stack.framework];
    if (pm.stack.typescript) parts.push('TypeScript');
    else if (pm.stack.language !== 'unknown') parts.push(pm.stack.language);
    if (pm.stack.packageManager) parts.push(`(${pm.stack.packageManager})`);

    let line = `Stack: ${parts.join(' + ')}`;
    if (pm.devCommand) line += `\nDev: ${pm.devCommand} (port ${pm.port})`;

    return line;
  }

  private formatStructure(pm: ProjectMap): string {
    const fileCount = pm.dependencies.size;
    const componentCount = pm.components.length;
    const endpointCount = pm.endpoints.length;
    const routeCount = pm.routes.filter((r) => r.type === 'page').length;
    const modelCount = pm.models.length;

    const parts: string[] = [
      `${fileCount} files`,
      `${routeCount} pages`,
      `${componentCount} components`,
      `${endpointCount} endpoints`,
    ];
    if (modelCount > 0) parts.push(`${modelCount} models`);

    return `Structure: ${parts.join(', ')}`;
  }

  private formatRoutes(pm: ProjectMap): string | null {
    const pages = pm.routes.filter((r) => r.type === 'page');
    if (pages.length === 0) return null;

    const display = pages.slice(0, MAX_ITEMS).map((r) => r.path);
    const suffix = pages.length > MAX_ITEMS ? ` (+${pages.length - MAX_ITEMS} more)` : '';

    return `Key routes: ${display.join(', ')}${suffix}`;
  }

  private formatComponents(pm: ProjectMap): string | null {
    const comps = pm.components.filter((c) => c.type === 'component');
    if (comps.length === 0) return null;

    const display = comps.slice(0, MAX_ITEMS).map((c) => c.name);
    const suffix = comps.length > MAX_ITEMS ? ` (+${comps.length - MAX_ITEMS} more)` : '';

    return `Key components: ${display.join(', ')}${suffix}`;
  }

  private formatEndpoints(pm: ProjectMap): string | null {
    if (pm.endpoints.length === 0) return null;

    const display = pm.endpoints
      .slice(0, MAX_ITEMS)
      .map((e) => `${e.method} ${e.path}`);
    const suffix = pm.endpoints.length > MAX_ITEMS
      ? ` (+${pm.endpoints.length - MAX_ITEMS} more)`
      : '';

    return `Key endpoints: ${display.join(', ')}${suffix}`;
  }

  private formatModels(pm: ProjectMap): string | null {
    if (pm.models.length === 0) return null;

    const display = pm.models.slice(0, MAX_ITEMS).map((m) => {
      if (m.fields && m.fields.length > 0) {
        const fieldPreview = m.fields.slice(0, 5).join(', ');
        const more = m.fields.length > 5 ? ', ...' : '';
        return `${m.name}(${fieldPreview}${more})`;
      }
      return m.name;
    });

    const suffix = pm.models.length > MAX_ITEMS
      ? ` (+${pm.models.length - MAX_ITEMS} more)`
      : '';

    return `Data models: ${display.join(', ')}${suffix}`;
  }
}
