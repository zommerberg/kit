import { router as router_ } from '../client/singletons.js';
import { get_base_uri } from '../client/utils.js';

const router = /** @type {import('../client/router').Router} */ (router_);

/**
 * @param {string} name
 */
function guard(name) {
	return () => {
		throw new Error(`Cannot call ${name}(...) on the server`);
	};
}

export const goto = import.meta.env.SSR ? guard('goto') : goto_;
export const invalidate = import.meta.env.SSR ? guard('invalidate') : invalidate_;
export const prefetch = import.meta.env.SSR ? guard('prefetch') : prefetch_;
export const prefetchRoutes = import.meta.env.SSR ? guard('prefetchRoutes') : prefetchRoutes_;
export const onBeforeNavigate = import.meta.env.SSR ? () => {} : onBeforeNavigate_;
export const onNavigate = import.meta.env.SSR ? () => {} : onNavigate_;

/**
 * @type {import('$app/navigation').goto}
 */
async function goto_(href, opts) {
	return router.goto(href, opts, []);
}

/**
 * @type {import('$app/navigation').invalidate}
 */
async function invalidate_(resource) {
	const { href } = new URL(resource, location.href);
	return router.renderer.invalidate(href);
}

/**
 * @type {import('$app/navigation').prefetch}
 */
function prefetch_(href) {
	return router.prefetch(new URL(href, get_base_uri(document)));
}

/**
 * @type {import('$app/navigation').prefetchRoutes}
 */
async function prefetchRoutes_(pathnames) {
	const matching = pathnames
		? router.routes.filter((route) => pathnames.some((pathname) => route[0].test(pathname)))
		: router.routes;

	const promises = matching.map((r) => Promise.all(r[1].map((load) => load())));

	await Promise.all(promises);
}

/**
 * @type {import('$app/navigation').onBeforeNavigate}
 */
function onBeforeNavigate_(fn) {
	return router.on_before_navigate(fn);
}

/**
 * @type {import('$app/navigation').onNavigate}
 */
function onNavigate_(fn) {
	return router.on_navigate(fn);
}
