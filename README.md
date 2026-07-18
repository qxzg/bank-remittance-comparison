# 美元购汇与境外汇款成本比较器

React SPA 与原生 Cloudflare Worker 应用。页面使用实时美元现汇卖出价和固定电汇手续费快照，比较各银行的境内汇款总成本。

生产地址：<https://remittance.hx-sun.com>

## 本地开发

运行环境为 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

访问 <http://127.0.0.1:4173>。Cloudflare Vite 插件会同时运行 React、Worker、KV 与 Cache API 的本地兼容环境。

构建与本地生产预览：

```bash
npm run build
npm run preview
```

## 数据机制

Worker 的 Cron Trigger 每五分钟抓取两张美元牌价表，使用 `HTMLRewriter` 解析并合并结果。

- KV binding：`RATE_CACHE`
- KV key：`rates:usd:latest`
- Cache API TTL：60 秒
- 浏览器缓存：30 秒
- 过期判定：快照年龄超过 15 分钟
- 页面自动更新：五分钟

全国性银行源异常时保留上一份完整快照。北京源异常时将上一份北京银行牌价合并到新的全国牌价中。KV 为空时，首个 `/api/rates` 请求同步生成初始快照。

手续费快照位于 `public/data/fees.json`，构建后由 Workers Static Assets 直接提供。离线更新命令会抓取原始手续费表并应用本地修正规则：

```bash
npm run data:update
```

Cheerio 仅用于该离线维护命令。

## API

- `GET /api/health`：Worker 健康状态与当前时间。
- `GET /api/rates`：优先读取统一 Cache API 路径，再读取 KV。
- `GET /api/rates?refresh=1`：立即读取 KV 最新快照，并更新统一 Cache API 路径。
- 其他 `/api/*`：JSON 404。

牌价响应使用：

```text
Cache-Control: max-age=30, s-maxage=60, stale-while-revalidate=300
```

## 测试

```bash
npm test
npm run build
npx wrangler deploy --dry-run
npm audit --omit=dev
```

`npm test` 依次运行 React/计算/手续费测试和 Cloudflare Workers Vitest pool 测试。Worker 测试覆盖两张牌价表解析、Cron 写入 KV、单源回退、Cache API、KV、冷启动、15 分钟过期判定和 API 路由。

## Cloudflare 配置

[`wrangler.jsonc`](./wrangler.jsonc) 固定以下生产设置：

- Worker：`bank-remittance-comparison`
- Custom Domain：`remittance.hx-sun.com`
- KV namespace：`bank-remittance-comparison-rates`
- Cron：`*/5 * * * *`
- SPA Static Assets：`run_worker_first: ["/api/*"]`
- `workers_dev: false`
- `preview_urls: false`
- Workers Logs：100% head sampling

首次部署：

```bash
npm run build
npx wrangler deploy
curl -fsS https://remittance.hx-sun.com/api/rates
```

Cloudflare Builds 使用以下设置：

- GitHub 仓库：`qxzg/bank-remittance-comparison`
- 根目录：`/`
- 生产分支：`main`
- 构建命令：`npm run build`
- 部署命令：`npx wrangler deploy`
- 分支构建：仅 `main`

## 成本口径

```text
购汇成本 = 汇出美元本金 × 现汇卖出价
手续费 = 汇款金额百分比，并应用最低与最高收费
总成本 = 购汇成本 + 手续费 + 美国方向电报费
实际综合汇率 = 总成本 ÷ 汇出美元本金
```

排名覆盖境内发起端成本。中转行、收款行和全额到账服务费用以银行实际办理结果为准。

## 数据来源

- [全国性银行美元牌价](https://www.kylc.com/bank/rmbfx.html?ccy=usd)
- [北京地区美元牌价](https://www.kylc.com/huilv/bank/perccy/usd/110100.html)
- [境外电汇手续费](https://www.kylc.com/bank/fees/tt.html)
- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Workers KV](https://developers.cloudflare.com/kv/)
