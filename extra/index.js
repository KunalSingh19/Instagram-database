import fsPromises from "fs/promises";
import fs from "fs";
import { instagramGetUrl } from "instagram-url-direct";
import path from "path";
import { fileURLToPath } from "url";
import pLimit from "p-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = "reelsData.json";
const HISTORY_FILE = "history.json";
const FETCH_ERRORS_FILE = "fetchErrors.json";
const MAX_BATCH_SIZE = 1000;
const MAX_TOTAL_ATTEMPTS = 1500;
const FETCH_CONCURRENCY = 5;

async function loadJsonFile(filePath, defaultType = "object") {
  try {
    const content = await fsPromises.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") {
      return defaultType === "array" ? [] : {};
    }
    console.warn(`Warning: Could not parse ${filePath}, starting empty. Error: ${err.message}`);
    return defaultType === "array" ? [] : {};
  }
}

async function saveJsonFile(filePath, data) {
  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function fetchReels(inputFile, ascending = false) {
  try {
    const fileContent = await fsPromises.readFile(inputFile, "utf-8");
    let urls = Array.from(
      new Set(
        fileContent
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      )
    );

    if (urls.length === 0) {
      console.log(`No URLs found in ${inputFile}.`);
      return {};
    }

    if (!ascending) urls.reverse();

    const existingData = await loadJsonFile(DATA_FILE);
    const historyData = await loadJsonFile(HISTORY_FILE);
    const fetchErrorsData = await loadJsonFile(FETCH_ERRORS_FILE, "array");

    const skipUrls = new Set([
      ...Object.keys(existingData),
      ...Object.keys(historyData),
      ...fetchErrorsData.map((e) => e.url),
    ]);

    const remainingUrls = urls.filter((url) => !skipUrls.has(url));

    if (remainingUrls.length === 0) {
      console.log("No new URLs to process after filtering existing, history, and invalid reel URLs.");
      return existingData;
    }

    const results = { ...existingData };
    const fetchErrors = [];
    let fetchedCount = 0;
    let attempts = 0;

    const limit = pLimit(FETCH_CONCURRENCY);

    const urlsToProcess = remainingUrls.slice(0, MAX_TOTAL_ATTEMPTS);

    let abortFetch = false;

    const fetchTasks = urlsToProcess.map((url) =>
      limit(async () => {
        if (abortFetch) return;
        if (fetchedCount >= MAX_BATCH_SIZE) return;

        attempts++;
        try {
          const data = await instagramGetUrl(url);
          results[url] = data;
          fetchedCount++;
          console.log(`Fetched data for ${url} (${fetchedCount}/${MAX_BATCH_SIZE})`);
        } catch (err) {
          console.error(`Failed to fetch data for ${url}:`, err.message);

          if (err.message.includes("401") || err.message.toLowerCase().includes("unauthorized")) {
            abortFetch = true;
            throw new Error(`401 Unauthorized error encountered at URL: ${url}. Stopping fetch process.`);
          }

          if (
            err.message.includes("Only posts/reels supported") ||
            err.message.includes("check if your link is valid")
          ) {
            fetchErrors.push({ url, reason: err.message });
          }
          results[url] = { error: err.message };
        }
      })
    );

    try {
      await Promise.all(fetchTasks);
    } catch (stopError) {
      console.error(stopError.message);
      // Save partial results before exiting
      await saveJsonFile(DATA_FILE, results);
      if (fetchErrors.length > 0) {
        const existingFetchErrors = fetchErrorsData || [];
        const combinedFetchErrors = [...existingFetchErrors];
        for (const errEntry of fetchErrors) {
          if (!existingFetchErrors.some((e) => e.url === errEntry.url)) {
            combinedFetchErrors.push(errEntry);
          }
        }
        await saveJsonFile(FETCH_ERRORS_FILE, combinedFetchErrors);
        console.log(`Saved ${fetchErrors.length} new fetch errors to '${FETCH_ERRORS_FILE}'.`);
      }
      return results;
    }

    if (fetchedCount === 0) {
      console.log("No URLs were successfully fetched.");
    } else if (fetchedCount < MAX_BATCH_SIZE) {
      console.log(
        `Fetched only ${fetchedCount} URLs out of requested ${MAX_BATCH_SIZE} after ${attempts} attempts.`
      );
    } else {
      console.log(`Successfully fetched ${fetchedCount} URLs.`);
    }

    for (const [url, data] of Object.entries(results)) {
      if (data && data.error) {
        delete results[url];
      }
    }

    await saveJsonFile(DATA_FILE, results);
    console.log(`Data saved to ${DATA_FILE}`);

    if (fetchErrors.length > 0) {
      const existingFetchErrors = fetchErrorsData || [];
      const combinedFetchErrors = [...existingFetchErrors];
      for (const errEntry of fetchErrors) {
        if (!existingFetchErrors.some((e) => e.url === errEntry.url)) {
          combinedFetchErrors.push(errEntry);
        }
      }
      await saveJsonFile(FETCH_ERRORS_FILE, combinedFetchErrors);
      console.log(`Saved ${fetchErrors.length} new fetch errors to '${FETCH_ERRORS_FILE}'.`);
    }

    return results;
  } catch (err) {
    console.error("Unexpected error in fetchReels:", err);
    return {};
  }
}

const inputFile = process.argv[2] || "reels.txt";
const ascending = process.argv[3] === "asc";

(async () => {
  const fetchedData = await fetchReels(inputFile, ascending);
  if (!fetchedData || Object.keys(fetchedData).length === 0) {
    console.log("No data fetched.");
  }
})();
