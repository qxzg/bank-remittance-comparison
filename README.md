# 美元购汇与境外汇款成本比较器

本地网页应用，用实时美元现汇卖出价和固定本地电汇手续费快照比较各银行的境内汇款总成本。

## 启动

```bash
npm install
npm run dev
```

浏览器访问 `http://127.0.0.1:4173`。

生产模式：

```bash
npm run build
npm start
```

浏览器访问 `http://127.0.0.1:4174`。

## 数据方式

牌价在页面加载时获取，之后每 60 秒自动更新；“刷新牌价”按钮会请求即时抓取。

手续费固定保存在 `data/fees.json`。该文件包含快易理财网原始手续费数据，以及 `src/server/fee-overrides.ts` 中记录的华夏银行和招商银行手动修正规则。应用运行期间只读取这份本地快照。

## 成本口径

```text
购汇成本 = 汇出美元本金 × 现汇卖出价
手续费 = 汇款金额百分比，并应用最低与最高收费
总成本 = 购汇成本 + 手续费 + 美国方向电报费
实际综合汇率 = 总成本 ÷ 汇出美元本金
```

排名覆盖境内发起端成本。中转行、收款行和全额到账服务费用以银行实际办理结果为准。

## 验证

```bash
npm test
npm run build
```

## 数据来源

- [全国性银行美元牌价](https://www.kylc.com/bank/rmbfx.html?ccy=usd)
- [北京地区美元牌价](https://www.kylc.com/huilv/bank/perccy/usd/110100.html)
- [境外电汇手续费](https://www.kylc.com/bank/fees/tt.html)
