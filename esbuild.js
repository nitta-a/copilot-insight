// @ts-check
const esbuild = require("esbuild");
const { version } = require("./package.json");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location?.file}:${location?.line}:${location?.column}:`);
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts", "src/worker/dbWorker.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outdir: "dist",
    outbase: "src",
    external: ["vscode", "native-parser", "native-parser/*", "./native-parser/*", "../native-parser/*"],
    logLevel: "silent",
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });

  // Separate bundle for the MCP server (standalone Node.js process, CJS format).
  const mcpCtx = await esbuild.context({
    entryPoints: ["src/mcp/server.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/mcp-server.js",
    logLevel: "silent",
    define: { __PKG_VERSION__: JSON.stringify(version) },
    plugins: [esbuildProblemMatcherPlugin],
    external: ["native-parser", "native-parser/*", "./native-parser/*", "../native-parser/*"],
  });

  // Separate bundle for the WebView frontend (browser context, IIFE format).
  const webviewCtx = await esbuild.context({
    entryPoints: ["webview/dashboard.ts"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/webview/dashboard.js",
    logLevel: "silent",
    jsx: "automatic",
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
    await mcpCtx.watch();
    await webviewCtx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    await mcpCtx.rebuild();
    await mcpCtx.dispose();
    await webviewCtx.rebuild();
    await webviewCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
