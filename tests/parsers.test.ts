import {
  parseFeeRule,
  parseFeesHtml,
  parseUsTelegraphFee,
} from "../scripts/fee-parser";

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
