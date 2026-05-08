import { getHermesHttpBase } from './programConfig';

type HermesLatestResponse = {
  binary?: { encoding?: string; data?: string[] };
};

/** Hermes returns accumulator payloads as hex; Pyth Solana SDK expects base64. */
export async function fetchHermesLatestPriceUpdatesBase64(
  feedIds0x: string[],
): Promise<string[]> {
  if (feedIds0x.length === 0) {
    throw new Error('fetchHermesLatestPriceUpdatesBase64: at least one feed id required');
  }
  const base = getHermesHttpBase();
  const url = new URL(`${base}/v2/updates/price/latest`);
  for (const id of feedIds0x) {
    const withPrefix = id.startsWith('0x') ? id : `0x${id}`;
    url.searchParams.append('ids[]', withPrefix);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Hermes ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as HermesLatestResponse;
  const hexList = json.binary?.data;
  if (!Array.isArray(hexList) || hexList.length === 0) {
    throw new Error('Hermes response missing binary.data');
  }
  return hexList.map((hex) => {
    const buf = Buffer.from(hex.replace(/^0x/i, ''), 'hex');
    return buf.toString('base64');
  });
}
