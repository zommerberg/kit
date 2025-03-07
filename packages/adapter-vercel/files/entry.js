import { __fetch_polyfill } from '@sveltejs/kit/install-fetch';
import { getRawBody } from '@sveltejs/kit/node';
import { App } from 'APP';
import { manifest } from 'MANIFEST';

__fetch_polyfill();

const app = new App(manifest);

export default async (req, res) => {
	const { pathname, searchParams } = new URL(req.url || '', 'http://localhost');

	let body;

	try {
		body = await getRawBody(req);
	} catch (err) {
		res.statusCode = err.status || 400;
		return res.end(err.reason || 'Invalid request body');
	}

	const rendered = await app.render({
		method: req.method,
		headers: req.headers,
		path: pathname,
		query: searchParams,
		rawBody: body
	});

	if (rendered) {
		const { status, headers, body } = rendered;
		return res.writeHead(status, headers).end(body);
	}

	return res.writeHead(404).end();
};
