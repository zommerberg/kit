import { normalize } from '../../load.js';
import { respond } from '../index.js';
import { s } from '../../../utils/misc.js';
import { escape_json_string_in_html } from '../../../utils/escape.js';
import { is_root_relative, resolve } from '../../../utils/url.js';

/**
 * @param {{
 *   request: import('types/hooks').ServerRequest;
 *   options: import('types/internal').SSRRenderOptions;
 *   state: import('types/internal').SSRRenderState;
 *   route: import('types/internal').SSRPage | null;
 *   page: import('types/page').Page;
 *   node: import('types/internal').SSRNode;
 *   $session: any;
 *   stuff: Record<string, any>;
 *   prerender_enabled: boolean;
 *   is_leaf: boolean;
 *   is_error: boolean;
 *   status?: number;
 *   error?: Error;
 * }} opts
 * @returns {Promise<import('./types').Loaded | undefined>} undefined for fallthrough
 */
export async function load_node({
	request,
	options,
	state,
	route,
	page,
	node,
	$session,
	stuff,
	prerender_enabled,
	is_leaf,
	is_error,
	status,
	error
}) {
	const { module } = node;

	let uses_credentials = false;

	/**
	 * @type {Array<{
	 *   url: string;
	 *   body: string;
	 *   json: string;
	 * }>}
	 */
	const fetched = [];

	/**
	 * @type {string[]}
	 */
	let set_cookie_headers = [];

	let loaded;

	const page_proxy = new Proxy(page, {
		get: (target, prop, receiver) => {
			if (prop === 'query' && prerender_enabled) {
				throw new Error('Cannot access query on a page with prerendering enabled');
			}
			return Reflect.get(target, prop, receiver);
		}
	});

	if (module.load) {
		/** @type {import('types/page').LoadInput | import('types/page').ErrorLoadInput} */
		const load_input = {
			page: page_proxy,
			get session() {
				uses_credentials = true;
				return $session;
			},
			/**
			 * @param {RequestInfo} resource
			 * @param {RequestInit} opts
			 */
			fetch: async (resource, opts = {}) => {
				/** @type {string} */
				let url;

				if (typeof resource === 'string') {
					url = resource;
				} else {
					url = resource.url;

					opts = {
						method: resource.method,
						headers: resource.headers,
						body: resource.body,
						mode: resource.mode,
						credentials: resource.credentials,
						cache: resource.cache,
						redirect: resource.redirect,
						referrer: resource.referrer,
						integrity: resource.integrity,
						...opts
					};
				}

				opts.headers = new Headers(opts.headers);

				const resolved = resolve(request.path, url.split('?')[0]);

				let response;

				// handle fetch requests for static assets. e.g. prebaked data, etc.
				// we need to support everything the browser's fetch supports
				const prefix = options.paths.assets || options.paths.base;
				const filename = (
					resolved.startsWith(prefix) ? resolved.slice(prefix.length) : resolved
				).slice(1);
				const filename_html = `${filename}/index.html`; // path may also match path/index.html

				const is_asset = options.manifest.assets.has(filename);
				const is_asset_html = options.manifest.assets.has(filename_html);

				if (is_asset || is_asset_html) {
					const file = is_asset ? filename : filename_html;

					if (options.read) {
						const type = is_asset
							? options.manifest._.mime[filename.slice(filename.lastIndexOf('.'))]
							: 'text/html';

						response = new Response(options.read(file), {
							headers: type ? { 'content-type': type } : {}
						});
					} else {
						response = await fetch(`${page.origin}/${file}`, /** @type {RequestInit} */ (opts));
					}
				} else if (is_root_relative(resolved)) {
					const relative = resolved;

					// TODO: fix type https://github.com/node-fetch/node-fetch/issues/1113
					if (opts.credentials !== 'omit') {
						uses_credentials = true;

						if (request.headers.cookie) {
							opts.headers.set('cookie', request.headers.cookie);
						}

						if (request.headers.authorization && !opts.headers.has('authorization')) {
							opts.headers.set('authorization', request.headers.authorization);
						}
					}

					if (opts.body && typeof opts.body !== 'string') {
						// per https://developer.mozilla.org/en-US/docs/Web/API/Request/Request, this can be a
						// Blob, BufferSource, FormData, URLSearchParams, USVString, or ReadableStream object.
						// non-string bodies are irksome to deal with, but luckily aren't particularly useful
						// in this context anyway, so we take the easy route and ban them
						throw new Error('Request body must be a string');
					}

					const search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';

					const rendered = await respond(
						{
							origin: request.origin,
							method: opts.method || 'GET',
							headers: Object.fromEntries(opts.headers),
							path: relative,
							rawBody: opts.body == null ? null : new TextEncoder().encode(opts.body),
							query: new URLSearchParams(search)
						},
						options,
						{
							fetched: url,
							initiator: route
						}
					);

					if (rendered) {
						if (state.prerender) {
							state.prerender.dependencies.set(relative, rendered);
						}

						// Set-Cookie must be filtered out (done below) and that's the only header value that
						// can be an array so we know we have only simple values
						// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
						response = new Response(rendered.body, {
							status: rendered.status,
							headers: /** @type {Record<string, string>} */ (rendered.headers)
						});
					} else {
						// we can't load the endpoint from our own manifest,
						// so we need to make an actual HTTP request
						return fetch(request.origin + relative + search, {
							method: opts.method || 'GET',
							headers: opts.headers
						});
					}
				} else {
					// external
					if (resolved.startsWith('//')) {
						throw new Error(`Cannot request protocol-relative URL (${url}) in server-side fetch`);
					}

					// external fetch
					if (typeof request.origin !== 'undefined') {
						const fetch_hostname = new URL(url).hostname;
						const server_hostname = new URL(request.origin).hostname;

						// allow cookie passthrough for "same-origin"
						// if SvelteKit is serving my.domain.com:
						// -        domain.com WILL NOT receive cookies
						// -     my.domain.com WILL receive cookies
						// -    api.domain.dom WILL NOT receive cookies
						// - sub.my.domain.com WILL receive cookies
						// ports do not affect the resolution
						// leading dot prevents mydomain.com matching domain.com
						if (
							`.${fetch_hostname}`.endsWith(`.${server_hostname}`) &&
							opts.credentials !== 'omit'
						) {
							uses_credentials = true;
							opts.headers.set('cookie', request.headers.cookie);
						}
					}

					const external_request = new Request(url, /** @type {RequestInit} */ (opts));
					response = await options.hooks.externalFetch.call(null, external_request);
				}

				if (response) {
					const proxy = new Proxy(response, {
						get(response, key, _receiver) {
							async function text() {
								const body = await response.text();

								/** @type {import('types/helper').ResponseHeaders} */
								const headers = {};
								for (const [key, value] of response.headers) {
									if (key === 'set-cookie') {
										set_cookie_headers = set_cookie_headers.concat(value);
									} else if (key !== 'etag') {
										headers[key] = value;
									}
								}

								if (!opts.body || typeof opts.body === 'string') {
									// prettier-ignore
									fetched.push({
										url,
										body: /** @type {string} */ (opts.body),
										json: `{"status":${response.status},"statusText":${s(response.statusText)},"headers":${s(headers)},"body":"${escape_json_string_in_html(body)}"}`
									});
								}

								return body;
							}

							if (key === 'text') {
								return text;
							}

							if (key === 'json') {
								return async () => {
									return JSON.parse(await text());
								};
							}

							// TODO arrayBuffer?

							return Reflect.get(response, key, response);
						}
					});

					return proxy;
				}

				return (
					response ||
					new Response('Not found', {
						status: 404
					})
				);
			},
			stuff: { ...stuff }
		};

		if (is_error) {
			/** @type {import('types/page').ErrorLoadInput} */ (load_input).status = status;
			/** @type {import('types/page').ErrorLoadInput} */ (load_input).error = error;
		}

		loaded = await module.load.call(null, load_input);
	} else {
		loaded = {};
	}

	// if leaf node (i.e. page component) has a load function
	// that returns nothing, we fall through to the next one
	if (!loaded && is_leaf && !is_error) return;

	if (!loaded) {
		throw new Error(`${node.entry} - load must return a value except for page fall through`);
	}

	return {
		node,
		loaded: normalize(loaded),
		stuff: loaded.stuff || stuff,
		fetched,
		set_cookie_headers,
		uses_credentials
	};
}
