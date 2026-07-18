import { RateService } from "../src/server/rate-service";

const nationalHtml = `
  <table id="bank_rate_usd"><tbody>
    <tr><td>中国银行</td><td>6.7</td><td>6.6</td><td>6.81</td><td>6.9</td><td>07月18日 10:00</td></tr>
  </tbody></table>`;
const beijingHtml = `
  <table id="bank_rate"><tbody>
    <tr><td>北京银行</td><td>地方性</td><td>6.7</td><td>6.6</td><td>6.79</td><td>6.9</td><td>07月18日 10:10</td></tr>
  </tbody></table>`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("RateService", () => {
  it("merges both sources and reuses the TTL cache", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("110100") ? beijingHtml : nationalHtml,
    );
    const service = new RateService(fetcher, 60_000);

    const first = await service.getRates();
    const second = await service.getRates();
    expect(first.rates.map((rate) => rate.bankId)).toEqual(["boc", "bob"]);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns nationwide data with a source warning", async () => {
    const service = new RateService(async (url) => {
      if (url.includes("110100")) throw new Error("timeout");
      return nationalHtml;
    });
    const result = await service.getRates();
    expect(result.rates).toHaveLength(1);
    expect(result.stale).toBe(true);
    expect(result.sources.at(-1)?.status).toBe("error");
  });

  it("serves the last successful result when the national source fails", async () => {
    let healthy = true;
    const service = new RateService(async (url) => {
      if (!healthy) throw new Error("timeout");
      return url.includes("110100") ? beijingHtml : nationalHtml;
    });
    await service.getRates();
    healthy = false;
    const result = await service.getRates(true);
    expect(result.cached).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.rates).toHaveLength(2);
  });

  it("shares one refresh across concurrent cache misses", async () => {
    const gate = deferred();
    const fetcher = vi.fn(async (url: string) => {
      await gate.promise;
      return url.includes("110100") ? beijingHtml : nationalHtml;
    });
    const service = new RateService(fetcher);

    const first = service.getRates();
    const second = service.getRates();
    const forced = service.getRates(true);

    expect(fetcher).toHaveBeenCalledTimes(2);
    gate.resolve();
    const [firstResult, secondResult, forcedResult] = await Promise.all([
      first,
      second,
      forced,
    ]);

    expect(secondResult).toBe(firstResult);
    expect(forcedResult).toBe(firstResult);
    expect(firstResult.cached).toBe(false);
  });

  it("gives an in-flight forced refresh priority over a valid cache", async () => {
    let gate: ReturnType<typeof deferred> | null = null;
    const fetcher = vi.fn(async (url: string) => {
      if (gate) await gate.promise;
      return url.includes("110100") ? beijingHtml : nationalHtml;
    });
    const service = new RateService(fetcher, 60_000);
    await service.getRates();

    gate = deferred();
    const forced = service.getRates(true);
    const ordinary = service.getRates();

    expect(fetcher).toHaveBeenCalledTimes(4);
    gate.resolve();
    const [forcedResult, ordinaryResult] = await Promise.all([forced, ordinary]);

    expect(ordinaryResult).toBe(forcedResult);
    expect(ordinaryResult.cached).toBe(false);
  });

  it("clears a failed in-flight refresh so the next request can retry", async () => {
    const gate = deferred();
    let failing = true;
    const fetcher = vi.fn(async (url: string) => {
      await gate.promise;
      if (failing) throw new Error("timeout");
      return url.includes("110100") ? beijingHtml : nationalHtml;
    });
    const service = new RateService(fetcher);

    const first = service.getRates();
    const second = service.getRates(true);
    gate.resolve();
    const failures = await Promise.allSettled([first, second]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(failures.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);

    failing = false;
    const recovered = await service.getRates();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(recovered.rates).toHaveLength(2);
  });
});
