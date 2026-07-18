import { writeFile } from "node:fs/promises";
import type { FeeSnapshot } from "../src/shared/types";
import { applyFeeOverrides } from "./fee-overrides";
import { FEES_URL, parseFeesHtml } from "./fee-parser";

const response = await fetch(FEES_URL, {
  headers: {
    accept: "text/html,application/xhtml+xml",
    "accept-language": "zh-CN,zh;q=0.9",
    "user-agent": "BankRemittanceComparisonFeeSnapshot/1.0",
  },
});

if (!response.ok) {
  throw new Error(`手续费页面请求失败：HTTP ${response.status}`);
}

const tiers = applyFeeOverrides(parseFeesHtml(await response.text()));
if (tiers.length === 0) {
  throw new Error("手续费页面中未找到收费规则");
}

const snapshot: FeeSnapshot = {
  version: 1,
  snapshotType: "fixed-local",
  sourceUrl: FEES_URL,
  capturedAt: new Date().toISOString(),
  manualOverrides: [
    "华夏银行手机银行手续费按0.5‰收取，最低20元、最高200元",
    "招商银行所有客户等级电报费100元",
    "招商银行普通客户手续费按1‰收取，最低50元、最高280元",
    "招商银行金卡客户手续费按0.5‰收取，最低50元、最高280元",
  ],
  tiers,
};

await writeFile(
  new URL("../public/data/fees.json", import.meta.url),
  `${JSON.stringify(snapshot, null, 2)}\n`,
);

console.log(`已更新 ${tiers.length} 条手续费规则：public/data/fees.json`);
