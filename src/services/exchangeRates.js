import fs from "node:fs/promises";
import path from "node:path";

import { normalizeAccount, parseCost } from "../domain/teamBus.js";

export class ExchangeRateService {
  constructor(cachePath, options = {}) {
    this.cachePath = cachePath;
    this.fetchFn = options.fetchFn || fetch;
  }

  async attachRates(accounts) {
    const enriched = [];

    for (const account of accounts) {
      const normalized = normalizeAccount(account);
      const cost = parseCost(normalized.cost);

      if (!cost.currency) {
        enriched.push({ ...normalized, costDetail: cost, exchangeRate: null });
        continue;
      }

      try {
        const exchangeRate = await this.getRateToCny(cost.currency, normalized.openedAt);
        enriched.push({ ...normalized, costDetail: cost, exchangeRate });
      } catch {
        enriched.push({ ...normalized, costDetail: cost, exchangeRate: null });
      }
    }

    return enriched;
  }

  async getRateToCny(currency, date) {
    if (currency === "CNY") {
      return { currency, date, rateToCny: 1, source: "CNY" };
    }

    const cache = await this.readCache();
    const key = `${date}:${currency}`;
    if (cache[key]) return cache[key];

    const rate = await this.fetchRate(currency, date);
    cache[key] = rate;
    await this.writeCache(cache);
    return rate;
  }

  async fetchRate(currency, date) {
    const frankfurter = await this.tryFrankfurter(currency, date);
    if (frankfurter) return frankfurter;

    const fallback = await this.tryCurrencyApi(currency, date);
    if (fallback) return fallback;

    throw new Error(`No CNY exchange rate for ${currency} on ${date}`);
  }

  async tryFrankfurter(currency, date) {
    const url = `https://api.frankfurter.dev/v1/${date}?base=${encodeURIComponent(currency)}&symbols=CNY`;
    const response = await this.fetchFn(url);
    if (!response.ok) return null;
    const payload = await response.json();
    const rateToCny = Number(payload?.rates?.CNY);
    if (!Number.isFinite(rateToCny)) return null;
    return { currency, date: payload.date || date, rateToCny, source: "frankfurter.dev" };
  }

  async tryCurrencyApi(currency, date) {
    const code = currency.toLowerCase();
    const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${code}.json`;
    const response = await this.fetchFn(url);
    if (!response.ok) return null;
    const payload = await response.json();
    const rateToCny = Number(payload?.[code]?.cny);
    if (!Number.isFinite(rateToCny)) return null;
    return { currency, date: payload.date || date, rateToCny, source: "currency-api" };
  }

  async readCache() {
    try {
      return JSON.parse(await fs.readFile(this.cachePath, "utf8"));
    } catch {
      return {};
    }
  }

  async writeCache(cache) {
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    const tmpPath = `${this.cachePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, this.cachePath);
  }
}
