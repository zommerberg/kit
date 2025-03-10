import fs from 'fs';
import path from 'path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { deep_merge } from '../../utils/object.js';
import { print_config_conflicts } from '../config/index.js';
import { posixify, resolve_entry } from '../utils.js';
import { create_build } from './utils.js';
import { SVELTE_KIT } from '../constants.js';
import { s } from '../../utils/misc.js';

/**
 * @param {{
 *   runtime: string,
 *   hooks: string,
 *   config: import('types/config').ValidatedConfig
 * }} opts
 * @returns
 */
const template = ({ config, hooks, runtime }) => `
import { respond } from '${runtime}';
import root from './generated/root.svelte';
import { set_paths, assets, base } from './runtime/paths.js';
import { set_prerendering } from './runtime/env.js';
import * as user_hooks from ${s(hooks)};

const template = ({ head, body }) => ${s(fs.readFileSync(config.kit.files.template, 'utf-8'))
	.replace('%svelte.head%', '" + head + "')
	.replace('%svelte.body%', '" + body + "')};

let read = null;

set_paths(${s(config.kit.paths)});

// this looks redundant, but the indirection allows us to access
// named imports without triggering Rollup's missing import detection
const get_hooks = hooks => ({
	getSession: hooks.getSession || (() => ({})),
	handle: hooks.handle || (({ request, resolve }) => resolve(request)),
	handleError: hooks.handleError || (({ error }) => console.error(error.stack)),
	externalFetch: hooks.externalFetch || fetch
});

let default_protocol = 'https';

// allow paths to be globally overridden
// in svelte-kit preview and in prerendering
export function override(settings) {
	default_protocol = settings.protocol || default_protocol;
	set_paths(settings.paths);
	set_prerendering(settings.prerendering);
	read = settings.read;
}

export class App {
	constructor(manifest) {
		const hooks = get_hooks(user_hooks);

		this.options = {
			amp: ${config.kit.amp},
			dev: false,
			floc: ${config.kit.floc},
			get_stack: error => String(error), // for security
			handle_error: (error, request) => {
				hooks.handleError({ error, request });
				error.stack = this.options.get_stack(error);
			},
			hooks,
			hydrate: ${s(config.kit.hydrate)},
			manifest,
			paths: { base, assets },
			prefix: assets + '/${config.kit.appDir}/',
			prerender: ${config.kit.prerender.enabled},
			read,
			root,
			service_worker: ${
				config.kit.files.serviceWorker && config.kit.serviceWorker.register
					? "'/service-worker.js'"
					: 'null'
			},
			router: ${s(config.kit.router)},
			ssr: ${s(config.kit.ssr)},
			target: ${s(config.kit.target)},
			template,
			trailing_slash: ${s(config.kit.trailingSlash)}
		};
	}

	render(request, {
		prerender
	} = {}) {
		const host = ${
			config.kit.host
				? s(config.kit.host)
				: `request.headers[${s(config.kit.headers.host || 'host')}]`
		};
		const protocol = ${
			config.kit.protocol
				? s(config.kit.protocol)
				: config.kit.headers.protocol
				? `request.headers[${s(config.kit.headers.protocol)}] || default_protocol`
				: 'default_protocol'
		};

		return respond({ ...request, origin: protocol + '://' + host }, this.options, { prerender });
	}
}
`;

/**
 * @param {{
 *   cwd: string;
 *   assets_base: string;
 *   config: import('types/config').ValidatedConfig
 *   manifest_data: import('types/internal').ManifestData
 *   build_dir: string;
 *   output_dir: string;
 * }} options
 * @param {string} runtime
 */
export async function build_server(
	{ cwd, assets_base, config, manifest_data, build_dir, output_dir },
	runtime
) {
	let hooks_file = resolve_entry(config.kit.files.hooks);
	if (!hooks_file || !fs.existsSync(hooks_file)) {
		hooks_file = path.resolve(cwd, `${SVELTE_KIT}/build/hooks.js`);
		fs.writeFileSync(hooks_file, '');
	}

	/** @type {Record<string, string>} */
	const input = {
		app: `${build_dir}/app.js`
	};

	// add entry points for every endpoint...
	manifest_data.routes.forEach((route) => {
		if (route.type === 'endpoint') {
			const resolved = path.resolve(cwd, route.file);
			const relative = path.relative(config.kit.files.routes, resolved);
			const name = posixify(path.join('entries/endpoints', relative.replace(/\.js$/, '')));
			input[name] = resolved;
		}
	});

	// ...and every component used by pages
	manifest_data.components.forEach((file) => {
		const resolved = path.resolve(cwd, file);
		const relative = path.relative(config.kit.files.routes, resolved);

		const name = relative.startsWith('..')
			? posixify(path.join('entries/pages', path.basename(file)))
			: posixify(path.join('entries/pages', relative));
		input[name] = resolved;
	});

	/** @type {(file: string) => string} */
	const app_relative = (file) => {
		const relative_file = path.relative(build_dir, path.resolve(cwd, file));
		return relative_file[0] === '.' ? relative_file : `./${relative_file}`;
	};

	// prettier-ignore
	fs.writeFileSync(
		input.app,
		template({
			config,
			hooks: app_relative(hooks_file),
			runtime
		})
	);

	/** @type {import('vite').UserConfig} */
	const vite_config = config.kit.vite();

	const default_config = {
		build: {
			target: 'es2020'
		}
	};

	// don't warn on overriding defaults
	const [modified_vite_config] = deep_merge(default_config, vite_config);

	/** @type {[any, string[]]} */
	const [merged_config, conflicts] = deep_merge(modified_vite_config, {
		configFile: false,
		root: cwd,
		base: assets_base,
		build: {
			ssr: true,
			outDir: `${output_dir}/server`,
			manifest: true,
			polyfillDynamicImport: false,
			rollupOptions: {
				input,
				output: {
					format: 'esm',
					entryFileNames: '[name].js',
					chunkFileNames: 'chunks/[name]-[hash].js',
					assetFileNames: 'assets/[name]-[hash][extname]'
				},
				preserveEntrySignatures: 'strict'
			}
		},
		plugins: [
			svelte({
				extensions: config.extensions,
				compilerOptions: {
					hydratable: !!config.kit.hydrate
				}
			})
		],
		resolve: {
			alias: {
				$app: path.resolve(`${build_dir}/runtime/app`),
				$lib: config.kit.files.lib
			}
		}
	});

	print_config_conflicts(conflicts, 'kit.vite.', 'build_server');

	const { chunks } = await create_build(merged_config);

	/** @type {Record<string, string[]>} */
	const lookup = {};
	chunks.forEach((chunk) => {
		if (!chunk.facadeModuleId) return;
		const id = chunk.facadeModuleId.slice(cwd.length + 1);
		lookup[id] = chunk.exports;
	});

	/** @type {Record<string, import('types/internal').HttpMethod[]>} */
	const methods = {};
	manifest_data.routes.forEach((route) => {
		if (route.type === 'endpoint' && lookup[route.file]) {
			methods[route.file] = lookup[route.file]
				.map((x) => /** @type {import('types/internal').HttpMethod} */ (method_names[x]))
				.filter(Boolean);
		}
	});

	return {
		chunks,
		/** @type {import('vite').Manifest} */
		vite_manifest: JSON.parse(fs.readFileSync(`${output_dir}/server/manifest.json`, 'utf-8')),
		methods: get_methods(cwd, chunks, manifest_data)
	};
}

/** @type {Record<string, string>} */
const method_names = {
	get: 'get',
	head: 'head',
	post: 'post',
	put: 'put',
	del: 'delete',
	patch: 'patch'
};

/**
 *
 * @param {string} cwd
 * @param {import('rollup').OutputChunk[]} output
 * @param {import('types/internal').ManifestData} manifest_data
 */
function get_methods(cwd, output, manifest_data) {
	/** @type {Record<string, string[]>} */
	const lookup = {};
	output.forEach((chunk) => {
		if (!chunk.facadeModuleId) return;
		const id = chunk.facadeModuleId.slice(cwd.length + 1);
		lookup[id] = chunk.exports;
	});

	/** @type {Record<string, import('types/internal').HttpMethod[]>} */
	const methods = {};
	manifest_data.routes.forEach((route) => {
		if (route.type === 'endpoint' && lookup[route.file]) {
			methods[route.file] = lookup[route.file]
				.map((x) => /** @type {import('types/internal').HttpMethod} */ (method_names[x]))
				.filter(Boolean);
		}
	});

	return methods;
}
