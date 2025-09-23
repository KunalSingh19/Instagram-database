import fsPromises from "fs/promises";
import fs from "fs";
import { instagramGetUrl } from "instagram-url-direct";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import pLimit from "p-limit";
import sanitize from "sanitize-filename";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = "reelsData.json";
const HISTORY_FILE = "history.json";
const BROKEN_LINKS_FILE = "brokenLinks.json";
const FETCH_ERRORS_FILE = "fetchErrors.json";
const MAX_BATCH_SIZE = 1000;
const MAX_TOTAL_ATTEMPTS = 1500;
const FETCH_CONCURRENCY = 5;
const DOWNLOAD_CONCURRENCY = 3;

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

async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(outputPath, () => {});
          reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
          return;
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", (err) => {
        file.close();
        fs.unlink(outputPath, () => {});
        reject(err);
      });
  });
}

function getExtensionFromMime(mime) {
  const map = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
  };
  return map[mime] || ".mp4";
}

async function downloadAllVideos(dataFile = DATA_FILE, outputDir = "videos") {
  try {
    const content = await fsPromises.readFile(dataFile, "utf-8");
    const reelsData = JSON.parse(content);

    await fsPromises.mkdir(outputDir, { recursive: true });

    const brokenLinks = [];
    let count = 0;

    const limit = pLimit(DOWNLOAD_CONCURRENCY);

    let abortDownload = false;

    const downloadTasks = Object.entries(reelsData).map(([url, reelData]) =>
      limit(async () => {
        if (abortDownload) return;

        // Skip if already downloaded and file exists
        if (
          reelData.local_media_path &&
          fs.existsSync(reelData.local_media_path)
        ) {
          console.log(`Skipping already downloaded video for ${url}`);
          return;
        }

        if (
          typeof reelData !== "object" ||
          !Array.isArray(reelData.media_details) ||
          reelData.media_details.length === 0
        ) {
          console.warn(`No media details found for reel: ${url}`);
          brokenLinks.push({ url, reason: "No media details found" });
          return;
        }

        const videoMedia = reelData.media_details.find((m) => m.type === "video" && m.url);
        if (!videoMedia) {
          console.warn(`No video URL found for reel: ${url}`);
          brokenLinks.push({ url, reason: "No video URL found" });
          return;
        }

        const mediaUrl = videoMedia.url;
        const mimeType = videoMedia.mime_type || "";

        let ext = path.extname(new URL(mediaUrl).pathname);
        if (!ext && mimeType) {
          ext = getExtensionFromMime(mimeType);
        }
        if (!ext) {
          ext = ".mp4";
        }

        const rawName = url.replace(/https?:\/\//, "").replace(/[\/?&=]/g, "_").slice(0, 100);
        const fileName = sanitize(rawName) + ext;
        const outputPath = path.join(outputDir, fileName);

        try {
          await downloadFile(mediaUrl, outputPath);
          console.log(`Downloaded video for ${url} to ${outputPath}`);
          count++;
          reelData.local_media_path = outputPath;
        } catch (err) {
          console.error(`Failed to download video for ${url}:`, err.message);

          if (err.message.includes("401") || err.message.toLowerCase().includes("unauthorized")) {
            abortDownload = true;
            throw new Error(`401 Unauthorized error encountered at URL: ${url}. Stopping download process.`);
          }

          if (!err.message.includes("(401)")) {
            brokenLinks.push({ url, reason: err.message });
          } else {
            console.warn(`Skipping broken link record for 401 Unauthorized: ${url}`);
          }
        }
      })
    );

    try {
      await Promise.all(downloadTasks);
    } catch (stopError) {
      console.error(stopError.message);
      // Save partial data before exiting
      await saveJsonFile(dataFile, reelsData);
      if (brokenLinks.length > 0) {
        await saveJsonFile(BROKEN_LINKS_FILE, brokenLinks);
        console.log(`Saved ${brokenLinks.length} broken links to '${BROKEN_LINKS_FILE}'.`);
      }
      return;
    }

    await saveJsonFile(dataFile, reelsData);

    if (brokenLinks.length > 0) {
      await saveJsonFile(BROKEN_LINKS_FILE, brokenLinks);
      console.log(`Saved ${brokenLinks.length} broken links to '${BROKEN_LINKS_FILE}'.`);
    }

    console.log(`Downloaded ${count} new videos to folder '${outputDir}'.`);
  } catch (err) {
    console.error("Error downloading videos:", err);
  }
}

const inputFile = process.argv[2] || "reels.txt";
const ascending = process.argv[3] === "asc";

(async () => {
  const fetchedData = await fetchReels(inputFile, ascending);
  if (fetchedData && Object.keys(fetchedData).length > 0) {
    await downloadAllVideos();
  } else {
    console.log("No data fetched, skipping video downloads.");
  }
})();


