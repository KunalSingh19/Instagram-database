
import fsPromises from "fs/promises";
import fs from "fs";
import { instagramGetUrl } from "instagram-url-direct";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import pLimit from "p-limit";
import pRetry from "p-retry";
import sanitize from "sanitize-filename";
import crypto from "crypto";
import { createReadStream } from "fs";
import { createInterface } from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = "mediaData.json";  // Renamed from reelsData.json
const HISTORY_FILE = "history.json";
const BROKEN_LINKS_FILE = "brokenLinks.json";
const FETCH_ERRORS_FILE = "fetchErrors.json";
const MAX_BATCH_SIZE = 1000;
const MAX_TOTAL_ATTEMPTS = 1500;
const FETCH_CONCURRENCY = 5;
const DOWNLOAD_CONCURRENCY = 3;
const MAX_MEDIA_PER_POST = 10;  // Limit for carousels

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

async function readUrlsStream(inputFile) {
  const urls = new Set();
  const rl = createInterface({ input: createReadStream(inputFile) });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) urls.add(trimmed);
  }
  return Array.from(urls);
}

function isReelUrl(url) {
  return url.includes("/reel/") || url.includes("/p/") && url.includes("video");  // Basic detection; refine if needed
}

async function fetchMedia(inputFile, ascending = false) {
  try {
    let urls = await readUrlsStream(inputFile);

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
      console.log("No new URLs to process after filtering existing, history, and invalid media URLs.");
      return existingData;
    }

    const results = { ...existingData };
    const fetchErrors = [];
    let fetchedCount = 0;
    let attempts = 0;

    const limit = pLimit(FETCH_CONCURRENCY);
    let abortFetch = false;

    const urlsToProcess = remainingUrls.slice(0, MAX_TOTAL_ATTEMPTS);

    const fetchTasks = urlsToProcess.map((url) =>
      limit(async () => {
        if (abortFetch) return;
        if (fetchedCount >= MAX_BATCH_SIZE) return;

        attempts++;
        try {
          const data = await pRetry(
            () => instagramGetUrl(url),
            {
              retries: 3,
              minTimeout: 1000,
              factor: 2,
              onFailedAttempt: (error) => {
                console.log(`Retry ${error.retryCount} for ${url}: ${error.message}`);
              },
            }
          );
          results[url] = data;
          fetchedCount++;
          const type = isReelUrl(url) ? "reel" : "post";
          console.log(`Fetched ${type} data for ${url} (${fetchedCount}/${MAX_BATCH_SIZE})`);
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
      // Clean up errors even on abort
      for (const [url, data] of Object.entries(results)) {
        if (data && data.error) {
          delete results[url];
        }
      }
      await saveJsonFile(HISTORY_FILE, historyData);  // Save history
      return results;
    }

    // Clean up error entries
    for (const [url, data] of Object.entries(results)) {
      if (data && data.error) {
        delete results[url];
      }
    }

    // Update history for successful fetches
    for (const url of Object.keys(results)) {
      if (!historyData[url]) {
        historyData[url] = { status: 'fetched', timestamp: new Date().toISOString(), type: isReelUrl(url) ? 'reel' : 'post' };
      }
    }
    await saveJsonFile(HISTORY_FILE, historyData);

    if (fetchedCount === 0) {
      console.log("No URLs were successfully fetched.");
    } else if (fetchedCount < MAX_BATCH_SIZE) {
      console.log(
        `Fetched only ${fetchedCount} URLs out of requested ${MAX_BATCH_SIZE} after ${attempts} attempts.`
      );
    } else {
      console.log(`Successfully fetched ${fetchedCount} URLs.`);
    }

    await saveJsonFile(DATA_FILE, results);
    console.log(`Data saved to ${DATA_FILE}`);

    if (fetchErrors.length > 0) {
      const existingFetchErrors = fetchErrorsData || [];
      const combinedFetchErrors = [...existingFetchErrors];
      for (const errEntry of fetchErrors) {
        if (!existingFetchErrors.some((e) => errEntry.url === e.url)) {
          combinedFetchErrors.push(errEntry);
        }
      }
      await saveJsonFile(FETCH_ERRORS_FILE, combinedFetchErrors);
      console.log(`Saved ${fetchErrors.length} new fetch errors to '${FETCH_ERRORS_FILE}'.`);
    }

    return results;
  } catch (err) {
    console.error("Unexpected error in fetchMedia:", err);
    return {};
  }
}

async function downloadFile(url, outputPath, retries = 3) {
  return pRetry((attempt) => {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputPath);
      const client = url.startsWith("https") ? https : http;
      const req = client.get(url, (response) => {
        if (response.statusCode >= 400) {
          file.close();
          fs.unlink(outputPath, (err) => {
            if (err) console.warn(`Failed to delete partial file ${outputPath}:`, err);
          });
          if (response.statusCode === 401 && attempt < retries) {
            throw new Error(`401 Unauthorized (retry ${attempt})`);
          }
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close(resolve);
        });
      });

      req.on("error", (err) => {
        file.close();
        fs.unlink(outputPath, (errUnlink) => {
          if (errUnlink) console.warn(`Failed to delete partial file ${outputPath}:`, errUnlink);
        });
        reject(err);
      });
    });
  }, { retries, minTimeout: 1000, factor: 2 });
}

function getExtensionFromMime(mime) {
  const map = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  return map[mime] || (mime.startsWith("image/") ? ".jpg" : ".mp4");
}

function generateFilename(url, index = 0, mimeType = "") {
  const hash = crypto.createHash("md5").update(url).digest("hex").slice(0, 8);
  const rawName = url.replace(/https?:\/\//, "").replace(/[\/?&=]/g, "_").slice(0, 50);
  const sanitized = sanitize(rawName);
  const ext = getExtensionFromMime(mimeType);
  return index > 0 ? `${hash}_${sanitized}_${index.toString().padStart(3, "0")}${ext}` : `${hash}_${sanitized}${ext}`;
}

function shouldSkipMedia(media) {
  // Skip thumbnails or low-res
  if (media.url.includes("thumbnail") || (media.width && media.width < 500)) {
    return true;
  }
  return false;
}

async function downloadAllMedia(dataFile = DATA_FILE, outputDir = "media") {
  try {
    const content = await fsPromises.readFile(dataFile, "utf-8");
    const mediaData = JSON.parse(content);

    // Create subdirs
    await fsPromises.mkdir(path.join(outputDir, "images"), { recursive: true });
    await fsPromises.mkdir(path.join(outputDir, "videos"), { recursive: true });

    const brokenLinks = [];
    let count = 0;

    const limit = pLimit(DOWNLOAD_CONCURRENCY);
    let abortDownload = false;

    const downloadTasks = Object.entries(mediaData).map(([url, postData]) =>
      limit(async () => {
        if (abortDownload) return;

        // Skip if already downloaded (check all paths in array or single)
        const existingPaths = Array.isArray(postData.local_media_path) ? postData.local_media_path : [postData.local_media_path].filter(Boolean);
        const allExist = existingPaths.every((p) => p && fs.existsSync(p));
        if (allExist && existingPaths.length > 0) {
          console.log(`Skipping already downloaded media for ${url}`);
          return;
        }

        if (
          typeof postData !== "object" ||
          !Array.isArray(postData.media_details) ||
          postData.media_details.length === 0
        ) {
          console.warn(`No media details found for ${url}`);
          brokenLinks.push({ url, reason: "No media details found" });
          return;
        }

        const validMedia = postData.media_details
          .filter((m) => (m.type === "video" || m.type === "image") && m.url && !shouldSkipMedia(m))
          .slice(0, MAX_MEDIA_PER_POST);

        if (validMedia.length === 0) {
          console.warn(`No valid video/image URLs found for ${url}`);
          brokenLinks.push({ url, reason: "No valid media URLs found" });
          return;
        }

        const localPaths = [];
        for (let i = 0; i < validMedia.length; i++) {
          const media = validMedia[i];
          const mediaUrl = media.url;
          const mimeType = media.mime_type || "";
          const isVideo = media.type === "video";
          const subDir = isVideo ? "videos" : "images";
          const fileName = generateFilename(url, i + 1, mimeType);
          const outputPath = path.join(outputDir, subDir, fileName);

          try {
            await downloadFile(mediaUrl, outputPath);
            console.log(`Downloaded ${isVideo ? "video" : "image"} ${i + 1}/${validMedia.length} for ${url} to ${outputPath}`);
            localPaths.push(outputPath);
            count++;
          } catch (err) {
            console.error(`Failed to download media ${i + 1} for ${url}:`, err.message);

            if (err.message.includes("401") || err.message.toLowerCase().includes("unauthorized")) {
              abortDownload = true;
              throw new Error(`401 Unauthorized error encountered at URL: ${url}. Stopping download process.`);
            }

            brokenLinks.push({ url, reason: `Media ${i + 1}: ${err.message}` });
          }
        }

        if (localPaths.length > 0) {
          postData.local_media_path = localPaths.length === 1 ? localPaths[0] : localPaths;
        }
      })
    );

    try {
      await Promise.all(downloadTasks);
    } catch (stopError) {
      console.error(stopError.message);
      // Save partial data before exiting
      await saveJsonFile(dataFile, mediaData);
      if (brokenLinks.length > 0) {
        await saveJsonFile(BROKEN_LINKS_FILE, brokenLinks);
        console.log(`Saved ${brokenLinks.length} broken links to '${BROKEN_LINKS_FILE}'.`);
      }
      return;
    }

    // Update history for successful downloads
    const historyData = await loadJsonFile(HISTORY_FILE);
    for (const [url, data] of Object.entries(mediaData)) {
      if (data.local_media_path) {
        historyData[url] = { ...historyData[url], status: 'downloaded', timestamp: new Date().toISOString() };
      }
    }
    await saveJsonFile(HISTORY_FILE, historyData);

    await saveJsonFile(dataFile, mediaData);

    if (brokenLinks.length > 0) {
      await saveJsonFile(BROKEN_LINKS_FILE, brokenLinks);
      console.log(`Saved ${brokenLinks.length} broken links to '${BROKEN_LINKS_FILE}'.`);
    }

    console.log(`Downloaded ${count} new media items to folder '${outputDir}' (images/ and videos/).`);
  } catch (err) {
    console.error("Error downloading media:", err);
  }
}

const inputFile = process.argv[2] || "reels.txt";  // Renamed default for generality
const ascending = process.argv[3] === "asc";

(async () => {
  const fetchedData = await fetchMedia(inputFile, ascending);
  if (fetchedData && Object.keys(fetchedData).length > 0) {
    await downloadAllMedia();
  } else {
    console.log("No
