import { render_endpoint } from './endpoint.js';
import { render_page } from './page/index.js';
import { render_response } from './page/render.js';
import { respond_with_error } from './page/respond_with_error.js';
import { parse_body } from './parse_body/index.js';
import { lowercase_keys } from './utils.js';
import { hash } from '../hash.js';
import { get_single_valued_header } from '../../utils/http.js';
import { coalesce_to_error } from '../../utils/error.js';

/** @type {import('@sveltejs/kit/ssr').Respond} */
export async function respond(incoming, options, state = {}) {
	if (incoming.path !== '/' && options.trailing_slash !== 'ignore') {
		const has_trailing_slash = incoming.path.endsWith('/');

		if (
			(has_trailing_slash && options.trailing_slash === 'never') ||
			(!has_trailing_slash &&
				options.trailing_slash === 'always' &&
				!(incoming.path.split('/').pop() || '').includes('.'))
		) {
			const path = has_trailing_slash ? incoming.path.slice(0, -1) : incoming.path + '/';
			const q = incoming.query.toString();

			return {
				status: 301,
				headers: {
					location: options.paths.base + path + (q ? `?${q}` : '')
				}
			};
		}
	}

	const headers = lowercase_keys(incoming.headers);
	const request = {
		...incoming,
		headers,
		body: parse_body(incoming.rawBody, headers),
		params: {},
		locals: {}
	};

	try {
		return await options.hooks.handle({
			request,
			resolve: async (request) => {
				if (state.prerender && state.prerender.fallback) {
					return await render_response({
						options,
						$session: await options.hooks.getSession(request),
						page_config: { ssr: false, router: true, hydrate: true },
						status: 200,
						branch: []
					});
				}

				const decoded = decodeURI(request.path);
				for (const route of options.manifest._.routes) {
					const match = route.pattern.exec(decoded);
					if (!match) continue;

					const response =
						route.type === 'endpoint'
							? await render_endpoint(request, route, match)
							: await render_page(request, route, match, options, state);

					if (response) {
						// inject ETags for 200 responses
						if (response.status === 200) {
							const cache_control = get_single_valued_header(response.headers, 'cache-control');
							if (!cache_control || !/(no-store|immutable)/.test(cache_control)) {
								let if_none_match_value = request.headers['if-none-match'];
								// ignore W/ prefix https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match#directives
								if (if_none_match_value?.startsWith('W/"')) {
									if_none_match_value = if_none_match_value.substring(2);
								}

								const etag = `"${hash(response.body || '')}"`;

								if (if_none_match_value === etag) {
									return {
										status: 304,
										headers: {}
									};
								}

								response.headers['etag'] = etag;
							}
						}

						return response;
					}
				}

				// if this request came direct from the user, rather than
				// via a `fetch` in a `load`, render a 404 page
				if (!state.initiator) {
					const $session = await options.hooks.getSession(request);
					return await respond_with_error({
						request,
						options,
						state,
						$session,
						status: 404,
						error: new Error(`Not found: ${request.path}`)
					});
				}
			}
		});
	} catch (/** @type {unknown} */ err) {
		const e = coalesce_to_error(err);

		options.handle_error(e, request);

		return {
			status: 500,
			headers: {},
			body: options.dev ? e.stack : e.message
		};
	}
}
