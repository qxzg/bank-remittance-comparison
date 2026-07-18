import {
  parseBeijingBankRateHtml,
  parseFeeRule,
  parseFeesHtml,
  parseNationalRatesHtml,
  parseUsTelegraphFee,
} from "../src/server/parsers";

describe("rate parsers", () => {
  it("parses the USD cash-remittance selling column", () => {
    const html = `
      <table id="bank_rate_usd"><tbody>
        <tr>
          <td>中国银行</td><td>6.70</td><td>6.60</td>
          <td>6.812345 <i>best</i></td><td>6.90</td><td>07月18日 10:20</td>
        </tr>
        <tr><td>空牌价银行</td><td>--</td><td>--</td><td>--</td><td>--</td><td>--</td></tr>
      </tbody></table>`;

    expect(parseNationalRatesHtml(html)).toEqual([
      expect.objectContaining({
        bankId: "boc",
        bankName: "中国银行",
        sellRateCnyPerUsd: 6.812345,
        publishedAtText: "07月18日 10:20",
      }),
    ]);
  });

  it("extracts Beijing Bank from the city table", () => {
    const html = `
      <table id="bank_rate"><tbody>
        <tr><td>中国银行</td><td>全国性</td><td>6.7</td><td>6.6</td><td>6.81</td><td>6.9</td><td>07月18日 10:00</td></tr>
        <tr><td>北京银行</td><td>地方性</td><td>6.7</td><td>6.6</td><td>6.79</td><td>6.9</td><td>07月18日 10:10</td></tr>
      </tbody></table>`;

    expect(parseBeijingBankRateHtml(html)).toEqual(
      expect.objectContaining({
        bankId: "bob",
        bankName: "北京银行",
        sellRateCnyPerUsd: 6.79,
      }),
    );
  });
});

describe("fee parsers", () => {
  it("parses percentage limits and destination fees", () => {
    expect(parseFeeRule("汇款金额的0.10%,最低20元/笔,最高200元/笔")).toEqual({
      kind: "percentage",
      percent: 0.001,
      minimumCny: 20,
      maximumCny: 200,
    });
    expect(parseUsTelegraphFee("港澳台:80元/笔; 其余:150元/笔")).toBe(150);
    expect(parseUsTelegraphFee("免费")).toBe(0);
  });

  it("carries bank and official link across rowspan rows", () => {
    const html = `
      <table id="table"><tbody>
        <tr>
          <td rowspan="2" class="bank_name">工商银行</td>
          <td>普通客户电子渠道</td>
          <td>汇款金额的0.08%,最低40元/笔,最高208元/笔</td>
          <td><p>港澳台:80元/笔; 其余:100元/笔</p></td>
          <td>网点</td><td><a href="https://bank.example/fees">查看</a></td>
          <td><a onclick="show_info('标题', '电子渠道收费说明');">说明</a></td>
          <td></td><td></td>
        </tr>
        <tr>
          <td style="display:none"></td><td>普通客户</td>
          <td>汇款金额的0.10%,最低50元/笔,最高260元/笔</td>
          <td>150元/笔</td><td></td><td></td><td></td><td></td><td></td>
        </tr>
      </tbody></table>`;

    const tiers = parseFeesHtml(html);
    expect(tiers).toHaveLength(2);
    expect(tiers[0]).toEqual(
      expect.objectContaining({
        bankId: "icbc",
        bankName: "中国工商银行",
        telegraphFeeUsCny: 100,
        officialUrl: "https://bank.example/fees",
        remarks: "电子渠道收费说明",
      }),
    );
    expect(tiers[1]).toEqual(
      expect.objectContaining({
        bankId: "icbc",
        telegraphFeeUsCny: 150,
        officialUrl: "https://bank.example/fees",
      }),
    );
  });
});

