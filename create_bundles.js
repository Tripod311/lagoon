import * as esbuild from "esbuild";
import fs from "fs"

async function nodeBundle () {
    const result = await esbuild.build({
        entryPoints: ["src/node/worker.ts"],
        bundle: true,
        platform: "node",
        format: "iife",
        target: "node20",
        minify: false,
        write: false,
        sourcemap: false
    });

    const code = result.outputFiles[0].text;

    await fs.promises.writeFile("./src/node/worker.bundle.ts",[
        "// This file is generated. Do not edit manually.",
        `const workerBundle = ${JSON.stringify(code)};`,
        "export default workerBundle;",
        ""
    ].join("\n"));
}

async function browserBundle () {
    const result = await esbuild.build({
        entryPoints: ["src/browser/worker.ts"],
        bundle: true,
        platform: "browser",
        format: "iife",
        target: "es2020",
        minify: false,
        write: false,
        sourcemap: false
    });

    const code = result.outputFiles[0].text;

    await fs.promises.writeFile("./src/browser/worker.bundle.ts",[
        "// This file is generated. Do not edit manually.",
        `const workerBundle = ${JSON.stringify(code)};`,
        "export default workerBundle;",
        ""
    ].join("\n"));
}

nodeBundle();
browserBundle();