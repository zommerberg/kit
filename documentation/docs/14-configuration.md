---
title: Configuration
---

Your project's configuration lives in a `svelte.config.js` file. All values are optional. The complete list of options, with defaults, is shown here:

```js
/** @type {import('@sveltejs/kit').Config} */
const config = {
	// options passed to svelte.compile (https://svelte.dev/docs#svelte_compile)
	compilerOptions: null,

	// an array of file extensions that should be treated as Svelte components
	extensions: ['.svelte'],

	kit: {
		adapter: null,
		amp: false,
		appDir: '_app',
		files: {
			assets: 'static',
			hooks: 'src/hooks',
			lib: 'src/lib',
			routes: 'src/routes',
			serviceWorker: 'src/service-worker',
			template: 'src/app.html'
		},
		floc: false,
		headers: {
			host: null,
			protocol: null
		},
		host: null,
		hydrate: true,
		package: {
			dir: 'package',
			emitTypes: true,
			// excludes all .d.ts and files starting with _ as the name
			exports: (filepath) => !/^_|\/_|\.d\.ts$/.test(filepath),
			files: () => true
		},
		paths: {
			assets: '',
			base: ''
		},
		prerender: {
			concurrency: 1,
			crawl: true,
			enabled: true,
			entries: ['*'],
			onError: 'fail'
		},
		protocol: null,
		router: true,
		serviceWorker: {
			register: true,
			files: (filepath) => !/\.DS_STORE/.test(filepath)
		},
		ssr: true,
		target: null,
		trailingSlash: 'never',
		vite: () => ({})
	},

	// SvelteKit uses vite-plugin-svelte. Its options can be provided directly here.
	// See the available options at https://github.com/sveltejs/vite-plugin-svelte/blob/main/docs/config.md

	// options passed to svelte.preprocess (https://svelte.dev/docs#svelte_preprocess)
	preprocess: null
};

export default config;
```

### adapter

Required when running `svelte-kit build` and determines how the output is converted for different platforms. See [Adapters](#adapters).

### amp

Enable [AMP](#amp) mode.

### appDir

The directory relative to `paths.assets` where the built JS and CSS (and imported assets) are served from. (The filenames therein contain content-based hashes, meaning they can be cached indefinitely). Must not start or end with `/`.

### files

An object containing zero or more of the following `string` values:

- `assets` — a place to put static files that should have stable URLs and undergo no processing, such as `favicon.ico` or `manifest.json`
- `hooks` — the location of your hooks module (see [Hooks](#hooks))
- `lib` — your app's internal library, accessible throughout the codebase as `$lib`
- `routes` — the files that define the structure of your app (see [Routing](#routing))
- `serviceWorker` — the location of your service worker's entry point (see [Service workers](#service-workers))
- `template` — the location of the template for HTML responses

### floc

Google's [FLoC](https://github.com/WICG/floc) is a technology for targeted advertising that the [Electronic Frontier Foundation](https://www.eff.org/) has deemed [harmful](https://www.eff.org/deeplinks/2021/03/googles-floc-terrible-idea) to user privacy. [Browsers other than Chrome](https://www.theverge.com/2021/4/16/22387492/google-floc-ad-tech-privacy-browsers-brave-vivaldi-edge-mozilla-chrome-safari) have declined to implement it.

In common with services like [GitHub Pages](https://github.blog/changelog/2021-04-27-github-pages-permissions-policy-interest-cohort-header-added-to-all-pages-sites/), SvelteKit protects your users by automatically opting out of FLoC. It adds the following header to responses unless `floc` is `true`:

```
Permissions-Policy: interest-cohort=()
```

> This only applies to server-rendered responses — headers for prerendered pages (e.g. created with [adapter-static](https://github.com/sveltejs/kit/tree/master/packages/adapter-static)) are determined by the hosting platform.

### headers

The [`page.origin`] property is derived from the request protocol (normally `https`) and the host, which is taken from the `Host` header by default.

If your app is behind a reverse proxy (think load balancers and CDNs) then the `Host` header will be incorrect. In most cases, the underlying protocol and host are exposed via the [`X-Forwarded-Host`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-Host) and [`X-Forwarded-Proto`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-Proto) headers, which can be specified in your config:

```js
// svelte.config.js
export default {
	kit: {
		headers: {
			host: 'X-Forwarded-Host',
			protocol: 'X-Forwarded-Proto'
		}
	}
};
```

**You should only do this if you trust the reverse proxy**, which is why it isn't the default.

### host

A value that overrides the one derived from [`config.kit.headers.host`](#configuration-headers-host).

### hydrate

Whether to [hydrate](#ssr-and-javascript-hydrate) the server-rendered HTML with a client-side app. (It's rare that you would set this to `false` on an app-wide basis.)

### package

Options related to [creating a package](#packaging).

- `dir` - output directory
- `emitTypes` - by default, `svelte-kit package` will automatically generate types for your package in the form of `.d.ts` files. While generating types is configurable, we believe it is best for the ecosystem quality to generate types, always. Please make sure you have a good reason when setting it to `false` (for example when you want to provide handwritten type definitions instead)
- `exports` - a function with the type of `(filepath: string) => boolean`. When `true`, the filepath will be included in the `exports` field of the `package.json`. Any existing values in the `package.json` source will be merged with values from the original `exports` field taking precedence
- `files` - a function with the type of `(filepath: string) => boolean`. When `true`, the file will be processed and copied over to the final output folder, specified in `dir`

For advanced `filepath` matching, you can use `exports` and `files` options in conjunction with a globbing library:

```js
// svelte.config.js
import mm from 'micromatch';

export default {
	kit: {
		package: {
			exports: (filepath) => {
				if (filepath.endsWith('.d.ts')) return false;
				return mm.isMatch(filepath, ['!**/_*', '!**/internal/**']);
			},
			files: mm.matcher('!**/build.*')
		}
	}
};
```

### paths

An object containing zero or more of the following `string` values:

- `assets` — an absolute path that your app's files are served from. This is useful if your files are served from a storage bucket of some kind
- `base` — a root-relative path that must start, but not end with `/` (e.g. `/base-path`). This specifies where your app is served from and allows the app to live on a non-root path

### prerender

See [Prerendering](#ssr-and-javascript-prerender). An object containing zero or more of the following:

- `concurrency` — how many pages can be prerendered simultaneously. JS is single-threaded, but in cases where prerendering performance is network-bound (for example loading content from a remote CMS) this can speed things up by processing other tasks while waiting on the network response
- `crawl` — determines whether SvelteKit should find pages to prerender by following links from the seed page(s)
- `enabled` — set to `false` to disable prerendering altogether
- `entries` — an array of pages to prerender, or start crawling from (if `crawl: true`). The `*` string includes all non-dynamic routes (i.e. pages with no `[parameters]` )
- `onError`

  - `'fail'` — (default) fails the build when a routing error is encountered when following a link
  - `'continue'` — allows the build to continue, despite routing errors
  - `function` — custom error handler allowing you to log, `throw` and fail the build, or take other action of your choosing based on the details of the crawl

    ```ts
    import adapter from '@sveltejs/adapter-static';
    /** @type {import('@sveltejs/kit').PrerenderErrorHandler} */
    const handleError = ({ status, path, referrer, referenceType }) => {
    	if (path.startsWith('/blog')) throw new Error('Missing a blog page!');
    	console.warn(`${status} ${path}${referrer ? ` (${referenceType} from ${referrer})` : ''}`);
    };

    export default {
    	kit: {
    		adapter: adapter(),
    		target: '#svelte',
    		prerender: {
    			onError: handleError
    		}
    	}
    };
    ```

### protocol

The protocol is assumed to be `'https'` (unless you're developing locally without the `--https` flag) unless [`config.kit.headers.protocol`](#configuration-headers-protocol) is set. If necessary, you can override it here.

### router

Enables or disables the client-side [router](#ssr-and-javascript-router) app-wide.

### serviceWorker

An object containing zero or more of the following values:

- `files` - a function with the type of `(filepath: string) => boolean`. When `true`, the given file will be available in `$service-worker.files`, otherwise it will be excluded.

### ssr

Enables or disables [server-side rendering](#ssr-and-javascript-ssr) app-wide.

### target

Specifies an element to mount the app to. It must be a DOM selector that identifies an element that exists in your template file. If unspecified, the app will be mounted to `document.body`.

### trailingSlash

Whether to remove, append, or ignore trailing slashes when resolving URLs to routes.

- `"never"` — redirect `/x/` to `/x`
- `"always"` — redirect `/x` to `/x/`
- `"ignore"` — don't automatically add or remove trailing slashes. `/x` and `/x/` will be treated equivalently

> Ignoring trailing slashes is not recommended — the semantics of relative paths differ between the two cases (`./y` from `/x` is `/y`, but from `/x/` is `/x/y`), and `/x` and `/x/` are treated as separate URLs which is harmful to SEO. If you use this option, ensure that you implement logic for conditionally adding or removing trailing slashes from `request.path` inside your [`handle`](#hooks-handle) function.

### vite

A [Vite config object](https://vitejs.dev/config), or a function that returns one. You can pass [Vite and Rollup plugins](https://github.com/vitejs/awesome-vite#plugins) via [the `plugins` option](https://vitejs.dev/config/#plugins) to customize your build in advanced ways such as supporting image optimization, Tauri, WASM, Workbox, and more. SvelteKit will prevent you from setting certain build-related options since it depends on certain configuration values.
