const BANK_ALIASES: Readonly<Record<string, string>> = {
  中国银行: "中国银行",
  工商银行: "中国工商银行",
  中国工商银行: "中国工商银行",
  建设银行: "中国建设银行",
  中国建设银行: "中国建设银行",
  农业银行: "中国农业银行",
  中国农业银行: "中国农业银行",
  交通银行: "交通银行",
  招商银行: "招商银行",
  光大银行: "中国光大银行",
  中国光大银行: "中国光大银行",
  华夏银行: "华夏银行",
  广发银行: "广发银行",
  浦发银行: "浦发银行",
  兴业银行: "兴业银行",
  中信银行: "中信银行",
  平安银行: "平安银行",
  民生银行: "中国民生银行",
  中国民生银行: "中国民生银行",
  邮储银行: "邮储银行",
  中国邮政储蓄银行: "邮储银行",
  渤海银行: "渤海银行",
  恒丰银行: "恒丰银行",
  浙商银行: "浙商银行",
  北京银行: "北京银行",
  宁波银行: "宁波银行",
  江苏银行: "江苏银行",
  上海银行: "上海银行",
  汇丰银行: "汇丰银行",
  渣打银行: "渣打银行",
  支付宝上银汇款: "支付宝上银汇款",
};

const BANK_IDS: Record<string, string> = {
  中国银行: "boc",
  中国工商银行: "icbc",
  中国建设银行: "ccb",
  中国农业银行: "abc",
  交通银行: "bocom",
  招商银行: "cmb",
  中国光大银行: "ceb",
  华夏银行: "hxb",
  广发银行: "cgb",
  浦发银行: "spdb",
  兴业银行: "cib",
  中信银行: "citic",
  平安银行: "pab",
  中国民生银行: "cmbc",
  邮储银行: "psbc",
  渤海银行: "cbhb",
  恒丰银行: "hfb",
  浙商银行: "czb",
  北京银行: "bob",
  宁波银行: "nbcb",
  江苏银行: "jsb",
  上海银行: "bos",
  汇丰银行: "hsbc",
  渣打银行: "scb",
  支付宝上银汇款: "alipay-bos",
};

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBankName(value: string): string {
  const clean = normalizeWhitespace(value);
  return BANK_ALIASES[clean] ?? clean;
}

export function getBankId(value: string): string {
  const name = normalizeBankName(value);
  return (
    BANK_IDS[name] ??
    `bank-${Array.from(name)
      .map((character) => character.codePointAt(0)?.toString(16))
      .join("-")}`
  );
}

export function makeTierId(bankId: string, index: number, label: string): string {
  const suffix = Array.from(label)
    .slice(0, 8)
    .map((character) => character.codePointAt(0)?.toString(16))
    .join("-");
  return `${bankId}-${index}-${suffix}`;
}
