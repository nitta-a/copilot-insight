// @ts-check
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Copy DuckDB Wasm binary files to dist/ so they are available at runtime. */
function copyDuckDBBinaries() {
	let duckdbDist;
	try {
		duckdbDist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
	} catch (e) {
		console.error("✘ [ERROR] @duckdb/duckdb-wasm is not installed. Run `npm install` and retry.");
		throw e;
	}
	const filesToCopy = [
		"duckdb-mvp.wasm",
		"duckdb-eh.wasm",
		"duckdb-node-mvp.worker.cjs",
		"duckdb-node-eh.worker.cjs",
	];
	fs.mkdirSync("dist", { recursive: true });
	for (const file of filesToCopy) {
		try {
			fs.copyFileSync(path.join(duckdbDist, file), path.join("dist", file));
		} catch (e) {
			console.error(`✘ [ERROR] Failed to copy DuckDB binary "${file}" to dist/: ${e}`);
			throw e;
		}
	}
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location?.file}:${location?.line}:${location?.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	copyDuckDBBinaries();
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
