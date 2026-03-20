import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import chalk from 'chalk';
import { ManifestStore, type ManifestService, type ManifestDatabase, type ManifestEntity, type ServiceType, type EntityType } from '@nova-architect/core';
import { NovaDir } from '@nova-architect/core';

const SERVICE_TYPES: ServiceType[] = ['frontend', 'backend', 'worker', 'gateway'];
const ENTITY_TYPES: EntityType[] = ['module', 'external-service', 'library', 'shared-package'];

export async function entityCommand(subcommand?: string, name?: string): Promise<void> {
  const cwd = process.cwd();
  const store = new ManifestStore();
  const novaDir = new NovaDir();

  // Ensure .nova exists
  if (!novaDir.exists(cwd)) {
    await novaDir.init(cwd);
  }

  switch (subcommand) {
    case 'add':
      await entityAdd(cwd, store);
      break;
    case 'list':
      await entityList(cwd, store);
      break;
    case 'remove':
      if (!name) {
        console.log(chalk.red('Usage: nova entity remove <name>'));
        return;
      }
      await entityRemove(cwd, store, name);
      break;
    default:
      console.log('Usage: nova entity <add|list|remove> [name]');
      break;
  }
}

async function entityAdd(cwd: string, store: ManifestStore): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const kindRaw = await rl.question('Type? (service / database / entity) ');
    const kind = kindRaw.trim().toLowerCase();

    if (kind === 'service') {
      const name = (await rl.question('Name? ')).trim();
      if (!name) { console.log(chalk.red('Name is required.')); return; }

      const typeRaw = (await rl.question(`Role? (${SERVICE_TYPES.join(' / ')}) `)).trim().toLowerCase();
      if (!SERVICE_TYPES.includes(typeRaw as ServiceType)) {
        console.log(chalk.red(`Invalid role. Choose from: ${SERVICE_TYPES.join(', ')}`));
        return;
      }

      const path = (await rl.question('Path? ')).trim();
      if (!path) { console.log(chalk.red('Path is required.')); return; }

      const framework = (await rl.question('Framework? (optional) ')).trim() || undefined;
      const language = (await rl.question('Language? (optional) ')).trim() || undefined;

      const service: ManifestService = { name, type: typeRaw as ServiceType, path, framework, language };
      await store.addService(cwd, service);
      console.log(chalk.green(`Added service "${name}" to .nova/manifest.toml`));

    } else if (kind === 'database') {
      const name = (await rl.question('Name? ')).trim();
      if (!name) { console.log(chalk.red('Name is required.')); return; }

      const engine = (await rl.question('Engine? (postgresql / mysql / sqlite / mongodb / redis) ')).trim();
      if (!engine) { console.log(chalk.red('Engine is required.')); return; }

      const schemaPath = (await rl.question('Schema path? (optional) ')).trim() || undefined;
      const connectionEnv = (await rl.question('Connection env var? (optional) ')).trim() || undefined;

      await store.addDatabase(cwd, { name, engine, schema_path: schemaPath, connection_env: connectionEnv });
      console.log(chalk.green(`Added database "${name}" to .nova/manifest.toml`));

    } else if (kind === 'entity') {
      const name = (await rl.question('Name? ')).trim();
      if (!name) { console.log(chalk.red('Name is required.')); return; }

      const typeRaw = (await rl.question(`Type? (${ENTITY_TYPES.join(' / ')}) `)).trim().toLowerCase();
      if (!ENTITY_TYPES.includes(typeRaw as EntityType)) {
        console.log(chalk.red(`Invalid type. Choose from: ${ENTITY_TYPES.join(', ')}`));
        return;
      }

      const description = (await rl.question('Description? (optional) ')).trim() || undefined;
      const filesRaw = (await rl.question('Files? (comma-separated, optional) ')).trim();
      const files = filesRaw ? filesRaw.split(',').map(f => f.trim()).filter(Boolean) : undefined;

      const entity: ManifestEntity = { name, type: typeRaw as EntityType, description, files };
      await store.addEntity(cwd, entity);
      console.log(chalk.green(`Added entity "${name}" to .nova/manifest.toml`));

    } else {
      console.log(chalk.red('Unknown type. Choose: service, database, entity'));
    }
  } finally {
    rl.close();
  }
}

async function entityList(cwd: string, store: ManifestStore): Promise<void> {
  const manifest = await store.load(cwd);
  if (!manifest) {
    console.log(chalk.yellow('No manifest found. Run "nova entity add" to create one.'));
    return;
  }

  if (manifest.project.name) {
    console.log(chalk.bold(`\nProject: ${manifest.project.name}`));
    if (manifest.project.description) console.log(`  ${manifest.project.description}`);
  }

  if (manifest.services.length > 0) {
    console.log(chalk.bold('\nServices:'));
    for (const s of manifest.services) {
      const parts = [chalk.cyan(s.name), `[${s.type}]`, s.path];
      if (s.framework) parts.push(`(${s.framework})`);
      console.log(`  ${parts.join(' ')}`);
    }
  }

  if (manifest.databases.length > 0) {
    console.log(chalk.bold('\nDatabases:'));
    for (const d of manifest.databases) {
      const parts = [chalk.cyan(d.name), `[${d.engine}]`];
      if (d.connection_env) parts.push(`env: ${d.connection_env}`);
      console.log(`  ${parts.join(' ')}`);
    }
  }

  if (manifest.entities.length > 0) {
    console.log(chalk.bold('\nEntities:'));
    for (const e of manifest.entities) {
      const parts = [chalk.cyan(e.name), `[${e.type}]`];
      if (e.description) parts.push(e.description);
      console.log(`  ${parts.join(' ')}`);
    }
  }

  if (manifest.boundaries.writable?.length || manifest.boundaries.readonly?.length || manifest.boundaries.ignored?.length) {
    console.log(chalk.bold('\nBoundaries:'));
    if (manifest.boundaries.writable?.length) console.log(`  Writable: ${manifest.boundaries.writable.join(', ')}`);
    if (manifest.boundaries.readonly?.length) console.log(`  Readonly: ${manifest.boundaries.readonly.join(', ')}`);
    if (manifest.boundaries.ignored?.length) console.log(`  Ignored:  ${manifest.boundaries.ignored.join(', ')}`);
  }

  const total = manifest.services.length + manifest.databases.length + manifest.entities.length;
  if (total === 0) {
    console.log(chalk.yellow('\nManifest is empty. Run "nova entity add" to register entities.'));
  }

  console.log('');
}

async function entityRemove(cwd: string, store: ManifestStore, name: string): Promise<void> {
  const removed = await store.removeByName(cwd, name);
  if (removed) {
    console.log(chalk.green(`Removed "${name}" from .nova/manifest.toml`));
  } else {
    console.log(chalk.yellow(`"${name}" not found in manifest.`));
  }
}
