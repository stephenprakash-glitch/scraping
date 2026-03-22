/**
 * Puppeteer helpers for seats.aero:
 * - getCookiesFromPuppeteer: legacy path (cookies only)
 * - fetchSearchPartialViaPuppeteer: load /search then fetch the API in-page (avoids Cloudflare blocking axios)
 */
function getPuppeteerLaunchOptions() {
  const launchOptions = {
    headless: process.env.SEATS_PUPPETEER_HEADLESS !== "false",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else if (process.env.SEATS_USE_SYSTEM_CHROME === "true") {
    launchOptions.channel = "chrome";
  }

  return launchOptions;
}

async function getCookiesFromPuppeteer(pageUrl, userAgent) {
  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    throw new Error(
      "puppeteer is not installed. Run: npm install puppeteer"
    );
  }

  const waitMs = Number(process.env.SEATS_PUPPETEER_WAIT_MS || 3000);
  const gotoTimeout = Number(process.env.SEATS_PUPPETEER_GOTO_TIMEOUT_MS || 90000);

  const browser = await puppeteer.launch(getPuppeteerLaunchOptions());

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      userAgent ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language":
        process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    });

    await page.goto(pageUrl, {
      waitUntil: "networkidle2",
      timeout: gotoTimeout
    });

    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const cookies = await page.cookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await browser.close();
  }
}

/**
 * Opens the search page (sets cookies / session), then calls the JSON API with
 * `fetch` inside the page so Cloudflare sees a real browser request.
 * @returns {{ status: number, contentType: string, bodyText: string }}
 */
/**
 * @param {string} searchPageUrl
 * @param {string} apiUrl search_partial URL
 * @param {string} userAgent
 * @param {{ vuerefUrl?: string, skipVueref?: boolean }} [options]
 */
async function fetchSearchPartialViaPuppeteer(
  searchPageUrl,
  apiUrl,
  userAgent,
  options = {}
) {
  const { vuerefUrl, skipVueref } = options;

  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    throw new Error(
      "puppeteer is not installed. Run: npm install puppeteer"
    );
  }

  const waitMs = Number(process.env.SEATS_PUPPETEER_WAIT_MS || 3000);
  const gotoTimeout = Number(process.env.SEATS_PUPPETEER_GOTO_TIMEOUT_MS || 90000);

  const browser = await puppeteer.launch(getPuppeteerLaunchOptions());

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      userAgent ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language":
        process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    });

    await page.goto(searchPageUrl, {
      waitUntil: "networkidle2",
      timeout: gotoTimeout
    });

    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const result = await page.evaluate(
      async ({ apiUrl: u, referer, vueref, doVueref }) => {
        if (doVueref && vueref) {
          await fetch(vueref, {
            credentials: "include",
            headers: {
              Accept: "application/json, text/plain, */*",
              Referer: referer
            }
          });
        }
        const r = await fetch(u, {
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: referer
          }
        });
        const text = await r.text();
        const contentType = r.headers.get("content-type") || "";
        return {
          status: r.status,
          contentType,
          bodyText: text
        };
      },
      {
        apiUrl,
        referer: searchPageUrl,
        vueref: vuerefUrl || "",
        doVueref: Boolean(vuerefUrl) && !skipVueref
      }
    );

    return result;
  } finally {
    await browser.close();
  }
}

module.exports = {
  getPuppeteerLaunchOptions,
  getCookiesFromPuppeteer,
  fetchSearchPartialViaPuppeteer
};
