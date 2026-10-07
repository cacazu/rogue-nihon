import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Optional browser driver only: the regression scenarios and game assertions stay unchanged.
export async function createPlaywrightCdp({ executable, profile }) {
  const modulePath = require.resolve(process.env.ROGUE_PLAYWRIGHT_MODULE);
  const { chromium } = require(modulePath);
  const args = ["--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update"];
  process.env.TEMP = profile;
  process.env.TMP = profile;
  let context;
  try {
  context = await chromium.launchPersistentContext(profile, { executablePath: executable, headless: true, args, downloadsPath: path.join(profile, "downloads") });
  const page = context.pages()[0] || await context.newPage();
  const session = await context.newCDPSession(page);
  const events = [];
  for (const method of ["Runtime.exceptionThrown", "Runtime.consoleAPICalled"]) session.on(method, (params) => events.push({ method, params }));
  async function call(method, params = {}) {
    let timer;
    try {
      if (method === "Emulation.setDeviceMetricsOverride" && params.width && params.height) await page.setViewportSize({ width: params.width, height: params.height });
      return await Promise.race([session.send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("CDP timeout: " + method)), 30000); })]);
    } finally { clearTimeout(timer); }
  }
  return {
    events,
    launch: { driver: "playwright-cdpsession", playwright: modulePath, browser_version: context.browser().version(), executable, profile, headless: true, args },
    call,
    async evaluate(expression, userGesture = false) {
      const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    async close() { await context.close(); }
  };
  } catch (error) {
    try { await context?.close(); } catch (closeError) { error.cause ??= closeError; }
    throw error;
  }
}
