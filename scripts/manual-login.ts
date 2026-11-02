import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { browserLaunchArgs } from "../src/monitor/browserLaunchArgs.js";

const userDataDir = process.env.BROWSER_USER_DATA_DIR ?? ".browser/douyin";
const inboxUrl = process.env.DOUYIN_INBOX_URL ?? "https://www.douyin.com";

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: browserLaunchArgs({ headless: false, offscreen: false }),
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(inboxUrl, { waitUntil: "domcontentloaded" });

console.log("浏览器已打开抖音，请完成扫码和所有验证步骤。");
console.log("登录成功后，回到这个终端窗口，按回车键关闭浏览器。");

const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question("");
rl.close();

await context.close();
console.log("浏览器已关闭。登录状态已保存至", userDataDir);
console.log("登录状态已保存。现在可以运行自动 worker 或 pnpm probe:media 使用该登录态。");
