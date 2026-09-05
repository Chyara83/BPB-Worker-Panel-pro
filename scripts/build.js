import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { globSync } from 'glob';
import { minify as jsMinify } from 'terser';
import { minify as htmlMinify } from 'html-minifier';
import JSZip from "jszip";
import obfs from 'javascript-obfuscator';
import pkg from '../package.json' with { type: 'json' };
import { gzipSync } from 'zlib';

const env = process.env.NODE_ENV || 'mangle';
const mangleMode = env === 'mangle';
const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);
const ASSET_PATH = join(__dirname, '../src/assets');
const DIST_PATH = join(__dirname, '../dist/');
const green = '\x1b[32m'; const red = '\x1b[31m'; const reset = '\x1b[0m';
const success = `${green}✔${reset}`; const failure = `${red}✗${reset}`;
const version = pkg.version;

async function processHtmlPages() {
    const indexFiles = globSync('**/index.html', { cwd: ASSET_PATH });
    const result = {};
    for (const relativeIndexPath of indexFiles) {
        const dir = pathDirname(relativeIndexPath);
        const base = (file) => join(ASSET_PATH, dir, file);
        const indexHtml = readFileSync(base('index.html'), 'utf8');
        let finalHtml = indexHtml.replaceAll('__VERSION__', version);
        if (dir !== 'error') {
            const styleCode = readFileSync(base('style.css'), 'utf8');
            const scriptCode = readFileSync(base('script.js'), 'utf8');
            const finalScriptCode = await jsMinify(scriptCode);
            finalHtml = finalHtml.replaceAll('__STYLE__', `<style>${styleCode}</style>`).replaceAll('__SCRIPT__', finalScriptCode.code);
        }
        const minifiedHtml = htmlMinify(finalHtml, { collapseWhitespace: true, removeAttributeQuotes: true, minifyCSS: true });
        result[dir] = JSON.stringify(gzipSync(minifiedHtml).toString('base64'));
    }
    console.log(`${success} Assets bundled successfuly!`);
    return result;
}

function generateJunkCode() {
    const minVars = 50, maxVars = 500, minFuncs = 50, maxFuncs = 500;
    const varCount = Math.floor(Math.random() * (maxVars - minVars + 1)) + minVars;
    const funcCount = Math.floor(Math.random() * (maxFuncs - minFuncs + 1)) + minFuncs;
    const junkVars = Array.from({ length: varCount }, (_, i) => `let __junk_${Math.random().toString(36).substring(2, 10)}_${i} = ${Math.floor(Math.random() * 100000)};`).join('\n');
    const junkFuncs = Array.from({ length: funcCount }, (_, i) => `function __junkFunc_${Math.random().toString(36).substring(2, 10)}_${i}() { return ${Math.floor(Math.random() * 1000)}; }`).join('\n');
    return `${junkVars}\n${junkFuncs}\n`;
}

async function buildWorker() {
    const htmls = await processHtmlPages();
    const faviconBuffer = readFileSync('./src/assets/favicon.ico');
    const code = await build({
        entryPoints: [join(__dirname, '../src/worker.ts')], bundle: true, format: 'esm', write: false,
        external: ['cloudflare:sockets', 'cloudflare:workers'], platform: 'browser', target: 'esnext', loader: { '.ts': 'ts' },
        define: {
            __PANEL_HTML_CONTENT__: htmls['panel'] ?? '""', __LOGIN_HTML_CONTENT__: htmls['login'] ?? '""', __ERROR_HTML_CONTENT__: htmls['error'] ?? '""',
            __SECRETS_HTML_CONTENT__: htmls['secrets'] ?? '""', __PROXY_IP_HTML_CONTENT__: htmls['proxy-ip'] ?? '""', __ICON__: JSON.stringify(faviconBuffer.toString('base64')), __VERSION__: JSON.stringify(version)
        }
    });
    console.log(`${success} Worker built successfuly!`);
    const minifyCode = async (source) => jsMinify(source, { module: true, output: { comments: false }, compress: { dead_code: false, unused: false } });
    let finalCode;
    if (mangleMode) {
        finalCode = (await minifyCode(generateJunkCode() + code.outputFiles[0].text)).code;
        console.log(`${success} Worker minified successfuly!`);
    } else {
        const minifiedCode = await minifyCode(code.outputFiles[0].text);
        console.log(`${success} Worker minified successfuly!`);
        finalCode = obfs.obfuscate(minifiedCode.code, { stringArrayThreshold: 1, stringArrayEncoding: ["rc4"], numbersToExpressions: true, transformObjectKeys: true, renameGlobals: true, deadCodeInjection: true, deadCodeInjectionThreshold: 0.2, target: "browser" }).getObfuscatedCode();
        console.log(`${success} Worker obfuscated successfuly!`);
    }
    const worker = `// Build: ${new Date().toISOString()}\n// @ts-nocheck\n${finalCode}`;
    mkdirSync(DIST_PATH, { recursive: true });
    writeFileSync('./dist/worker.js', worker, 'utf8');
    const zip = new JSZip();
    zip.file('_worker.js', worker);
    zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then(nodebuffer => writeFileSync('./dist/worker.zip', nodebuffer));
    console.log(`${success} Done!`);
}

buildWorker().catch(err => { console.error(`${failure} Build failed:`, err); process.exit(1); });
