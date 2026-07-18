import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/client/App";
import type { FeeSnapshot, RatesResponse } from "../src/shared/types";

const rates: RatesResponse = {
  fetchedAt: "2026-07-18T00:00:00.000Z",
  cached: false,
  stale: false,
  sources: [
    { source: "national", status: "live" },
    { source: "beijing", status: "live" },
  ],
  rates: [
    {
      bankId: "a",
      bankName: "甲银行",
      sellRateCnyPerUsd: 7,
      publishedAtText: "10:00",
      source: "national",
      sourceUrl: "https://example.com/a",
    },
    {
      bankId: "b",
      bankName: "乙银行",
      sellRateCnyPerUsd: 7.005,
      publishedAtText: "10:00",
      source: "national",
      sourceUrl: "https://example.com/b",
    },
  ],
};

const fees: FeeSnapshot = {
  version: 1,
  snapshotType: "fixed-local",
  sourceUrl: "https://example.com/fees",
  capturedAt: "2026-07-18T00:00:00.000Z",
  manualOverrides: [],
  tiers: [
    {
      id: "a-normal",
      bankId: "a",
      bankName: "甲银行",
      label: "普通客户",
      feeRule: {
        kind: "percentage",
        percent: 0.001,
        minimumCny: 50,
        maximumCny: 200,
      },
      telegraphFeeUsCny: 100,
      rawFeeText: "0.1%",
      rawTelegraphText: "100元",
      officialUrl: null,
      remarks: null,
    },
    {
      id: "a-vip",
      bankId: "a",
      bankName: "甲银行",
      label: "贵宾客户",
      feeRule: { kind: "free", percent: 0, minimumCny: 0, maximumCny: 0 },
      telegraphFeeUsCny: 0,
      rawFeeText: "免费",
      rawTelegraphText: "免费",
      officialUrl: null,
      remarks: null,
    },
    {
      id: "b-normal",
      bankId: "b",
      bankName: "乙银行",
      label: "普通客户",
      feeRule: { kind: "free", percent: 0, minimumCny: 0, maximumCny: 0 },
      telegraphFeeUsCny: 0,
      rawFeeText: "免费",
      rawTelegraphText: "免费",
      officialUrl: null,
      remarks: null,
    },
  ],
};

function jsonResponse(value: unknown) {
  return Promise.resolve({ ok: true, json: async () => value } as Response);
}

describe("comparison UI", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes("/data/fees.json")
          ? jsonResponse(fees)
          : jsonResponse(rates),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("recalculates ranking after a customer tier change", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("乙银行");
    expect(screen.getAllByText("¥70,050.00").length).toBeGreaterThan(0);

    const selects = screen.getAllByLabelText("a 客户等级");
    await user.selectOptions(selects[0], "a-vip");

    await waitFor(() => {
      expect(screen.getAllByText("¥70,000.00").length).toBeGreaterThan(0);
    });
    expect(localStorage.getItem("bank-remittance-selected-tiers-v1")).toContain(
      "a-vip",
    );
  });

  it("fills the amount from a quick-select button", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("乙银行");

    await user.click(screen.getByRole("button", { name: "快速选择 5000 美元" }));

    expect(screen.getByLabelText("计划汇出金额")).toHaveValue(5000);
    expect(
      screen.getByRole("button", { name: "快速选择 5000 美元" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("reloads the KV-backed rate path from the refresh button", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("乙银行");

    await user.click(screen.getByRole("button", { name: "刷新牌价" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/rates?refresh=1", {
        cache: "reload",
      });
    });
  });
});
